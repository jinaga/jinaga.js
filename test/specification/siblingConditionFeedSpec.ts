import { DistributionRules, LabelOf, MemoryStore, User, buildFeeds, buildModel, dehydrateFact } from "@src";
import { DistributionEngine } from "../../src/distribution/distribution-engine";
import { skeletonOfSpecification } from "../../src/specification/skeleton";
import { Specification, isExistentialCondition } from "../../src/specification/specification";
import { FactEnvelope, FactReference } from "../../src/storage";
import { expectWellOrdered } from "./specificationTestHelpers";

// Issue #368: `addMatches` handed a restoring branch only the matches that
// follow the current one. The existential conditions still waiting on the
// *current* match were left behind, so no feed delivered the facts those
// conditions read for a restored entity.

class Tenant {
    static Type = "Tenant" as const;
    type = Tenant.Type;
    constructor(public identifier: string) { }
}

class Account {
    static Type = "Account" as const;
    type = Account.Type;
    constructor(public tenant: Tenant, public identifier: string) { }
}

class Freeze {
    static Type = "Account.Freeze" as const;
    type = Freeze.Type;
    constructor(public account: Account) { }
}

class Unfreeze {
    static Type = "Account.Unfreeze" as const;
    type = Unfreeze.Type;
    constructor(public freeze: Freeze) { }
}

class Mirror {
    static Type = "Account.Mirror" as const;
    type = Mirror.Type;
    constructor(public account: Account, public region: string) { }
}

class Retired {
    static Type = "Account.Mirror.Retired" as const;
    type = Retired.Type;
    constructor(public mirror: Mirror) { }
}

class ServicePrincipal {
    static Type = "ServicePrincipal" as const;
    type = ServicePrincipal.Type;
    constructor(public tenant: Tenant, public user: User) { }

    static usersOf(tenant: LabelOf<Tenant>) {
        return tenant.successors(ServicePrincipal, sp => sp.tenant)
            .selectMany(sp => sp.user.predecessor());
    }
}

const model = buildModel(b => b
    .type(User)
    .type(Tenant)
    .type(Account, x => x
        .predecessor("tenant", Tenant)
    )
    .type(Freeze, x => x
        .predecessor("account", Account)
    )
    .type(Unfreeze, x => x
        .predecessor("freeze", Freeze)
    )
    .type(Mirror, x => x
        .predecessor("account", Account)
    )
    .type(Retired, x => x
        .predecessor("mirror", Mirror)
    )
    .type(ServicePrincipal, x => x
        .predecessor("tenant", Tenant)
        .predecessor("user", User)
    )
);

// A freeze that has not been undone. Nested one level deep, so the branch that
// follows it lands on even parity and is a restoring feed.
const unrestoredFreeze = (a: LabelOf<Account>) => a.successors(Freeze, f => f.account)
    .notExists(f => f.successors(Unfreeze, u => u.freeze));

// A mirror that has not been retired. The same shape, as the sibling condition.
const currentMirror = (a: LabelOf<Account>) => a.successors(Mirror, m => m.account)
    .notExists(m => m.successors(Retired, r => r.mirror));

// Live accounts with no current mirror, in each of the two orders the two
// conditions can be written in. The order carries no meaning, so both have to
// produce feeds that carry the same facts.
const needsMirror = model.given(Tenant).match(tenant =>
    tenant.successors(Account, a => a.tenant)
        .notExists(a => unrestoredFreeze(a))
        .notExists(a => currentMirror(a))
        .select(a => a.identifier)
);

const needsMirrorSwapped = model.given(Tenant).match(tenant =>
    tenant.successors(Account, a => a.tenant)
        .notExists(a => currentMirror(a))
        .notExists(a => unrestoredFreeze(a))
        .select(a => a.identifier)
);

const servicePrincipals = model.given(Tenant).match(tenant => ServicePrincipal.usersOf(tenant));

interface Graph {
    store: MemoryStore;
    tenant: FactReference;
    mirrorOf: { [account: string]: FactReference };
}

