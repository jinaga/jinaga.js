import { FactRecord, FactReference } from "../storage";

export interface DeclaredFact {
    reference: FactReference;
    fact: FactRecord | null;
}

export type Declaration = {
    name: string;
    declared: DeclaredFact;
}[];
