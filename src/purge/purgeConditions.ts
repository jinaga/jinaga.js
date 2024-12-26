import { describeSpecification } from "../specification/description";
import { SpecificationOf } from "../specification/model";
import { Specification } from "../specification/specification";

export class PurgeConditions {
    static empty: PurgeConditions = new PurgeConditions([]);

    constructor(
        public specifications: Specification[]
    ) { }

    whenExists<T, U>(specification: SpecificationOf<T, U>): PurgeConditions {
        return new PurgeConditions([
            ...this.specifications,
            specification.specification
        ]);
    }

    with(fn: (p: PurgeConditions) => PurgeConditions): PurgeConditions {
        return fn(this);
    }

    merge(purgeConditions: PurgeConditions): PurgeConditions {
        return new PurgeConditions([
            ...this.specifications,
            ...purgeConditions.specifications
        ]);
    }

    saveToDescription(): string {
        const specificationDescriptions = this.specifications.map(s => describeSpecification(s, 1)).join("");
        return `purge {\n${specificationDescriptions}}\n`;
    }
}