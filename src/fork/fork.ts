import { FactEnvelope, FactReference } from "../storage";

export interface Fork {
    save(envelopes: FactEnvelope[]): Promise<void>;
    /**
     * Register a listener for the number of facts waiting to be sent (issue
     * #306). It fires whenever that number changes -- after facts are queued,
     * and after a batch leaves the queue -- with the length read from the queue
     * itself. Returns an unregister function.
     */
    onProgress(listener: (count: number) => void): () => void;
    /**
     * Register a listener for the save path reporting that it is retrying
     * (issue #394) -- the `retrying: true` of issue #399, on a channel a caller
     * can unregister from. Returns an unregister function.
     *
     * It is what bounds a wait on `processQueueNow`. A flush that is retrying is
     * one the replicator is not answering, and its schedule can be unbounded,
     * so a caller that waits for the flush to end would wait for the whole
     * retry budget.
     *
     * Optional, and absence is the statement that this fork never retries: its
     * save is awaited by the caller, or it sends nothing at all, so there is no
     * flush for a retry to bound. `FactManager.onRetrying` supplies the no-op
     * for a fork that leaves it out, which also keeps this interface
     * implementable by code written before it existed -- `Fork` is exported
     * from `src/index.ts`, so a required member here would break every
     * implementation outside this repository.
     */
    onRetrying?(listener: () => void): () => void;
    load(references: FactReference[]): Promise<FactEnvelope[]>;
    processQueueNow(): Promise<void>;
    close(): Promise<void>;
}