import { DistributionRules, MemoryStore, Specification, SpecificationOf, SpecificationParser, buildFeeds, describeSpecification, wellFormedErrors } from "@src";
import { FactEnvelope, FactReference } from "../../src/storage";
import { eventsWithoutApprovedDelete, eventsWithoutRevokedApprovedDelete, eventsWithoutUnrevokedApprovedDelete, randomTwo } from "../vectors/feed-cases";

// The specifications these tests pass to `buildFeeds` are written in
// `test/vectors/feed-cases.ts`, which is also where `npm run vectors` reads
// them from (#387).
//
// Issue #425: `buildExistentialCondition` builds the filter a negative
// existential condition puts on the main feed. When one of that condition's
// matches held a positive existential condition, the recursive call was handed
// the inner positive condition as its accumulator. That accumulator already
// held the inner matches, so they were added a second time, and it carried
// `exists: true`. The result replaced the outer accumulator, dropping the outer
// matches. So `!E { d [ E { a } ] }` became `E { a, a }`: the wrong polarity,
// `a` declared twice, and a join on `d`, which nothing in the feed binds.
//
// The filter is the negative condition's level: its matches with every
// positive condition inside them joined in, path conditions only.

function parse(text: string): Specification {
    const parser = new SpecificationParser(text);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

// A graph: facts by id, each with its type and predecessors by role.
interface GraphFact {
    id: number;
    type: string;
    predecessors: { role: string; id: number }[];
}

function refOf(graph: GraphFact[], id: number): FactReference {
    const fact = graph.find(f => f.id === id)!;
    return { type: fact.type, hash: `h${id}` };
}

async function storeOf(graph: GraphFact[], ids: Set<number>): Promise<MemoryStore> {
    const store = new MemoryStore();
    const envelopes: FactEnvelope[] = graph.filter(f => ids.has(f.id)).map(f => {
        const predecessors: { [role: string]: FactReference[] } = {};
        for (const p of f.predecessors) {
            (predecessors[p.role] ??= []).push(refOf(graph, p.id));
        }
        return { fact: { type: f.type, hash: `h${f.id}`, predecessors, fields: {} }, signatures: [] };
    });
    await store.save(envelopes);
    return store;
}

function closure(graph: GraphFact[], ids: number[]): Set<number> {
    const result = new Set<number>();
    const visit = (id: number) => {
        if (result.has(id)) return;
        result.add(id);
        for (const p of graph.find(f => f.id === id)!.predecessors) visit(p.id);
    };
    ids.forEach(visit);
    return result;
}

const idOf = (reference: FactReference) => Number(reference.hash.slice(1));

/**
 * Run every feed of the specification against a store holding the whole graph,
 * then build a replica from what the feeds delivered, the givens and all their
 * predecessors. Return the rows the full store and the replica each read.
 */
async function readFullAndReplica(specification: Specification, graph: GraphFact[], givens: { [label: string]: number }, rowLabel: string) {
    const full = await storeOf(graph, new Set(graph.map(f => f.id)));
    const start = (spec: Specification) => spec.given.map(g => refOf(graph, givens[g.label.name]));

    const delivered: number[] = [];
    for (const feed of buildFeeds(specification)) {
        const { tuples } = await full.feed(feed, start(feed), "");
        for (const tuple of tuples) delivered.push(...tuple.facts.map(idOf));
    }

    const replica = await storeOf(graph, closure(graph, [...delivered, ...Object.values(givens)]));
    const rows = async (store: MemoryStore) =>
        (await store.read(start(specification), specification))
            .map(r => idOf(r.tuple[rowLabel]))
            .sort((a, b) => a - b);
    return { full: await rows(full), replica: await rows(replica) };
}

describe("feeds of a positive condition inside a negative one", () => {
    it("filters the main feed by the negative condition's level", () => {
        const feeds = buildFeeds(eventsWithoutApprovedDelete).map(feed => describeSpecification(feed, 0).trim());

        expect(feeds).toEqual([
            describeSpecification(parse(`
                (t: Tenant) {
                    e: Event [
                        e->tenant: Tenant = t
                    ]
                    d: Delete [
                        d->event: Event = e
                    ]
                    a: Approval [
                        a->delete: Delete = d
                    ]
                }`), 0).trim(),
            describeSpecification(parse(`
                (t: Tenant) {
                    e: Event [
                        e->tenant: Tenant = t
                        !E {
                            d: Delete [
                                d->event: Event = e
                            ]
                            a: Approval [
                                a->delete: Delete = d
                            ]
                        }
                    ]
                }`), 0).trim()
        ]);
    });

    it("builds only well-formed feeds", () => {
        for (const feed of buildFeeds(eventsWithoutApprovedDelete)) {
            expect(wellFormedErrors(feed)).toEqual([]);
        }
    });

    it("reads every feed from a memory store", async () => {
        const graph: GraphFact[] = [
            { id: 0, type: "Tenant", predecessors: [] },
            { id: 1, type: "Event", predecessors: [{ role: "tenant", id: 0 }] }
        ];
        const store = await storeOf(graph, new Set([0, 1]));
        const tenant = refOf(graph, 0);

        for (const feed of buildFeeds(eventsWithoutApprovedDelete)) {
            await expect(store.feed(feed, [tenant], "")).resolves.toBeDefined();
        }
    });

    it("lets a share rule over the specification build", () => {
        expect(() => new DistributionRules([])
            .share(new SpecificationOf(eventsWithoutApprovedDelete))
            .withEveryone()
        ).not.toThrow();
    });

    it("lets a replica of the feeds read the events without an approved delete", async () => {
        // Event 1 has a delete with no approval; event 3 has an approved delete.
        const graph: GraphFact[] = [
            { id: 0, type: "Tenant", predecessors: [] },
            { id: 1, type: "Event", predecessors: [{ role: "tenant", id: 0 }] },
            { id: 2, type: "Delete", predecessors: [{ role: "event", id: 1 }] },
            { id: 3, type: "Event", predecessors: [{ role: "tenant", id: 0 }] },
            { id: 4, type: "Delete", predecessors: [{ role: "event", id: 3 }] },
            { id: 5, type: "Approval", predecessors: [{ role: "delete", id: 4 }] }
        ];

        const { full, replica } = await readFullAndReplica(eventsWithoutApprovedDelete, graph, { t: 0 }, "e");

        expect(full).toEqual([1]);
        expect(replica).toEqual(full);
    });

    // One level deeper: the approval itself carries a condition on a
    // revocation. A positive one joins the level too; a negative one stays out
    // of the filter and branches a restoring feed instead.
    const deeperGraph: GraphFact[] = [
        { id: 0, type: "Tenant", predecessors: [] },
        // No delete.
        { id: 1, type: "Event", predecessors: [{ role: "tenant", id: 0 }] },
        // An unapproved delete.
        { id: 2, type: "Event", predecessors: [{ role: "tenant", id: 0 }] },
        { id: 3, type: "Delete", predecessors: [{ role: "event", id: 2 }] },
        // An approved delete whose approval is not revoked.
        { id: 4, type: "Event", predecessors: [{ role: "tenant", id: 0 }] },
        { id: 5, type: "Delete", predecessors: [{ role: "event", id: 4 }] },
        { id: 6, type: "Approval", predecessors: [{ role: "delete", id: 5 }] },
        // An approved delete whose approval is revoked.
        { id: 7, type: "Event", predecessors: [{ role: "tenant", id: 0 }] },
        { id: 8, type: "Delete", predecessors: [{ role: "event", id: 7 }] },
        { id: 9, type: "Approval", predecessors: [{ role: "delete", id: 8 }] },
        { id: 10, type: "Revocation", predecessors: [{ role: "approval", id: 9 }] }
    ];

    const revocationCases: [string, Specification, string[], number[]][] = [
        ["positive", eventsWithoutRevokedApprovedDelete, ["d", "a", "r"], [1, 2, 4]],
        ["negative", eventsWithoutUnrevokedApprovedDelete, ["d", "a"], [1, 2, 7]]
    ];

    it.each(revocationCases)("handles a %s condition inside the positive one", async (_name, specification, filterLabels, expectedRows) => {
        const feeds = buildFeeds(specification);
        for (const feed of feeds) {
            expect(wellFormedErrors(feed)).toEqual([]);
        }

        // The main feed walks only the events, filtered by the level.
        const main = feeds.find(feed => feed.matches.length === 1)!;
        const filter = main.matches[0].conditions.find(c => c.type === "existential")!;
        expect(filter).toMatchObject({ exists: false });
        expect(filter.type === "existential" && filter.matches.map(m => m.unknown.name)).toEqual(filterLabels);

        const { full, replica } = await readFullAndReplica(specification, deeperGraph, { t: 0 }, "e");
        expect(full).toEqual(expectedRows);
        expect(replica).toEqual(full);
    });

    it("lets a replica read a negative condition nested in the excluded fact's own match", async () => {
        // The shape of jinaga-spec's vector feeds/random-2: the excluded fact
        // e1715 carries its own negative condition, and that one holds a
        // positive condition, `!E { e1718 [ E { e1719 } ] }`. `!E { e1717 }`
        // joins only the given, not e1716, so until the parser's anchoring
        // rule was removed this had to be built as an object.
        const graph: GraphFact[] = [
            { id: 0, type: "R", predecessors: [] },
            { id: 1, type: "A", predecessors: [{ role: "r", id: 0 }] },
            { id: 2, type: "B", predecessors: [{ role: "r", id: 0 }, { role: "r", id: 0 }] },
            { id: 3, type: "A", predecessors: [{ role: "b", id: 2 }, { role: "a", id: 1 }] },
            { id: 4, type: "A", predecessors: [{ role: "a", id: 1 }] },
            { id: 5, type: "B", predecessors: [{ role: "r", id: 0 }, { role: "a", id: 4 }] },
            { id: 6, type: "C", predecessors: [{ role: "b", id: 2 }] },
            { id: 7, type: "C", predecessors: [{ role: "a", id: 1 }] }
        ];

        for (const feed of buildFeeds(randomTwo)) {
            expect(wellFormedErrors(feed)).toEqual([]);
        }

        const { full, replica } = await readFullAndReplica(randomTwo, graph, { p1: 0, p2: 3 }, "u1");

        expect(full).toEqual([2, 5]);
        expect(replica).toEqual(full);
    });
});
