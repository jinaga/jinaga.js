import { RetryOptions, RetrySchedule, RetryWaits, resolveRetrySchedule } from "../http/retry";
import { Trace } from "../util/trace";
import { DEFAULT_FEED_REFRESH_INTERVAL_SECONDS } from "./NetworkManager";

/**
 * What one flush of the queue achieved, as far as scheduling the next one is
 * concerned (issue #400).
 */
export interface SaveOutcome {
    /**
     * The flush ended with data still queued because a connection failure
     * stopped it. Nothing about the data is wrong, so it is worth sending
     * again once the network is carrying requests.
     *
     * `false` covers both a flush that drained and a flush whose remaining
     * data the replicator refused. A refusal is the replicator's judgment of
     * that data, and sending it again changes nothing until something grows
     * the replicator's graph -- which the next save already triggers -- so
     * retrying on a schedule would only be a loop.
     */
    stalledOnConnection: boolean;
}

/**
 * Interface for a component that can save data.
 */
export interface Saver {
    /**
     * Saves data to the network.
     */
    save(): Promise<SaveOutcome>;
}

/**
 * How long the queue waits before retrying a flush that stalled on the
 * connection (issue #400). Resolved the way the feed stream resolves its
 * reconnect backoff: the configured values where given, otherwise a ceiling of
 * the feed refresh interval and a budget with no bound, because a queued fact
 * has to land eventually.
 */
export interface QueueBackoffOptions {
    retry?: RetryOptions;
    /**
     * Ceiling for the backoff, in seconds, where `retry.maxDelayMs` is unset.
     * Defaults to {@link DEFAULT_FEED_REFRESH_INTERVAL_SECONDS}, which is the
     * ceiling the feed stream's own reconnect backoff climbs to.
     */
    feedRefreshIntervalSeconds?: number;
}

class Batch {
    private isActive = false;
    private hasWork = false;
    private isTerminated = false;
    private delay: NodeJS.Timeout | null = null;
    private nextBatch: Batch | null = null;
    private notifyResolver: (() => void) | null = null;
    private notifyRejector: ((error: Error) => void) | null = null;
    private notifyPromise: Promise<void> | null = null;

    constructor(
        private readonly saver: Saver,
        private readonly delayMilliseconds: number,
        private readonly setBatch: (batch: Batch) => void
    ) {
    }

    activate() {
        this.isActive = true;
        this.beginWaiting();
    }

    workArrived() {
        this.hasWork = true;
        this.beginWaiting();
    }

    runNow(): Promise<void> {
        if (this.isTerminated) {
            return Promise.resolve();
        }
        if (!this.notifyPromise) {
            this.notifyPromise = new Promise<void>((resolve, reject) => {
                this.notifyResolver = resolve;
                this.notifyRejector = reject;
            });
            this.beginWorking();
        }
        return this.notifyPromise;
    }

    terminate() {
        this.isTerminated = true;
        if (this.delay) {
            clearTimeout(this.delay);
            this.delay = null;
        }
        if (this.notifyRejector) {
            this.notifyRejector(new Error("QueueProcessor terminated"));
        }
    }

    private beginWaiting() {
        if (this.isTerminated || !this.isActive || !this.hasWork || this.delay) {
            return;
        }
        if (this.delayMilliseconds === 0) {
            this.beginWorking();
        } else {
            this.delay = setTimeout(() => {
                this.beginWorking();
            }, this.delayMilliseconds);
        }
    }

    private beginWorking() {
        if (this.nextBatch) {
            return;
        }
        this.nextBatch = new Batch(this.saver, this.delayMilliseconds, this.setBatch);
        this.setBatch(this.nextBatch);
        this.saver.save()
            .then(() => this.done(null))
            .catch((error) => this.done(error));
    }

    private done(error: Error | null) {
        if (this.notifyResolver) {
            if (error) {
                this.notifyRejector!(error);
            } else {
                this.notifyResolver!();
            }
        } else if (error) {
            Trace.error(error);
        }
        if (this.nextBatch) {
            this.nextBatch.activate();
        }
    }
}

/**
 * Processes a queue with a debouncing mechanism.
 * This improves performance by batching multiple operations together.
 */
export class QueueProcessor {

