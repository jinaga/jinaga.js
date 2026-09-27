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
    load(references: FactReference[]): Promise<FactEnvelope[]>;
    processQueueNow(): Promise<void>;
    close(): Promise<void>;
}