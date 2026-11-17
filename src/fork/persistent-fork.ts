import { TopologicalSorter } from '../fact/sorter';
import { RetryOptions } from '../http/retry';
import { WebClient } from '../http/web-client';
import { QueueProcessor } from '../managers/QueueProcessor';
import { FactEnvelope, factEnvelopeEquals, FactRecord, FactReference, Queue, Storage } from '../storage';
import { Trace } from "../util/trace";
import { Fork } from "./fork";
import { ProgressNotifier } from './progress';
import { serializeLoad } from './serialize';
import { WebClientSaver, WebClientSaverOptions } from './web-client-saver';

/**
 * Options for the fork's outgoing queue: how a flush is batched, and how long
 * it waits before retrying one that stalled on the connection (issue #400).
 */
export interface PersistentForkOptions extends WebClientSaverOptions {
    /**
     * The retry schedule the backoff draws its delays from. It is the schedule
     * `WebClient` retries a POST on and the feed stream reconnects on, so a
     * deployment states its tolerance for waiting once.
     */
    retry?: RetryOptions;
    /**
     * Ceiling for the backoff, in seconds, where `retry.maxDelayMs` is unset.
     * The feed stream backs off to the same ceiling.
     */
    feedRefreshIntervalSeconds?: number;
}

export class PersistentFork implements Fork {
    private queueProcessor: QueueProcessor;
    private readonly progress = new ProgressNotifier();
    private readonly stopListeningForResponses: () => void;
    /**
     * Listeners for the save path retrying (issue #394), and the registration
     * that feeds them. Subscribed once in the constructor rather than per
     * listener, so the fork holds one subscription to the client however many
     * watches are waiting.
     */
    private readonly retryListeners = new Set<() => void>();
    private readonly stopListeningForSaveRetries: () => void;

    constructor(
        private storage: Storage,
        private queue: Queue,
        private client: WebClient,
        private delayMilliseconds: number,
        options: PersistentForkOptions = {}
    ) {
        // The saver reports after each batch leaves the queue, so the count an
        // application sees follows the queue down as it drains rather than only
        // at the end of a flush (issue #306).
        const saver = new WebClientSaver(client, queue, options,
            () => this.reportQueueLength());
        this.queueProcessor = new QueueProcessor(saver, delayMilliseconds, {
            retry: options.retry,
            feedRefreshIntervalSeconds: options.feedRefreshIntervalSeconds
        });
        // A flush that the connection stopped left facts queued, and nothing
        // used to send them until the application wrote again (issue #400). A
        // client cannot tell whether it is offline, so the evidence it acts on
        // is the only evidence it has: the replicator answered a request. The
        // processor decides whether that is worth a flush.
        this.stopListeningForResponses = client.onResponse(
            () => this.queueProcessor.flushIfStalled());
        // A save that is retrying is the only bound a caller waiting on a flush
        // has: the flush itself ends only when the schedule gives up, which it
        // need never do (issue #394).
        this.stopListeningForSaveRetries = client.onSaveRetry(
            () => this.notifyRetrying());
    }

    initialize() {
        // Schedule processing of any existing items in the queue
        this.queueProcessor.scheduleProcessing();
    }

    async close(): Promise<void> {
        // Stop listening first, so the closing flush's own responses cannot
        // schedule another one behind it.
        this.stopListeningForResponses();
        this.stopListeningForSaveRetries();
        // Process any pending facts before closing
        try {
            await this.processQueueNow();
        } catch (error) {
            Trace.error(error);
        }
        this.queueProcessor.dispose();
        return Promise.resolve();
    }
    async save(envelopes: FactEnvelope[]): Promise<void> {
        await this.queue.enqueue(envelopes);
        await this.reportQueueLength();
        this.queueProcessor.scheduleProcessing();
    }

    onProgress(listener: (count: number) => void): () => void {
        return this.progress.onProgress(listener);
    }

    onRetrying(listener: () => void): () => void {
        this.retryListeners.add(listener);
        return () => {
            this.retryListeners.delete(listener);
        };
    }

    /**
     * Report that the save path is retrying. A throwing listener is logged and
     * never reaches the request it is reporting on, which is still in flight.
     */
    private notifyRetrying(): void {
        for (const listener of this.retryListeners) {
            try { listener(); } catch (error) { Trace.error(error); }
        }
    }

    /**
     * Report how many facts are waiting to be sent, read from the queue rather
     * than counted alongside it: the queue keys facts by identity, so a fact
     * queued twice is one fact waiting, and only the queue knows that.
     */
    private async reportQueueLength(): Promise<void> {
        if (!this.progress.listening) {
            return;
        }
        try {
            const envelopes = await this.queue.peek();
            this.progress.notify(envelopes.length);
        }
        catch (error) {
            // Reporting must not change what a save does. The facts are queued
            // by the time this runs, so a queue that cannot be read has nothing
            // to say about whether the save succeeded: `save` would reject a
            // `fact()` whose facts are safely queued, and the saver's flush loop
            // would read a failed read of the queue as a batch that failed to
            // send and stop there.
            Trace.error(error);
        }
    }

    async load(references: FactReference[]): Promise<FactEnvelope[]> {
        const known = await this.storage.load(references);
        const remaining = references.filter(reference => !known.some(factEnvelopeEquals(reference)));
        if (remaining.length === 0) {
            return known;
        }
        else {
            const records = await this.loadEnvelopes(remaining);
            return records.concat(known);
        }
    }

    /**
     * Processes the queue immediately, bypassing any delay.
     */
    async processQueueNow(): Promise<void> {
        await this.queueProcessor.processQueueNow();
    }

    private async loadEnvelopes(references: FactReference[]) {
        const sorter = new TopologicalSorter<FactRecord>();
        let loaded: FactEnvelope[] = [];
        for (let start = 0; start < references.length; start += 300) {
            const chunk = references.slice(start, start + 300);
            const response = await this.client.loadWithRetry(serializeLoad(chunk));
            const facts = sorter.sort(response.facts, (p, f) => f);
            const envelopes = facts.map(fact => {
                return <FactEnvelope>{
                    fact: fact,
                    signatures: []
                };
            });
            await this.storage.save(envelopes);
            loaded = loaded.concat(envelopes);
        }
        return loaded;
    }
}