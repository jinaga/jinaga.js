import { DistributionRules, Jinaga, JinagaTest, LabelOf, MemoryStore, Specification, SpecificationOf, User, buildFeeds, buildModel, dehydrateFact } from "@src";
import { DistributionEngine } from "../../src/distribution/distribution-engine";
import { skeletonOfSpecification } from "../../src/specification/skeleton";
import { isExistentialCondition } from "../../src/specification/specification";
import { expectWellOrdered } from "./specificationTestHelpers";

// Issue #241: a `notExists` predicate that resolves a *predecessor* chain before
// it reaches a `successors` call was reported as denied by the distribution
// engine, even against a rule built from the literally identical function, while
// the same query restructured to walk successors end to end was authorized.
//
// The shape is not a limitation. It decomposes, it authorizes by both routes a
// rule can reach the engine, and it selects the same facts as the successors-only
// formulation. These tests pin all three so the shape cannot regress silently.
//
// What they do not cover is stated in the analysis document, §10.5: everything on
// the replicator side of the wire, which no in-repo test reaches.

// A rule and a query built from the same function must decompose to the same
// feeds by both routes a rule can travel: the TypeScript objects `JinagaTest`
// hands the engine, and the policy text the replicator parses. Skeleton equality
// is what `canDistributeTo` compares, and `skeletonOfSpecification` numbers facts
// and edges by traversal order, so this sees an ordering divergence that a diff
// of the two texts cannot.
function expectRuleToDecomposeLikeTheQuery(specification: Specification) {
    const rules = new DistributionRules([]).share(new SpecificationOf(specification) as any).withEveryone();
    const policyText = rules.saveToDescription();
    const loaded = DistributionRules.loadFromDescription(policyText);

    expect(loaded.saveToDescription()).toEqual(policyText);

    const querySkeletons = buildFeeds(specification).map(feed => skeletonOfSpecification(feed));
    expect(rules.rules[0].feeds.map(feed => skeletonOfSpecification(feed))).toEqual(querySkeletons);
    expect(loaded.rules[0].feeds.map(feed => skeletonOfSpecification(feed))).toEqual(querySkeletons);
}

// Run the engine itself rather than a query, so the verdict is read where it is
// decided. `viaPolicyText` selects the replicator's route: rule objects written
// out by `saveToDescription` and read back by the parser.
async function canDistribute(specification: Specification, given: any, viaPolicyText: boolean) {
    let rules: DistributionRules = new DistributionRules([]).share(new SpecificationOf(specification) as any).withEveryone();
    if (viaPolicyText) {
        rules = DistributionRules.loadFromDescription(rules.saveToDescription());
    }
    const store = new MemoryStore();
    const user = new User("---PRINCIPAL---");
    const givenRecords = dehydrateFact(given);
    await store.save([...dehydrateFact(user), ...givenRecords].map(fact => ({ fact, signatures: [] })));

    const engine = new DistributionEngine(rules, store, false);
    return await engine.canDistributeToAll(
        buildFeeds(specification),
        { [specification.given[0].label.name]: givenRecords[givenRecords.length - 1] },
        dehydrateFact(user)[0]);
}

function expectEveryFeedToBuild(specification: Specification) {
    const feeds = buildFeeds(specification);
    expect(feeds.length).toBeGreaterThan(0);
    for (const feed of feeds) {
        expectWellOrdered(feed);
        skeletonOfSpecification(feed);
    }
}

// "The Art of Immutable Architecture", chapter 12: a feed carries only path
// conditions and ONE level of negation, which is what keeps it append-only. A
// predecessor walk inside the predicate must not smuggle a second level in.
function expectSingleLevelOfNegation(specification: Specification) {
    for (const feed of buildFeeds(specification)) {
        for (const match of feed.matches) {
            for (const condition of match.conditions.filter(isExistentialCondition)) {
                for (const inner of condition.matches) {
                    expect(inner.conditions.filter(isExistentialCondition)).toEqual([]);
                }
            }
        }
    }
}

