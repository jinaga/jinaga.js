import { DistributionRules, MemoryStore, User, buildFeeds, dehydrateFact } from "@src";
import { DistributionEngine } from "../../src/distribution/distribution-engine";
import { skeletonOfSpecification } from "../../src/specification/skeleton";
import { Specification, isExistentialCondition } from "../../src/specification/specification";
import { FactEnvelope, FactReference } from "../../src/storage";
import { expectWellOrdered } from "./specificationTestHelpers";
import { Account, Freeze, Mirror, Reinstated, Retired, ServicePrincipal, Tenant, servedAndUnfrozen, servedAndUnfrozenSwapped, servedAndUnfrozenWithRegions, servicePrincipals } from "../vectors/models/positive-existential-branch";

// The model and the specifications these tests pass to `buildFeeds` are
// written in `test/vectors/models/positive-existential-branch.ts`, which is
// also where `npm run vectors` reads them from (#387).
//
// Issue #372: `addConditions` flattened a *positive* existential condition into
// the current feed by calling `addMatches` with no continuation. A negative
// condition on one of those flattened matches therefore built its branch from a
// continuation whose remainder was empty, so a restoring feed nested inside a
// positive existential stopped at the end of that existential's matches. It
// never reached the conditions still waiting on the outer match, the later
// matches, or the projection components.
//
// This is the same L6c gap as #368, at a different enclosing level, and the
// symptom is an L6d miss: no feed delivers the `Freeze` that the outer
// `notExists` reads for an account the restoring branch restored.

interface Graph {
    store: MemoryStore;
    tenant: FactReference;
    freezeOf: { [account: string]: FactReference };
}

/**
 * One tenant with two accounts.
 *
 *   live    a mirror in service, and no freeze
 *   frozen  a freeze that stands, and a mirror that was retired and reinstated
 *
 * `frozen` therefore satisfies the positive existential and fails the outer
 * `notExists`, so the full store leaves it out. `Reinstated` references only
 * the retirement: were it to reference the freeze as well, the freeze would
 * arrive as a predecessor of a delivered fact and hide the gap this file is
 * about.
 */
async function buildGraph(): Promise<Graph> {
    const store = new MemoryStore();
    const envelopes: FactEnvelope[] = [];
    const freezeOf: { [account: string]: FactReference } = {};
    const add = (fact: {}): FactReference => {
        const records = dehydrateFact(fact);
        envelopes.push(...records.map(fact => ({ fact, signatures: [] })));
        const last = records[records.length - 1];
        return { type: last.type, hash: last.hash };
    };

    const tenant = new Tenant("tenant-1");
    const tenantRef = add(tenant);

    const live = new Account(tenant, "live");
    add(live);
    add(new Mirror(live, "live-region"));

    const frozen = new Account(tenant, "frozen");
    add(frozen);
    freezeOf["frozen"] = add(new Freeze(frozen));
    const frozenMirror = new Mirror(frozen, "frozen-region");
    add(frozenMirror);
    add(new Reinstated(new Retired(frozenMirror)));

    await store.save(envelopes);
    return { store, tenant: tenantRef, freezeOf };
}

async function read(store: MemoryStore, start: FactReference, specification: Specification): Promise<string[]> {
    const results = await store.read([start], specification);
    return results.map(result => JSON.stringify(result.result)).sort();
}

async function deliveredFacts(graph: Graph, specification: Specification): Promise<FactReference[]> {
    const delivered: FactReference[] = [];
    for (const feed of buildFeeds(specification)) {
        const { tuples } = await graph.store.feed(feed, [graph.tenant], "");
        for (const tuple of tuples) {
            delivered.push(...tuple.facts);
        }
    }
    return delivered;
}

/**
 * Run every feed of the specification from the given, and return a store
 * holding exactly the facts those feeds delivered, with their predecessors.
 *
 * This is what a replica that subscribed to the specification ends up holding.
 */
async function replicaOf(graph: Graph, specification: Specification): Promise<MemoryStore> {
    const replica = new MemoryStore();
    await replica.save(await graph.store.load(await deliveredFacts(graph, specification)));
    return replica;
}

