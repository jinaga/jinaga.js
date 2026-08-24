import { JinagaTest, LabelOf, SpecificationOf, User, buildFeeds, buildModel } from "@src";
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
                .with(model.given(Tenant).match(tenant => ServicePrincipal.usersOf(tenant)))
        });
        const { userFact } = await j.login<User>();
        const tenant = await j.fact(new Tenant("tenant-1"));
        await j.fact(new ServicePrincipal(tenant, userFact));
        const event = await j.fact(new Event(tenant, "event-1"));
        await j.fact(new AttendeeAccessPath(event, "code-1"));

        const results = await j.query(accessPathsToConfigure, tenant);

        expect(results.length).toBe(1);
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