// Project each feed down to the fact type the query returns, and collect what
// the feeds between them deliver. A feed may over-deliver — the client's
// specification filters — but a fact the query matches and no feed carries is
// data the client can never see.
async function deliveredByFeeds(j: Jinaga, specification: Specification, factType: string, given: any): Promise<string[]> {
    const delivered = new Set<string>();
    for (const feed of buildFeeds(specification)) {
        const label = feed.matches.map(match => match.unknown).find(unknown => unknown.type === factType);
        if (!label) {
            continue;
        }
        const projected = new SpecificationOf<any, any>({ ...feed, projection: { type: "fact", label: label.name } });
        for (const row of await j.query(projected, given)) {
            delivered.add(j.hash(row));
        }
    }
    return [...delivered];
}

describe("predecessor traversal inside a notExists predicate", () => {
    describe("the minimal reproduction from issue #241", () => {
        class Tenant {
            static Type = "Example.Tenant" as const;
            type = Tenant.Type;
            constructor(public creator: User) { }
        }
        class Parent {
            static Type = "Example.Parent" as const;
            type = Parent.Type;
            constructor(public tenant: Tenant, public id: string) { }
        }
        class ParentDeleted {
            static Type = "Example.Parent.Deleted" as const;
            type = ParentDeleted.Type;
            constructor(public parent: Parent, public deletedAt: string) { }
        }
        class ParentRestored {
            static Type = "Example.Parent.Restored" as const;
            type = ParentRestored.Type;
            constructor(public deletion: ParentDeleted) { }
        }
        class Child {
            static Type = "Example.Child" as const;
            type = Child.Type;
            constructor(public parent: Parent, public id: string) { }
        }
        class Grandchild {
            static Type = "Example.Grandchild" as const;
            type = Grandchild.Type;
            constructor(public child: Child, public id: string) { }
        }

        const model = buildModel(b => b
            .type(User)
            .type(Tenant, x => x.predecessor("creator", User))
            .type(Parent, x => x.predecessor("tenant", Tenant))
            .type(ParentDeleted, x => x.predecessor("parent", Parent))
            .type(ParentRestored, x => x.predecessor("deletion", ParentDeleted))
            .type(Child, x => x.predecessor("parent", Parent))
            .type(Grandchild, x => x.predecessor("child", Child))
        );

        // The issue's "works" variant: every notExists predicate calls only
        // successors, and the predecessor walk happens outside any notExists.
        const viaSuccessors = model.given(Tenant).match(tenant =>
            tenant.successors(Parent, p => p.tenant)
                .notExists(parent => parent.successors(ParentDeleted, d => d.parent)
                    .notExists(d => d.successors(ParentRestored, r => r.deletion)))
                .selectMany(parent => parent.successors(Child, c => c.parent))
                .selectMany(child => child.successors(Grandchild, g => g.child)));

        // The issue's "fails" variant: the notExists predicate itself walks two
        // predecessor hops before reaching successors.
        const viaPredecessorNotExists = model.given(Tenant).match(tenant =>
            tenant.successors(Parent, p => p.tenant)
                .selectMany(parent => parent.successors(Child, c => c.parent))
                .selectMany(child => child.successors(Grandchild, g => g.child))
                .notExists(grandchild => grandchild.child.predecessor()
                    .selectMany(child => child.parent.predecessor()
                        .selectMany(parent => parent.successors(ParentDeleted, d => d.parent)
                            .notExists(d => d.successors(ParentRestored, r => r.deletion))))));

        async function populate(j: Jinaga) {
            const tenant = await j.fact(new Tenant(new User("---CREATOR---")));
            const state: { [name: string]: Grandchild } = {};
            for (const name of ["live", "deleted", "restored"]) {
                const parent = await j.fact(new Parent(tenant, name));
                if (name !== "live") {
                    const deletion = await j.fact(new ParentDeleted(parent, "2026-01-01T00:00:00Z"));
                    if (name === "restored") {
                        await j.fact(new ParentRestored(deletion));
                    }
                }
                const child = await j.fact(new Child(parent, name));
                state[name] = await j.fact(new Grandchild(child, name));
            }
            return { tenant, state };
        }

        it("builds a well ordered feed and a skeleton for every feed", () => {
            expectEveryFeedToBuild(viaPredecessorNotExists.specification);
        });

        it("keeps every feed to a single level of negation", () => {
            expectSingleLevelOfNegation(viaPredecessorNotExists.specification);
        });

        it("decomposes a rule to the same feeds by both routes", () => {
            expectRuleToDecomposeLikeTheQuery(viaPredecessorNotExists.specification);
        });

        it("authorizes the query against a rule built from the same function", async () => {
            const tenant = new Tenant(new User("---CREATOR---"));
            expect(await canDistribute(viaPredecessorNotExists.specification, tenant, false))
                .toEqual({ type: "success" });
        });

        it("authorizes it against a rule loaded from policy text", async () => {
            const tenant = new Tenant(new User("---CREATOR---"));
            expect(await canDistribute(viaPredecessorNotExists.specification, tenant, true))
                .toEqual({ type: "success" });
        });

        it("selects the same grandchildren as the successors-only formulation", async () => {
            const j = JinagaTest.create({
                model,
                // Both formulations are shared, because this test compares the two
                // result sets. That the predecessor form authorizes at all is
                // asserted against the engine above.
                distribution: d => d
                    .share(viaPredecessorNotExists).withEveryone()
                    .share(viaSuccessors).withEveryone()
            });
            const { tenant, state } = await populate(j);

            const selected = (await j.query(viaPredecessorNotExists, tenant)).map(g => j.hash(g)).sort();

            expect(selected).toEqual([j.hash(state.live), j.hash(state.restored)].sort());
            expect(selected).toEqual((await j.query(viaSuccessors, tenant)).map(g => j.hash(g)).sort());
        });

        it("carries every selected grandchild in a feed", async () => {
            const j = JinagaTest.create({ model });
            const { tenant, state } = await populate(j);

            const delivered = await deliveredByFeeds(j, viaPredecessorNotExists.specification, Grandchild.Type, tenant);

            expect(delivered).toContain(j.hash(state.live));
            expect(delivered).toContain(j.hash(state.restored));
        });
    });

    describe("the model the issue describes in production", () => {
        // Closer to the reporter's real model than the generalized reproduction
        // is, in the way that matters structurally: the notExists predicate walks
        // up a predecessor edge the query never walked down. `Invitation` is
        // reached through `code`, so `invitation.accessPath` binds an `AccessPath`
        // and an `Event` that appear nowhere else in the specification.
        class Tenant {
            static Type = "Example.Tenant" as const;
            type = Tenant.Type;
            constructor(public creator: User) { }
        }
        class Event {
            static Type = "Example.Event" as const;
            type = Event.Type;
            constructor(public tenant: Tenant, public id: string) { }

            static in(tenant: LabelOf<Tenant>) {
                return tenant.successors(Event, e => e.tenant)
                    .notExists(e => e.successors(EventDelete, d => d.event)
                        .notExists(d => d.successors(EventRestore, r => r.eventDelete)));
            }
        }
        class EventDelete {
            static Type = "Example.Event.Delete" as const;
            type = EventDelete.Type;
            constructor(public event: Event) { }
        }
        class EventRestore {
            static Type = "Example.Event.Restore" as const;
            type = EventRestore.Type;
            constructor(public eventDelete: EventDelete) { }
        }
        class AccessPath {
            static Type = "Example.AttendeeAccessPath" as const;
            type = AccessPath.Type;
            constructor(public event: Event, public id: string) { }
        }
        class InvitationCode {
            static Type = "Example.AttendeeInvitationCode" as const;
            type = InvitationCode.Type;
            constructor(public tenant: Tenant, public id: string) { }
        }
        class Invitation {
            static Type = "Example.AttendeeInvitation" as const;
            type = Invitation.Type;
            constructor(public code: InvitationCode, public accessPath: AccessPath) { }
        }

        const model = buildModel(b => b
            .type(User)
            .type(Tenant, x => x.predecessor("creator", User))
            .type(Event, x => x.predecessor("tenant", Tenant))
            .type(EventDelete, x => x.predecessor("event", Event))
            .type(EventRestore, x => x.predecessor("eventDelete", EventDelete))
            .type(AccessPath, x => x.predecessor("event", Event))
            .type(InvitationCode, x => x.predecessor("tenant", Tenant))
            .type(Invitation, x => x
                .predecessor("code", InvitationCode)
                .predecessor("accessPath", AccessPath))
        );

        // The reporter's original: two `.predecessor()` hops, each its own match.
        const viaPredecessorNotExists = model.given(Tenant).match(tenant =>
            tenant.successors(InvitationCode, c => c.tenant)
                .selectMany(code => code.successors(Invitation, i => i.code))
                .notExists(invitation => invitation.accessPath.predecessor()
                    .selectMany(accessPath => accessPath.event.predecessor()
                        .selectMany(event => event.successors(EventDelete, d => d.event)
                            .notExists(d => d.successors(EventRestore, r => r.eventDelete))))));

        // The same walk spelled compactly, as one path condition carrying two
        // roles rather than two matches carrying one each. It reaches a different
        // branch of `skeletonOfSpecification`, so it is pinned separately.
        const viaCompactPredecessorNotExists = model.given(Tenant).match(tenant =>
            tenant.successors(InvitationCode, c => c.tenant)
                .selectMany(code => code.successors(Invitation, i => i.code))
                .notExists(invitation => invitation.accessPath.event.predecessor()
                    .selectMany(event => event.successors(EventDelete, d => d.event)
                        .notExists(d => d.successors(EventRestore, r => r.eventDelete)))));

        // The restructuring the reporter says fixed it: successors end to end,
        // reusing the sibling specification that always distributed correctly.
        const viaSuccessors = model.given(Tenant).match(tenant =>
            Event.in(tenant)
                .selectMany(event => event.successors(AccessPath, p => p.event))
                .selectMany(accessPath => accessPath.successors(Invitation, i => i.accessPath)));

        async function populate(j: Jinaga) {
            const tenant = await j.fact(new Tenant(new User("---CREATOR---")));
            const state: { [name: string]: Invitation } = {};
            for (const name of ["live", "deleted", "restored"]) {
                const event = await j.fact(new Event(tenant, name));
                if (name !== "live") {
                    const deletion = await j.fact(new EventDelete(event));
                    if (name === "restored") {
                        await j.fact(new EventRestore(deletion));
                    }
                }
                const accessPath = await j.fact(new AccessPath(event, name));
                const code = await j.fact(new InvitationCode(tenant, name));
                state[name] = await j.fact(new Invitation(code, accessPath));
            }
            return { tenant, state };
        }

        for (const [spelling, specification] of [
            ["two matches", viaPredecessorNotExists],
            ["one two-role path condition", viaCompactPredecessorNotExists]
        ] as const) {
            describe(`spelled as ${spelling}`, () => {
                it("builds a well ordered feed and a skeleton for every feed", () => {
                    expectEveryFeedToBuild(specification.specification);
                });

                it("keeps every feed to a single level of negation", () => {
                    expectSingleLevelOfNegation(specification.specification);
                });

                it("decomposes a rule to the same feeds by both routes", () => {
                    expectRuleToDecomposeLikeTheQuery(specification.specification);
                });

                it("authorizes the query against a rule built from the same function", async () => {
                    const tenant = new Tenant(new User("---CREATOR---"));
                    expect(await canDistribute(specification.specification, tenant, false))
                        .toEqual({ type: "success" });
                });

                it("authorizes it against a rule loaded from policy text", async () => {
                    const tenant = new Tenant(new User("---CREATOR---"));
                    expect(await canDistribute(specification.specification, tenant, true))
                        .toEqual({ type: "success" });
                });

                it("selects the same invitations as the successors-only restructuring", async () => {
                    const j = JinagaTest.create({
                        model,
                        distribution: d => d
                            .share(specification).withEveryone()
                            .share(viaSuccessors).withEveryone()
                    });
                    const { tenant, state } = await populate(j);

                    const selected = (await j.query(specification, tenant)).map(i => j.hash(i)).sort();

                    expect(selected).toEqual([j.hash(state.live), j.hash(state.restored)].sort());
                    expect(selected).toEqual((await j.query(viaSuccessors, tenant)).map(i => j.hash(i)).sort());
                });

                it("carries every selected invitation in a feed", async () => {
                    const j = JinagaTest.create({ model });
                    const { tenant, state } = await populate(j);

                    const delivered = await deliveredByFeeds(j, specification.specification, Invitation.Type, tenant);

                    expect(delivered).toContain(j.hash(state.live));
                    expect(delivered).toContain(j.hash(state.restored));
                });
            });
        }
    });
});
