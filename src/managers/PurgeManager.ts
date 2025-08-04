import { testSpecificationForCompliance } from "../purge/purgeCompliance";
import { SpecificationInverse, invertSpecification } from "../specification/inverse";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactReference, ProjectedResult, Storage } from "../storage";
import { Trace } from "../util/trace";

export class PurgeManager {
    private purgeInverses: SpecificationInverse[];

    constructor(private readonly store: Storage, private readonly purgeConditions: Specification[]) {
        this.purgeInverses = purgeConditions.map(pc => invertSpecification(pc)).flat();
    }

    async purge(): Promise<void> {
        const count = await this.store.purge(this.purgeConditions);
        if (count > 0) {
            Trace.counter("facts_purged", count);
        }
    }

    async triggerPurge(factsAdded: FactEnvelope[]): Promise<void> {
        for (const envelope of factsAdded) {
            const fact = envelope.fact;
            for (const purgeInverse of this.purgeInverses) {
                // Only run the purge inverse if the given type matches the fact type
                if (purgeInverse.inverseSpecification.given[0].label.type !== fact.type) {
                    continue;
                }

                const givenReference = {
                    type: fact.type,
                    hash: fact.hash
                };
                const results: ProjectedResult[] = await this.store.read([givenReference], purgeInverse.inverseSpecification);
                for (const result of results) {
                    const givenName = purgeInverse.givenSubset[0];
                    // The given is the purge root
                    const purgeRoot: FactReference = result.tuple[givenName];
                    // All other members of the result tuple are triggers
                    const triggers: FactReference[] = Object.keys(result.tuple)
                        .filter(k => k !== givenName)
                        .map(k => result.tuple[k]);

                    // Purge all descendants of the purge root except for the triggers
                    const count = await this.store.purgeDescendants(purgeRoot, triggers);
                    if (count > 0) {
                        Trace.counter("facts_purged", count);
                    }
                }
            }
        }
    }

    public checkCompliance(specification: Specification): void {
        const failures = testSpecificationForCompliance(specification, this.purgeConditions);
        if (failures.length > 0) {
            const message = failures.join("\n");
            throw new Error(message);
        }
    }
}