describe("feeds for a restoring branch inside a positive existential", () => {
    it("reassembles the result from the feeds", async () => {
        // The expectation is the full store's own answer, so this can only fail
        // when the feeds lose a fact.
        const graph = await buildGraph();
        const full = await read(graph.store, graph.tenant, servedAndUnfrozen.specification);
        const replica = await replicaOf(graph, servedAndUnfrozen.specification);
        const reassembled = await read(replica, graph.tenant, servedAndUnfrozen.specification);

        expect(reassembled).toEqual(full);
    });

    it("reassembles the result with the conditions in the other order", async () => {
        const graph = await buildGraph();
        const full = await read(graph.store, graph.tenant, servedAndUnfrozenSwapped.specification);
        const replica = await replicaOf(graph, servedAndUnfrozenSwapped.specification);
        const reassembled = await read(replica, graph.tenant, servedAndUnfrozenSwapped.specification);

        expect(reassembled).toEqual(full);
    });

    it("delivers the freeze of a restored account, in either order", async () => {
        // L6d for the one fact this defect drops: inserting it changes the rows
        // of the specification, so some feed has to carry it.
        const graph = await buildGraph();
        const expected = graph.freezeOf["frozen"];

        for (const specification of [servedAndUnfrozen.specification, servedAndUnfrozenSwapped.specification]) {
            const delivered = await deliveredFacts(graph, specification);
            expect(delivered.filter(fact =>
                fact.type === expected.type && fact.hash === expected.hash).length)
                .toBeGreaterThan(0);
        }
    });

    it("reassembles a projection reached past the existential", async () => {
        const graph = await buildGraph();
        const full = await read(graph.store, graph.tenant, servedAndUnfrozenWithRegions.specification);
        const replica = await replicaOf(graph, servedAndUnfrozenWithRegions.specification);
        const reassembled = await read(replica, graph.tenant, servedAndUnfrozenWithRegions.specification);

        expect(reassembled).toEqual(full);
    });

    it("keeps every feed well ordered and to a single level of negation", () => {
        // A continued feed carries a condition attached after the branch left
        // its match. It still has to bind every label it names, and still has
        // to fall one way as the graph grows, which is what one level of
        // negation buys (L6a).
        const specifications = [
            servedAndUnfrozen.specification,
            servedAndUnfrozenSwapped.specification,
            servedAndUnfrozenWithRegions.specification
        ];
        for (const specification of specifications) {
            for (const feed of buildFeeds(specification)) {
                expectWellOrdered(feed);
                skeletonOfSpecification(feed);
                for (const match of feed.matches) {
                    for (const condition of match.conditions.filter(isExistentialCondition)) {
                        for (const inner of condition.matches) {
                            expect(inner.conditions.filter(isExistentialCondition)).toEqual([]);
                        }
                    }
                }
            }
        }
    });

    it("authorizes every feed against a rule of the same shape, in either order", async () => {
        // The feeds this change adds reach the distribution engine too. A rule
        // that shares the specification has to authorize all of them.
        for (const specification of [servedAndUnfrozen, servedAndUnfrozenSwapped]) {
            const rules = new DistributionRules([]).share(specification).with(servicePrincipals);
            const store = new MemoryStore();
            const user = new User("---SERVICE-PRINCIPAL---");
            const tenant = new Tenant("tenant-1");
            const tenantRecords = dehydrateFact(tenant);
            await store.save([
                ...tenantRecords,
                ...dehydrateFact(user),
                ...dehydrateFact(new ServicePrincipal(tenant, user))
            ].map(fact => ({ fact, signatures: [] })));

            const engine = new DistributionEngine(rules, store, false);
            const givenLabel = specification.specification.given[0].label.name;
            const result = await engine.canDistributeToAll(
                buildFeeds(specification.specification),
                { [givenLabel]: tenantRecords[tenantRecords.length - 1] },
                dehydrateFact(user)[0]);

            expect(result.type).toBe("success");
        }
    });
});
