import { DistributionRules, MemoryStore, SpecificationOf, SpecificationParser, buildFeeds, dehydrateFact } from "@src";
import { DistributionEngine } from "../../src/distribution/distribution-engine";
import { describeSpecification } from "../../src/specification/description";
import { Specification, isExistentialCondition } from "../../src/specification/specification";
import { wellFormedErrors } from "../../src/specification/specification-validation";
import { FactEnvelope, FactReference } from "../../src/storage";
import { cancelledAfterPositive, cancelledBySecond, cancelledTwice, cancelledWithGiven, flaggedDelete } from "../vectors/feed-cases";

// Issue #427: a restoring feed for one negative condition on an excluded fact
// kept that fact's other negative conditions. A delete is cancelled when any
// one of its negative conditions fails, so a delete that is both restored and
// undone was in neither restoring feed, and no feed delivered the event's name.
//
// The odd-parity side of `addConditions`. The even-parity side, where a
// restoring branch restores a result and does carry the conditions still
// waiting on it (#368), is covered by siblingConditionFeedSpec.ts.

function parse(text: string): Specification {
    const parser = new SpecificationParser(text);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

interface Graph {
    store: MemoryStore;
    tenant: FactReference;
}

/**
 * One tenant, one event with a name, and a delete of that event. Each entry in
 * `onDelete` names a fact to add: `undo`, `restore`, `revokedRestore` (a
 * restore with a revoke), `flag`, `clearedFlag` (a flag with a clear) or
 * `approval`.
 */
async function buildGraph(onDelete: string[]): Promise<Graph> {
    const envelopes: FactEnvelope[] = [];
    const add = (fact: {}) => {
        envelopes.push(...dehydrateFact(fact).map(fact => ({ fact, signatures: [] })));
    };
    const tenant = { type: "Tenant", identifier: "tenant-1" };
    const event = { type: "Event", tenant, id: "event-1" };
    const deletion = { type: "Delete", event };
    add({ type: "Name", event, value: "Launch" });
    add(deletion);
    for (const kind of onDelete) {
        if (kind === "undo") add({ type: "Undo", delete: deletion });
        if (kind === "restore") add({ type: "Restore", delete: deletion });
        if (kind === "revokedRestore") add({ type: "Revoke", restore: { type: "Restore", delete: deletion } });
        if (kind === "approval") add({ type: "Approval", delete: deletion });
        if (kind === "flag") add({ type: "Flag", delete: deletion });
        if (kind === "clearedFlag") add({ type: "Clear", flag: { type: "Flag", delete: deletion } });
    }
    const store = new MemoryStore();
    await store.save(envelopes);
    const records = dehydrateFact(tenant);
    const tenantRecord = records[records.length - 1];
    return { store, tenant: { type: tenantRecord.type, hash: tenantRecord.hash } };
}

/**
 * Run every feed of the specification from the tenant, and return a store
 * holding exactly what those feeds delivered, with their predecessors: what a
 * replica that subscribed to the specification ends up holding.
 */
async function replicaOf(graph: Graph, specification: Specification): Promise<MemoryStore> {
    const delivered: FactReference[] = [graph.tenant];
    for (const feed of buildFeeds(specification)) {
        const { tuples } = await graph.store.feed(feed, [graph.tenant], "");
        for (const tuple of tuples) {
            delivered.push(...tuple.facts);
        }
    }
    const replica = new MemoryStore();
    await replica.save(await graph.store.load(delivered));
    return replica;
}

async function readRows(store: MemoryStore, start: FactReference, specification: Specification): Promise<string[]> {
    const results = await store.read([start], specification);
    return results.map(result => JSON.stringify(Object.fromEntries(
        Object.entries(result.tuple).map(([label, fact]) => [label, fact.hash])))).sort();
}

async function expectReplicaReadsWhatFullStoreReads(onDelete: string[], specification: Specification, visible = true) {
    const graph = await buildGraph(onDelete);
    const full = await readRows(graph.store, graph.tenant, specification);
    const replica = await replicaOf(graph, specification);
    const reassembled = await readRows(replica, graph.tenant, specification);

    // The full store's answer is pinned, so the comparison cannot pass by
    // both stores being wrong the same way.
    expect(full.length).toBe(visible ? 1 : 0);
    expect(reassembled).toEqual(full);
}

describe("restoring feeds for a fact with several negative conditions", () => {
    it("reassembles an event whose delete is both restored and undone", async () => {
        await expectReplicaReadsWhatFullStoreReads(["restore", "undo"], cancelledTwice);
    });

    it("reassembles an event whose delete is undone and whose restore is revoked", async () => {
        await expectReplicaReadsWhatFullStoreReads(["revokedRestore", "undo"], cancelledBySecond);
    });

    it("still reassembles an event whose delete is cancelled only once", async () => {
        for (const onDelete of [["restore"], ["undo"]]) {
            await expectReplicaReadsWhatFullStoreReads(onDelete, cancelledTwice);
        }
        await expectReplicaReadsWhatFullStoreReads(["undo"], cancelledBySecond);
    });

    it("reassembles an approved delete that is both restored and undone", async () => {
        await expectReplicaReadsWhatFullStoreReads(["approval", "restore", "undo"], cancelledAfterPositive);
        await expectReplicaReadsWhatFullStoreReads(["approval", "restore"], cancelledAfterPositive);
        await expectReplicaReadsWhatFullStoreReads(["approval"], cancelledAfterPositive, false);
    });

    it("reassembles an event whose delete is undone and whose flag is cleared", async () => {
        // The canceller on the flag and the canceller on the delete both hold.
        await expectReplicaReadsWhatFullStoreReads(["clearedFlag", "undo"], flaggedDelete);
    });

    it("reassembles every combination of flag, clear and undo", async () => {
        await expectReplicaReadsWhatFullStoreReads([], flaggedDelete);
        await expectReplicaReadsWhatFullStoreReads(["flag"], flaggedDelete, false);
        await expectReplicaReadsWhatFullStoreReads(["clearedFlag"], flaggedDelete);
        await expectReplicaReadsWhatFullStoreReads(["undo"], flaggedDelete);
        await expectReplicaReadsWhatFullStoreReads(["flag", "undo"], flaggedDelete);
        await expectReplicaReadsWhatFullStoreReads(["clearedFlag", "undo"], flaggedDelete);
    });

    it("restores through the clear and through the undo with no filter on the flagged level", () => {
        const restoring = buildFeeds(flaggedDelete).filter(feed =>
            feed.matches.some(m => m.unknown.name === "d") &&
            feed.matches.some(m => m.unknown.name === "n"));

        expect(restoring.map(feed => feed.matches.map(m => m.unknown.name)).sort())
            .toEqual([["e", "d", "y", "u", "n"], ["e", "d", "y", "z", "n"]]);
        for (const feed of restoring) {
            for (const match of feed.matches) {
                expect(match.conditions.filter(isExistentialCondition)).toEqual([]);
            }
        }
    });

    it("restores through the restore and through the undo with no filter on the delete", () => {
        const feeds = buildFeeds(cancelledTwice).map(feed => describeSpecification(feed, 0));
        const restoringFeed = (canceller: string) => describeSpecification(parse(`
            (t: Tenant) {
                e: Event [
                    e->tenant: Tenant = t
                ]
                d: Delete [
                    d->event: Event = e
                ]
                ${canceller}
                n: Name [
                    n->event: Event = e
                ]
            }
        `), 0);

        expect(feeds).toContain(restoringFeed("x: Restore [ x->delete: Delete = d ]"));
        expect(feeds).toContain(restoringFeed("u: Undo [ u->delete: Delete = d ]"));
    });

    it("keeps a flattened positive condition, and nothing else, on a restoring feed", () => {
        // The restoring feeds are the ones that walk through the delete and go
        // on to the name.
        const restoring = buildFeeds(cancelledAfterPositive).filter(feed =>
            feed.matches.some(m => m.unknown.name === "d") &&
            feed.matches.some(m => m.unknown.name === "n"));

        expect(restoring.map(feed => feed.matches.map(m => m.unknown.name)).sort())
            .toEqual([["e", "d", "a", "u", "n"], ["e", "d", "a", "x", "n"]]);
        for (const feed of restoring) {
            for (const match of feed.matches) {
                expect(match.conditions.filter(isExistentialCondition)).toEqual([]);
            }
        }
    });

    it("builds only well-formed feeds", () => {
        for (const specification of [cancelledTwice, cancelledBySecond, cancelledWithGiven, flaggedDelete, cancelledAfterPositive]) {
            for (const feed of buildFeeds(specification)) {
                expect(wellFormedErrors(feed)).toEqual([]);
            }
        }
    });

    it("authorizes every feed against a rule that shares the specification", async () => {
        // Rule and target feeds both come from buildFeeds, so they move together.
        // Check it rather than assume it.
        for (const specification of [cancelledTwice, cancelledBySecond, flaggedDelete, cancelledAfterPositive]) {
            const rules = new DistributionRules([])
                .share(new SpecificationOf<unknown, unknown>(specification))
                .withEveryone();
            const store = new MemoryStore();
            const tenantRecords = dehydrateFact({ type: "Tenant", identifier: "tenant-1" });
            await store.save(tenantRecords.map(fact => ({ fact, signatures: [] })));

            const engine = new DistributionEngine(rules, store, false);
            const result = await engine.canDistributeToAll(
                buildFeeds(specification),
                { t: tenantRecords[tenantRecords.length - 1] },
                null);

            expect(result.type).toBe("success");
        }
    });
});