/**
 * One tenant with three accounts, each carrying one mirror.
 *
 *   live      no freeze at all
 *   restored  a freeze, undone by an unfreeze
 *   frozen    a freeze that stands
 *
 * `retireFrozenMirror` adds a `Retired` to `frozen`'s mirror. `Retired`
 * references only the mirror: were it to reference the freeze as well, the
 * freeze would arrive as a predecessor of a delivered fact and hide the gap
 * this file is about.
 */
async function buildGraph(retireFrozenMirror: boolean): Promise<Graph> {
    const store = new MemoryStore();
    const envelopes: FactEnvelope[] = [];
    const mirrorOf: { [account: string]: FactReference } = {};
    const add = (fact: {}): FactReference => {
        const records = dehydrateFact(fact);
        envelopes.push(...records.map(fact => ({ fact, signatures: [] })));
        const last = records[records.length - 1];
        return { type: last.type, hash: last.hash };
    };

    const tenant = new Tenant("tenant-1");
    const tenantRef = add(tenant);

    for (const identifier of ["live", "restored", "frozen"]) {
        const account = new Account(tenant, identifier);
        add(account);
        const mirror = new Mirror(account, `${identifier}-region`);
        mirrorOf[identifier] = add(mirror);
        if (identifier === "restored") {
            add(new Unfreeze(new Freeze(account)));
        }
        if (identifier === "frozen") {
            add(new Freeze(account));
            if (retireFrozenMirror) {
                add(new Retired(mirror));
            }
        }
    }

    await store.save(envelopes);
    return { store, tenant: tenantRef, mirrorOf };
}

async function readIdentifiers(store: MemoryStore, start: FactReference, specification: Specification): Promise<string[]> {
    const results = await store.read([start], specification);
    return results.map(result => result.result as string).sort();
}

/**
 * Run every feed of the specification from the given, and return a store
 * holding exactly the facts those feeds delivered, with their predecessors.
 *
 * This is what a replica that subscribed to the specification ends up holding.
 */
async function replicaOf(graph: Graph, specification: Specification): Promise<MemoryStore> {
    const delivered: FactReference[] = [];
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

describe("feeds for a restoring branch followed by a sibling condition", () => {
    it("reassembles the result from the feeds", async () => {
        // The expectation is the full store's own answer, so this can only fail
        // when the feeds lose a fact.
        const graph = await buildGraph(false);
        const full = await readIdentifiers(graph.store, graph.tenant, needsMirror.specification);
        const replica = await replicaOf(graph, needsMirror.specification);
        const reassembled = await readIdentifiers(replica, graph.tenant, needsMirror.specification);

        expect(reassembled).toEqual(full);
    });

    it("reassembles the result with the conditions in the other order", async () => {
        // `frozen`'s mirror is retired, so the freeze the feeds drop is the
        // difference between excluded and returned.
        const graph = await buildGraph(true);
        const full = await readIdentifiers(graph.store, graph.tenant, needsMirrorSwapped.specification);
        const replica = await replicaOf(graph, needsMirrorSwapped.specification);
        const reassembled = await readIdentifiers(replica, graph.tenant, needsMirrorSwapped.specification);

        expect(reassembled).toEqual(full);
    });

    it("delivers the mirror of a restored account, in either order", async () => {
        // L6d for the one fact this defect drops: inserting it changes the rows
        // of the specification, so some feed has to carry it.
        const graph = await buildGraph(false);
        const expected = graph.mirrorOf["restored"];

        for (const specification of [needsMirror.specification, needsMirrorSwapped.specification]) {
            const delivered = await deliveredFacts(graph, specification);
            expect(delivered.filter(fact =>
                fact.type === expected.type && fact.hash === expected.hash).length)
                .toBeGreaterThan(0);
        }
    });

    it("keeps every feed well ordered and to a single level of negation", () => {
        // A continued feed carries a condition attached after the branch left
        // its match. It still has to bind every label it names, and still has
        // to fall one way as the graph grows, which is what one level of
        // negation buys (L6a).
        for (const specification of [needsMirror.specification, needsMirrorSwapped.specification]) {
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
        for (const specification of [needsMirror, needsMirrorSwapped]) {
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
