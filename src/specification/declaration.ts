import { FactRecord, FactReference } from "../storage";

export interface DeclaredFact {
    reference: FactReference;
    fact: FactRecord | null;
}

export interface Declaration {
    [name: string]: DeclaredFact;
}