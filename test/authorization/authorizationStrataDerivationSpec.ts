import { Specification, User, assertWellFormed, buildModel, splitBeforeFirstSuccessor } from "@src";
import { tailDependencies } from "../../src/authorization/authorization-strata";

// Issue #396, criterion 7. The strata are derived from the rules rather than
// configured, so the edges a real specification yields have to name exactly the
// types its tail reads outside every negative existential condition. A type
// read beneath one yields no edge: nothing beneath a negative condition sees
// the facts of the batch, so no verdict in the batch depends on it. The
// simulation in the issue abstracts a tail's join to a relation; this suite
// pins the extraction from an actual specification.

class Tenant {
    static Type = "D.Tenant";
    type = Tenant.Type;
    constructor(
        public creator: User
    ) { }
}

class Attendee {
    static Type = "D.Attendee";
    type = Attendee.Type;
    constructor(
        public user: User,
        public tenant: Tenant
    ) { }
}

class Confirmation {
    static Type = "D.Confirmation";
    type = Confirmation.Type;
    constructor(
        public attendee: Attendee
    ) { }
}

class Withdrawal {
    static Type = "D.Withdrawal";
    type = Withdrawal.Type;
    constructor(
        public attendee: Attendee
    ) { }
}

class Rejoin {
    static Type = "D.Rejoin";
    type = Rejoin.Type;
    constructor(
        public withdrawal: Withdrawal
    ) { }
}

class Answer {
    static Type = "D.Answer";
    type = Answer.Type;
    constructor(
        public tenant: Tenant,
        public author: User
    ) { }
}

const model = buildModel(b => b
    .type(User)
    .type(Tenant, x => x
        .predecessor("creator", User))
    .type(Attendee, x => x
        .predecessor("user", User)
        .predecessor("tenant", Tenant))
    .type(Confirmation, x => x
        .predecessor("attendee", Attendee))
    .type(Withdrawal, x => x
        .predecessor("attendee", Attendee))
    .type(Rejoin, x => x
        .predecessor("withdrawal", Withdrawal))
    .type(Answer, x => x
        .predecessor("tenant", Tenant)
        .predecessor("author", User))
);

/** The distinct types a rule's tail yields an edge from. */
function tailEdges(type: string, specification: Specification): string[] {
    const { tail } = splitBeforeFirstSuccessor(assertWellFormed(specification, "A rule under test"));
    if (tail === undefined) {
        return [];
    }
    const edges = tailDependencies(type, tail);
    // Every edge runs into the type the rule governs.
    expect(edges.every(edge => edge.to === type)).toBe(true);
    // Every edge from a tail is a rule edge, which is what makes a component
    // recursive; a predecessor role contributes the other kind.
    expect(edges.every(edge => edge.fromRule)).toBe(true);
    return sorted(edges.map(edge => edge.from).filter((from, index, all) => all.indexOf(from) === index));
}

function sorted(types: string[]) {
    return types.slice().sort((a, b) => a.localeCompare(b));
}

