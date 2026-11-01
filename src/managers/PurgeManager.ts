import { testSpecificationForCompliance } from "../purge/purgeCompliance";
import { SpecificationInverse, invertSpecification } from "../specification/inverse";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactReference, ProjectedResult, Storage, factReferenceEquals } from "../storage";
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
            const purgeRoots: FactReference[] = [];
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
                    if (!purgeRoots.some(factReferenceEquals(purgeRoot))) {
                        purgeRoots.push(purgeRoot);
                    }
                }
            }

            for (const purgeRoot of purgeRoots) {
                // A purge spares the triggers of every purge condition on the root's
                // type, not only the condition that the arriving fact triggered.
                // Each of those triggers is itself a descendant of the root, so a
                // purge that passed only one condition's triggers would delete the
                // others.
                const triggers = await this.triggersOfPurgeRoot(purgeRoot);

                // Purge all descendants of the purge root except for the triggers
                const count = await this.store.purgeDescendants(purgeRoot, triggers);
                if (count > 0) {
                    Trace.counter("facts_purged", count);
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

    // Every fact bound by any result of any purge condition whose given type is
    // the purge root's type, with the given bound to that root. The root itself
    // is not a trigger: a purge deletes only its strict descendants.
    private async triggersOfPurgeRoot(purgeRoot: FactReference): Promise<FactReference[]> {
        const triggers: FactReference[] = [];
        for (const purgeCondition of this.purgeConditions) {
            if (purgeCondition.given.length !== 1) {
                continue;
            }
            if (purgeCondition.given[0].label.type !== purgeRoot.type) {
                continue;
            }

            const results: ProjectedResult[] = await this.store.read([purgeRoot], purgeCondition);
            for (const result of results) {
                for (const name of Object.keys(result.tuple)) {
                    const reference = result.tuple[name];
                    if (factReferenceEquals(purgeRoot)(reference)) {
                        continue;
                    }
                    if (!triggers.some(factReferenceEquals(reference))) {
                        triggers.push(reference);
                    }
                }
            }
        }
        return triggers;
    }
}
