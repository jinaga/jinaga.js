import { Preposition } from '../query/query-parser';

export interface Watch<Fact, Model> {
    watch<U, V>(
        preposition: Preposition<Fact, U>,
        resultAdded: (parent: Model, result: U) => V,
        resultRemoved: (model: V) => void) : Watch<U, V>;
    watch<U, V>(
        preposition: Preposition<Fact, U>,
        resultAdded: (parent: Model, result: U) => void) : Watch<U, V>;
    load(): Promise<void>;
    stop(): void;
}