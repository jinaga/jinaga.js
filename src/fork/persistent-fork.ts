import { TopologicalSorter } from '../fact/sorter';
import { WebClient } from '../http/web-client';
import { QueueProcessor } from '../managers/QueueProcessor';
import { FactEnvelope, factEnvelopeEquals, FactRecord, FactReference, Queue, Storage } from '../storage';
import { Fork } from "./fork";
import { serializeLoad } from './serialize';
import { WebClientSaver } from './web-client-saver';

export class PersistentFork implements Fork {
    private queueProcessor: QueueProcessor;

    constructor(
        private storage: Storage,
        private queue: Queue,
        private client: WebClient,
        private delayMilliseconds: number
    ) {
        const saver = new WebClientSaver(client, queue);
        this.queueProcessor = new QueueProcessor(saver, delayMilliseconds);
    }

    initialize() {
        // Schedule processing of any existing items in the queue
        this.queueProcessor.scheduleProcessing();
    }

    async close(): Promise<void> {
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
        this.queueProcessor.scheduleProcessing();
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