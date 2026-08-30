import { DistributionRules, JinagaTest, LabelOf, MemoryStore, SpecificationOf, User, buildFeeds, buildModel, dehydrateFact } from "@src";
import { DistributionEngine } from "../../src/distribution/distribution-engine";
import { skeletonOfSpecification } from "../../src/specification/skeleton";
import { isExistentialCondition } from "../../src/specification/specification";
import { expectWellOrdered } from "./specificationTestHelpers";

// Issue #242: a specification that combines two fact types in one top-level match
// block, each carrying its own `notExists`, and whose first `notExists` is itself
// nested one level deep (delete/restore).
//
// Two defects lived in `buildFeeds`:
//   D1  `buildExistentialCondition` dropped the nested `!E`, so the condition
//       attached to the ordinary feed read "no delete at all" instead of "no
//       un-restored delete". Facts under a restored entity were never delivered
//       and `query()` silently returned fewer rows.
//   D2  the restoring-feed projection pass attached the parent projection's
//       components to a feed that does not bind the labels those components
//       reference, producing a feed whose path condition names an unbound label.
//       `skeletonOfSpecification` then threw "Label u4 not found", surfacing as
//       HTTP 500 on /feeds.

class Tenant {
    static Type = "Tenant" as const;
    type = Tenant.Type;
    constructor(public identifier: string) { }
}

class Event {
    static Type = "Event" as const;
    type = Event.Type;
    constructor(public tenant: Tenant, public id: string) { }

    static in(tenant: LabelOf<Tenant>) {
        return tenant.successors(Event, event => event.tenant)
            .notExists(event => event.successors(EventDelete, d => d.event)
                .notExists(d => d.successors(EventRestore, r => r.eventDelete)));
    }
}

class EventDelete {
    static Type = "Event.Delete" as const;
    type = EventDelete.Type;
    constructor(public event: Event) { }
}

class EventRestore {
    static Type = "Event.Restore" as const;
    type = EventRestore.Type;
    constructor(public eventDelete: EventDelete) { }
}

class AttendeeAccessPath {
    static Type = "AttendeeAccessPath" as const;
    type = AttendeeAccessPath.Type;
    constructor(public event: Event, public code: string) { }

    static for(event: LabelOf<Event>) {
        return event.successors(AttendeeAccessPath, path => path.event);
    }

    static in(tenant: LabelOf<Tenant>) {
        return Event.in(tenant).selectMany(event => AttendeeAccessPath.for(event));
    }
}

class AccessPathConfigured {
    static Type = "AttendeeAccessPath.Configured" as const;
    type = AccessPathConfigured.Type;
    constructor(public accessPath: AttendeeAccessPath) { }

    static for(accessPath: LabelOf<AttendeeAccessPath>) {
        return accessPath.successors(AccessPathConfigured, c => c.accessPath);
    }
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
    .type(Event, x => x
        .predecessor("tenant", Tenant)
    )
    .type(EventDelete, x => x
        .predecessor("event", Event)
    )
    .type(EventRestore, x => x
        .predecessor("eventDelete", EventDelete)
    )
    .type(AttendeeAccessPath, x => x
        .predecessor("event", Event)
    )
    .type(AccessPathConfigured, x => x
        .predecessor("accessPath", AttendeeAccessPath)
    )
    .type(ServicePrincipal, x => x
        .predecessor("tenant", Tenant)
        .predecessor("user", User)
    )
);

const accessPathsToConfigure = model.given(Tenant).match(tenant =>
    AttendeeAccessPath.in(tenant)
        .notExists(accessPath => AccessPathConfigured.for(accessPath))
);

const servicePrincipals = model.given(Tenant).match(tenant => ServicePrincipal.usersOf(tenant));

// The shape from issue #242 comment 1: a composite `select()` inside a
// `selectMany` chain, three hops deep.
const accessPathsWithConfiguration = model.given(Tenant).match(tenant =>
    Event.in(tenant).selectMany(event =>
        AttendeeAccessPath.for(event).select(accessPath => ({
            accessPath,
            configured: AccessPathConfigured.for(accessPath)
        }))
    )
);

