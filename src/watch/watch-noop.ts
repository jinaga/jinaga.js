import { Preposition } from "../query/query-parser";
import { Watch } from "./watch";

export class WatchNoOp<Fact, Model> implements Watch<Fact, Model> {
    watch<U, V>(
        preposition: Preposition<Fact, U>,
        resultAdded: (parent: Model, result: U) => (V | void),
        resultRemoved?: (model: V) => void
    ) : Watch<U, V> {
        return new WatchNoOp<U, V>();
    }

    async load(): Promise<void> {
    }

    stop(): void {
    }
}