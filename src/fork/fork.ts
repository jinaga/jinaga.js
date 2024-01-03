import { FactEnvelope, FactRecord, FactReference } from "../storage";

export interface Fork {
    save(envelopes: FactEnvelope[]): Promise<void>;
    load(references: FactReference[]): Promise<FactRecord[]>;
    close(): Promise<void>;
}