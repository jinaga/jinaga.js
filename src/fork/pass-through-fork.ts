import { FactEnvelope, FactReference, Storage } from "../storage";
import { Fork } from "./fork";

export class PassThroughFork implements Fork {
    constructor(
        private storage: Storage
    ) { }

    async close(): Promise<void> {
        return Promise.resolve();
    }

    save(envelopes: FactEnvelope[]): Promise<void> {
        return Promise.resolve();
    }

    load(references: FactReference[]): Promise<FactEnvelope[]> {
        return this.storage.load(references);
    }

    processQueueNow(): Promise<void> {
        return Promise.resolve();
    }
}