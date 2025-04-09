import { Trace } from "../util/trace";

/**
 * Interface for a component that can save data.
 */
export interface Saver {
    /**
     * Saves data to the network.
     */
    save(): Promise<void>;
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

    /**
     * Creates a new QueueProcessor.
     * @param saver The component that will save the data.
     * @param delayMilliseconds The delay in milliseconds before processing the queue.
     */
    constructor(
        saver: Saver,
        delayMilliseconds: number
    ) {
        this.currentBatch = new Batch(saver, delayMilliseconds, (batch) => {
            this.currentBatch = batch;
        });
        this.currentBatch.activate();
    }

    /**
     * Schedules processing of the queue with a delay.
     * This allows multiple operations to be batched together.
     */
    public scheduleProcessing(): void {
        this.currentBatch.workArrived();
    }

    /**
     * Processes the queue immediately, bypassing any delay.
     */
    public async processQueueNow(): Promise<void> {
        await this.currentBatch.runNow();
    }

    /**
     * Disposes of the QueueProcessor.
     */
    public dispose() {
        this.currentBatch.terminate();
    }
}