describe("The edges a rule's tail yields", () => {
    it("is empty for a rule that only walks predecessors", () => {
        // The whole specification is the head, so nothing is read from the
        // store and the verdict on this type depends on no other.
        const specification = model.given(Attendee)
            .match(att => att.user.predecessor())
            .specification;

        expect(tailEdges(Attendee.Type, specification)).toEqual([]);
    });

    it("names the type a successor walk reads, and the roles it walks down", () => {
        // An answer is authorized for the user of every attendee of its tenant.
        const specification = model.given(Answer)
            .match((ans, facts) => facts.ofType(Attendee)
                .join(att => att.tenant, ans.tenant)
                .selectMany(att => facts.ofType(User)
                    .join(u => u, att.user)))
            .specification;

        expect(tailEdges(Answer.Type, specification)).toEqual(sorted([
            Attendee.Type,
            Tenant.Type,
            User.Type
        ]));
    });

    it("names the types a positive existential condition reads", () => {
        const specification = model.given(Answer)
            .match((ans, facts) => facts.ofType(Attendee)
                .join(att => att.tenant, ans.tenant)
                .exists(att => facts.ofType(Confirmation)
                    .join(c => c.attendee, att))
                .selectMany(att => facts.ofType(User)
                    .join(u => u, att.user)))
            .specification;

        expect(tailEdges(Answer.Type, specification)).toEqual(sorted([
            Attendee.Type,
            Confirmation.Type,
            Tenant.Type,
            User.Type
        ]));
    });

    it("names no type that only a negative existential condition reads", () => {
        const specification = model.given(Answer)
            .match((ans, facts) => facts.ofType(Attendee)
                .join(att => att.tenant, ans.tenant)
                .notExists(att => facts.ofType(Withdrawal)
                    .join(w => w.attendee.tenant, att.tenant))
                .selectMany(att => facts.ofType(User)
                    .join(u => u, att.user)))
            .specification;

        // Withdrawal is read only beneath the condition, so it yields no edge.
        // Attendee and Tenant are read above it as well, and keep theirs.
        expect(tailEdges(Answer.Type, specification)).toEqual(sorted([
            Attendee.Type,
            Tenant.Type,
            User.Type
        ]));
    });

    it("names no type a condition nested inside a negative one reads", () => {
        // "No withdrawal that has no undo". The inner condition is positive in
        // form, and sits beneath a negative one, so the facts of the batch are
        // invisible to it too and Rejoin yields no edge either.
        const specification = model.given(Answer)
            .match((ans, facts) => facts.ofType(Attendee)
                .join(att => att.tenant, ans.tenant)
                .notExists(att => facts.ofType(Withdrawal)
                    .join(w => w.attendee.tenant, att.tenant)
                    .notExists(w => facts.ofType(Rejoin)
                        .join(r => r.withdrawal, w)))
                .selectMany(att => facts.ofType(User)
                    .join(u => u, att.user)))
            .specification;

        expect(tailEdges(Answer.Type, specification)).toEqual(sorted([
            Attendee.Type,
            Tenant.Type,
            User.Type
        ]));
    });

    describe("a condition on one of the tail's givens", () => {
        // The runner evaluates a given's conditions before the matches, so a
        // type one of them reads is read from the store too. An authorization
        // rule's tail never carries such a condition today: the split puts the
        // given's conditions in the head, and a tail that reads the fact being
        // authorized is refused where the rule is written. These two reach
        // `tailDependencies` with a tail that carries one anyway, so that the
        // walk is covered rather than taken on trust.
        function tailWithGivenCondition(exists: boolean): Specification {
            const specification = model.given(Answer)
                .match((ans, facts) => facts.ofType(Attendee)
                    .join(att => att.tenant, ans.tenant)
                    .selectMany(att => facts.ofType(User)
                        .join(u => u, att.user)))
                .specification;
            const { tail } = splitBeforeFirstSuccessor(assertWellFormed(specification, "A rule under test"));
            const condition = model.given(Tenant)
                .match((t, facts) => facts.ofType(Confirmation)
                    .join(c => c.attendee.tenant, t))
                .specification;
            return {
                ...tail!,
                given: tail!.given.map((given, index) => index > 0 ? given : {
                    ...given,
                    conditions: [ {
                        type: "existential" as const,
                        exists,
                        matches: condition.matches.map(match => ({
                            ...match,
                            conditions: match.conditions.map(c => c.type === "path"
                                ? { ...c, labelRight: given.label.name }
                                : c)
                        }))
                    } ]
                })
            };
        }

        it("names the type a positive one reads", () => {
            const edges = tailDependencies(Answer.Type, tailWithGivenCondition(true));

            expect(sorted(edges.map(e => e.from).filter((f, i, all) => all.indexOf(f) === i)))
                .toEqual(sorted([ Attendee.Type, Confirmation.Type, Tenant.Type, User.Type ]));
        });

        it("names no type a negative one reads", () => {
            const edges = tailDependencies(Answer.Type, tailWithGivenCondition(false));

            expect(sorted(edges.map(e => e.from).filter((f, i, all) => all.indexOf(f) === i)))
                .toEqual(sorted([ Attendee.Type, Tenant.Type, User.Type ]));
        });
    });

    it("names the governed type itself when a rule reads its own type", () => {
        // The shape of criterion 3: a member may be added by the user of
        // another member of the same group. The edge into the governed type
        // comes from the type itself, which is what makes its component
        // recursive.
        const specification = model.given(Answer)
            .match((ans, facts) => facts.ofType(Answer)
                .join(other => other.tenant, ans.tenant)
                .selectMany(other => facts.ofType(User)
                    .join(u => u, other.author)))
            .specification;

        expect(tailEdges(Answer.Type, specification)).toEqual(sorted([
            Answer.Type,
            Tenant.Type,
            User.Type
        ]));
    });
});
