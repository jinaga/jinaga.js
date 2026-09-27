import { FactEnvelope, FactReference, Storage } from "../storage";
import { Fork } from "./fork";
import { ProgressNotifier } from "./progress";

export class PassThroughFork implements Fork {
    private readonly progress = new ProgressNotifier();

    constructor(
        private storage: Storage
    ) { }

    async close(): Promise<void> {
        return Promise.resolve();
    }

    save(envelopes: FactEnvelope[]): Promise<void> {
        // Nothing is sent anywhere, so nothing is ever waiting to be sent
        // (issue #306).
        this.progress.notify(0);
        return Promise.resolve();
    }

    onProgress(listener: (count: number) => void): () => void {
        return this.progress.onProgress(listener);
    }

    load(references: FactReference[]): Promise<FactEnvelope[]> {
        return this.storage.load(references);
    }

    processQueueNow(): Promise<void> {
        return Promise.resolve();
    }
}