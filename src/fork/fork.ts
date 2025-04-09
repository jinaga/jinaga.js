import { FactEnvelope, FactReference } from "../storage";

export interface Fork {
    save(envelopes: FactEnvelope[]): Promise<void>;
    load(references: FactReference[]): Promise<FactEnvelope[]>;
    processQueueNow(): Promise<void>;
    close(): Promise<void>;
}