describe("feeds for nested notExists across two fact types", () => {
    it("keeps every feed well ordered", () => {
        for (const feed of buildFeeds(accessPathsToConfigure.specification)) {
            expectWellOrdered(feed);
            skeletonOfSpecification(feed);
        }
    });

    it("keeps every feed of a composite projection well ordered", () => {
        // Regression for "Label u4 not found. Known labels: p1, u1, u2, u3".
        for (const feed of buildFeeds(accessPathsWithConfiguration.specification)) {
            expectWellOrdered(feed);
            skeletonOfSpecification(feed);
        }
    });

    it("keeps the ordinary feed to a single level of negation", () => {
        // "The Art of Immutable Architecture", chapter 12: a feed carries only
        // path conditions and ONE level of negative existential condition. That
        // is what makes the feed append-only. A nested !E would let a restore
        // make the outer condition true again, reinserting a tuple behind a
        // peer's bookmark, and the peer would never see it.
        for (const feed of buildFeeds(accessPathsToConfigure.specification)) {
            for (const match of feed.matches) {
                for (const condition of match.conditions.filter(isExistentialCondition)) {
                    for (const inner of condition.matches) {
                        expect(inner.conditions.filter(isExistentialCondition)).toEqual([]);
                    }
                }
            }
        }
    });

    it("continues the restoring feed through the rest of the specification", () => {
        // The restoring feed is positive: its tuples contribute results, so it
        // must go on to match the labels the results are built from. Without
        // that continuation the access path of a restored event appears in no
        // feed at all.
        const restoringFeeds = buildFeeds(accessPathsToConfigure.specification)
            .filter(feed => feed.matches.some(match => match.unknown.type === EventRestore.Type));
        expect(restoringFeeds.length).toBeGreaterThan(0);
        expect(restoringFeeds.some(feed =>
            feed.matches.some(match => match.unknown.type === AttendeeAccessPath.Type))).toBe(true);
    });

    it("authorizes the specification against a rule of the same shape", async () => {
        const j = JinagaTest.create({
            model,
            user: new User("---SERVICE-PRINCIPAL---"),
            distribution: d => d
                .share(accessPathsToConfigure)
                .with(servicePrincipals)
        });
        const { userFact } = await j.login<User>();
        const tenant = await j.fact(new Tenant("tenant-1"));
        await j.fact(new ServicePrincipal(tenant, userFact));
        const event = await j.fact(new Event(tenant, "event-1"));
        await j.fact(new AttendeeAccessPath(event, "code-1"));

        const results = await j.query(accessPathsToConfigure, tenant);

        expect(results.length).toBe(1);
    });

    it("authorizes the specification against a rule loaded from policy text", async () => {
        // `JinagaTest` hands the engine the rule objects built here in
        // TypeScript. The replicator never sees those: it loads a policy *file*,
        // so its rule feeds come out of `saveToDescription` -> the parser. The
        // reporter of issue #242 diffed the two texts and found them identical,
        // yet was denied — so the text is not the only thing that has to agree.
        // What has to agree is the feeds each path decomposes to. Exercise the
        // parser path the replicator uses, against the same target the client
        // sends, at the level of the engine rather than end to end.
        const rules = new DistributionRules([]).share(accessPathsToConfigure).with(servicePrincipals);
        const policyText = rules.saveToDescription();
        const loaded = DistributionRules.loadFromDescription(policyText);

        // The text survives a round trip, so a policy file written by one
        // version and read by another describes the same rule.
        expect(loaded.saveToDescription()).toEqual(policyText);

        // And the rule decomposes to feeds skeleton-identical to the client's.
        // Skeleton equality is what `canDistributeTo` actually compares, and
        // `skeletonOfSpecification` assigns fact and edge indices by traversal
        // order, so this catches an ordering divergence between the two paths
        // that a text diff cannot see.
        const loadedSkeletons = loaded.rules[0].feeds.map(feed => skeletonOfSpecification(feed));
        const targetSkeletons = buildFeeds(accessPathsToConfigure.specification)
            .map(feed => skeletonOfSpecification(feed));
        expect(loadedSkeletons).toEqual(targetSkeletons);

        // Finally, the decision itself.
        const store = new MemoryStore();
        const user = new User("---SERVICE-PRINCIPAL---");
        const tenant = new Tenant("tenant-1");
        const tenantRecords = dehydrateFact(tenant);
        await store.save([
            ...tenantRecords,
            ...dehydrateFact(user),
            ...dehydrateFact(new ServicePrincipal(tenant, user))
        ].map(fact => ({ fact, signatures: [] })));

        const engine = new DistributionEngine(loaded, store, false);
        const givenLabel = accessPathsToConfigure.specification.given[0].label.name;
        const result = await engine.canDistributeToAll(
            buildFeeds(accessPathsToConfigure.specification),
            { [givenLabel]: tenantRecords[tenantRecords.length - 1] },
            dehydrateFact(user)[0]);

        expect(result.type).toBe("success");
    });

    it("delivers the access path of a restored event through a feed", async () => {
        const j = JinagaTest.create({ model });
        const tenant = await j.fact(new Tenant("tenant-1"));
        const event = await j.fact(new Event(tenant, "event-1"));
        const deletion = await j.fact(new EventDelete(event));
        await j.fact(new EventRestore(deletion));
        const accessPath = await j.fact(new AttendeeAccessPath(event, "code-1"));

        // A feed has no projection of its own. Project the access path out of
        // each feed that binds it, so we can see whether the feed's conditions
        // still admit the restored event.
        const delivered: string[] = [];
        for (const feed of buildFeeds(accessPathsToConfigure.specification)) {
            const label = feed.matches
                .map(match => match.unknown)
                .find(unknown => unknown.type === AttendeeAccessPath.Type);
            if (!label) {
                continue;
            }
            const projected = new SpecificationOf<Tenant, AttendeeAccessPath>({
                ...feed,
                projection: { type: "fact", label: label.name }
            });
            const rows = await j.query(projected, tenant);
            delivered.push(...rows.map(row => j.hash(row)));
        }

        expect(delivered).toContain(j.hash(accessPath));
    });
});
