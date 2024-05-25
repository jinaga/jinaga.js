import { FactEnvelope, FactRecord } from "../storage";

export interface KeyPair {
    publicPem: string;
    privatePem: string;
}

export function generateKeyPair(): KeyPair {
    throw new Error("Not implemented");
}

export function signFacts(keyPair: KeyPair, facts: FactRecord[]): FactEnvelope[] {
    throw new Error("Not implemented");
}
