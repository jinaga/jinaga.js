import { Specification, User, assertWellFormed, buildModel, splitBeforeFirstSuccessor } from "@src";
import { tailDependencies } from "../../src/authorization/authorization-strata";

// Issue #396, criterion 7. The strata are derived from the rules rather than
// configured, so the edges a real specification yields have to name the types
// its tail reads, negative exactly where they sit beneath a negative
// existential condition. The simulation in the issue abstracts a tail's join to
// a relation; this suite pins the extraction from an actual specification.

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

/** The distinct types a rule's tail reads, with the polarity it reads them at. */
function tailEdges(type: string, specification: Specification): { from: string, negative: boolean }[] {
    const { tail } = splitBeforeFirstSuccessor(assertWellFormed(specification, "A rule under test"));
    if (tail === undefined) {
        return [];
    }
    const edges = tailDependencies(type, tail).map(d => ({ from: d.from, negative: d.negative }));
    return edges
        .filter((edge, index) => edges.findIndex(e => e.from === edge.from && e.negative === edge.negative) === index)
        .sort((a, b) => a.from.localeCompare(b.from) || Number(a.negative) - Number(b.negative));
}

function sorted(edges: { from: string, negative: boolean }[]) {
    return edges.slice().sort((a, b) => a.from.localeCompare(b.from) || Number(a.negative) - Number(b.negative));
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
            { from: Attendee.Type, negative: false },
            { from: Tenant.Type, negative: false },
            { from: User.Type, negative: false }
        ]));
    });

    it("keeps a positive existential condition positive", () => {
        const specification = model.given(Answer)
            .match((ans, facts) => facts.ofType(Attendee)
                .join(att => att.tenant, ans.tenant)
                .exists(att => facts.ofType(Confirmation)
                    .join(c => c.attendee, att))
                .selectMany(att => facts.ofType(User)
                    .join(u => u, att.user)))
            .specification;

        expect(tailEdges(Answer.Type, specification)).toEqual(sorted([
            { from: Attendee.Type, negative: false },
            { from: Confirmation.Type, negative: false },
            { from: Tenant.Type, negative: false },
            { from: User.Type, negative: false }
        ]));
    });

    it("marks every type beneath a negative existential condition negative", () => {
        const specification = model.given(Answer)
            .match((ans, facts) => facts.ofType(Attendee)
                .join(att => att.tenant, ans.tenant)
                .notExists(att => facts.ofType(Withdrawal)
                    .join(w => w.attendee.tenant, att.tenant))
                .selectMany(att => facts.ofType(User)
                    .join(u => u, att.user)))
            .specification;

        // Attendee and Tenant are read both above the condition and beneath it,
        // so each yields an edge of either polarity.
        expect(tailEdges(Answer.Type, specification)).toEqual(sorted([
            { from: Attendee.Type, negative: false },
            { from: Attendee.Type, negative: true },
            { from: Tenant.Type, negative: false },
            { from: Tenant.Type, negative: true },
            { from: Withdrawal.Type, negative: true },
            { from: User.Type, negative: false }
        ]));
    });

    it("keeps a condition nested inside a negative one negative", () => {
        // "No withdrawal that has no undo". The inner condition is positive in
        // form, and the types beneath it stay negative: a fact found there
        // withholds the verdict rather than granting it.
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
            { from: Attendee.Type, negative: false },
            { from: Attendee.Type, negative: true },
            { from: Rejoin.Type, negative: true },
            { from: Tenant.Type, negative: false },
            { from: Tenant.Type, negative: true },
            { from: Withdrawal.Type, negative: true },
            { from: User.Type, negative: false }
        ]));
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
            { from: Answer.Type, negative: false },
            { from: Tenant.Type, negative: false },
            { from: User.Type, negative: false }
        ]));
    });
});