    private currentBatch: Batch;
    private readonly backoffSchedule: RetrySchedule;
    /**
     * The last flush ended with data still queued because the connection
     * failed. While this holds, a response from the replicator or the backoff
     * is enough to make another attempt worth making.
     */
    private stalled = false;
    /**
     * A flush is in flight. Every trigger reads this, so a burst of responses
     * while one is running adds nothing rather than starting a second,
     * concurrent flush over the same data.
     */
    private flushing = false;
    private backoffTimer: NodeJS.Timeout | null = null;
    /**
     * The delays of the current backoff cycle, held across consecutive stalls
     * so each wait is longer than the last. It is dropped, not advanced, when
     * something shows the cycle should start over: a save, a push, or a
     * response from the replicator.
     */
    private backoffWaits: RetryWaits | null = null;
    private terminated = false;

    /**
     * Creates a new QueueProcessor.
     * @param saver The component that will save the data.
     * @param delayMilliseconds The delay in milliseconds before processing the queue.
     * @param backoff How long to wait before retrying a flush that stalled on
     * the connection (issue #400).
     */
    constructor(
        saver: Saver,
        delayMilliseconds: number,
        backoff: QueueBackoffOptions = {}
    ) {
        this.backoffSchedule = resolveRetrySchedule(backoff.retry, {
            maxDelayMs: (backoff.feedRefreshIntervalSeconds ||
                DEFAULT_FEED_REFRESH_INTERVAL_SECONDS) * 1000,
            timeoutMs: 0
        });
        // Every flush goes through this wrapper, so the processor reads the
        // outcome of each one rather than being told about it separately.
        const observed: Saver = {
            save: () => this.runSave(saver)
        };
        this.currentBatch = new Batch(observed, delayMilliseconds, (batch) => {
            this.currentBatch = batch;
        });
        this.currentBatch.activate();
    }

    /**
     * Schedules processing of the queue with a delay.
     * This allows multiple operations to be batched together.
     */
    public scheduleProcessing(): void {
        // New data flushes as it always has, and it starts the backoff cycle
        // over: the next stall waits the schedule's first delay again.
        this.restartBackoffCycle();
        this.currentBatch.workArrived();
    }

    /**
     * Processes the queue immediately, bypassing any delay.
     */
    public async processQueueNow(): Promise<void> {
        this.restartBackoffCycle();
        await this.currentBatch.runNow();
    }

    /**
     * Flush now, if and only if the last flush stalled on the connection
     * (issue #400). The caller reports that the replicator answered something;
     * whether that is worth acting on is this object's own state to read.
     *
     * A flush already in flight, a queue that has not stalled, and a disposed
     * processor each make this do nothing, so a stream delivering response
     * after response costs at most one flush.
     */
    public flushIfStalled(): void {
        if (this.terminated || !this.stalled || this.flushing) {
            return;
        }
        this.restartBackoffCycle();
        this.flushNow();
    }

    /**
     * Disposes of the QueueProcessor.
     */
    public dispose() {
        this.terminated = true;
        this.cancelBackoff();
        this.backoffWaits = null;
        this.currentBatch.terminate();
    }

    /**
     * Run one flush and read what it achieved. A flush that throws leaves the
     * stalled state as it was: it reported nothing about the connection, so
     * neither arming nor cancelling the backoff would be derived from
     * anything.
     */
    private async runSave(saver: Saver): Promise<SaveOutcome> {
        this.flushing = true;
        try {
            const outcome = await saver.save();
            this.stalled = outcome.stalledOnConnection;
            if (this.stalled) {
                this.armBackoff();
            }
            else {
                this.cancelBackoff();
                this.backoffWaits = null;
            }
            return outcome;
        }
        finally {
            this.flushing = false;
        }
    }

    private flushNow(): void {
        // Nothing awaits this flush, so its failure is reported here rather
        // than becoming an unhandled rejection.
        this.currentBatch.runNow().catch(error => Trace.error(error));
    }

    private armBackoff(): void {
        this.cancelBackoff();
        if (this.terminated) {
            return;
        }
        if (this.backoffWaits === null) {
            this.backoffWaits = new RetryWaits(this.backoffSchedule);
        }
        const waitMs = this.backoffWaits.next();
        if (waitMs === null) {
            // A configured budget is spent. The queue still holds the data, and
            // a save or a response from the replicator still flushes it.
            return;
        }
        this.backoffTimer = setTimeout(() => {
            this.backoffTimer = null;
            if (this.terminated || !this.stalled || this.flushing) {
                return;
            }
            this.flushNow();
        }, waitMs);
    }

    private cancelBackoff(): void {
        if (this.backoffTimer) {
            clearTimeout(this.backoffTimer);
            this.backoffTimer = null;
        }
    }

    private restartBackoffCycle(): void {
        this.cancelBackoff();
        this.backoffWaits = null;
    }
}