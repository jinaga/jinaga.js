import { FactConstructor, FactRepository, LabelOf, Traversal } from "../specification/model";

export class PurgeConditions {
    whenExists<T, U>(factConstructor: FactConstructor<T>, tupleDefinition: (proxy: LabelOf<T>, facts: FactRepository) => Traversal<LabelOf<U>>): PurgeConditions {
        throw new Error("Method not implemented.");
    }
}