import { AuthorizationRuleError, AuthorizationRules, User, buildModel, describeAuthorizationRules } from "@src";

// Issue #396, criterion 6. A negative edge between two fact types of one
// component means that whether one fact is admitted depends on whether another
// is, through a negation. No order of evaluation settles that, so the call that
// closes such a cycle is refused where the rule is written.

class Tenant {
    static Type = "C.Tenant";
    type = Tenant.Type;
    constructor(
        public creator: User
    ) { }
}

class Claim {
    static Type = "C.Claim";
    type = Claim.Type;
    constructor(
        public tenant: Tenant,
        public user: User
    ) { }
}

class Motion {
    static Type = "C.Motion";
    type = Motion.Type;
    constructor(
        public tenant: Tenant,
        public user: User
    ) { }
}

class Veto {
    static Type = "C.Veto";
    type = Veto.Type;
    constructor(
        public tenant: Tenant,
        public user: User
    ) { }
}

class Envelope {
    static Type = "C.Envelope";
    type = Envelope.Type;
    constructor(
        public tenant: Tenant,
        public user: User
    ) { }
}

class Letter {
    static Type = "C.Letter";
    type = Letter.Type;
    constructor(
        public envelope: Envelope,
        public user: User
    ) { }
}

// An unrelated type, used to write a rule of the same shape without closing a
// cycle, so that its description can be had from the library rather than by
// hand.
class Marker {
    static Type = "C.Marker";
    type = Marker.Type;
    constructor(
        public tenant: Tenant,
        public user: User
    ) { }
}

const model = buildModel(b => b
    .type(User)
    .type(Tenant, x => x
        .predecessor("creator", User))
    .type(Claim, x => x
        .predecessor("tenant", Tenant)
        .predecessor("user", User))
    .type(Motion, x => x
        .predecessor("tenant", Tenant)
        .predecessor("user", User))
    .type(Veto, x => x
        .predecessor("tenant", Tenant)
        .predecessor("user", User))
    .type(Envelope, x => x
        .predecessor("tenant", Tenant)
        .predecessor("user", User))
    .type(Marker, x => x
        .predecessor("tenant", Tenant)
        .predecessor("user", User))
);

// The model that declares Letter's predecessor role, which is the other half of
// the cycle in the third shape.
const modelWithLetter = buildModel(b => b
    .type(User)
    .type(Tenant, x => x
        .predecessor("creator", User))
    .type(Envelope, x => x
        .predecessor("tenant", Tenant)
        .predecessor("user", User))
    .type(Letter, x => x
        .predecessor("envelope", Envelope)
        .predecessor("user", User))
);

function caught(declare: () => unknown): Error {
    try {
        declare();
    }
    catch (error) {
        return error as Error;
    }
    throw new Error("The declaration was accepted.");
}

describe("A rule set whose negative conditions form a cycle", () => {
    describe("a type whose rule forbids its own type", () => {
        // The shape of a uniqueness rule: a user may claim unless a claim of
        // theirs already exists.
        const claimForbidsClaim = (a: AuthorizationRules) => a
            .any(User)
            .type(Tenant, t => t.creator)
            .type(Claim, (c, facts) => facts.ofType(User)
                .join(u => u, c.tenant.creator)
                .notExists(u => facts.ofType(Claim)
                    .join(other => other.user, u)));

        it("is refused by the type call that writes it", () => {
            const error = caught(() => claimForbidsClaim(new AuthorizationRules(model)));

            expect(error).toBeInstanceOf(AuthorizationRuleError);
            expect(error.message).toContain(Claim.Type);
        });

        it("is refused when it arrives through loadFromDescription", () => {
            // The same rule written against an unrelated type closes no cycle,
            // so the library can describe it. Renaming the forbidden type to
            // the governed one is what closes the cycle.
            const description = describeAuthorizationRules(model, a => a
                .type(Claim, (c, facts) => facts.ofType(User)
                    .join(u => u, c.tenant.creator)
                    .notExists(u => facts.ofType(Marker)
                        .join(other => other.user, u))));
            const cyclic = description.split(Marker.Type).join(Claim.Type);
            expect(cyclic).not.toEqual(description);

            const error = caught(() => AuthorizationRules.loadFromDescription(cyclic));

            expect(error).toBeInstanceOf(AuthorizationRuleError);
            expect(error.message).toContain(Claim.Type);
        });
    });

    describe("a type that forbids another whose own rule reads it", () => {
        // A motion may be raised while nothing vetoes it, and a veto is
        // authorized by the motion it answers.
        const motionForbidsVeto = (a: AuthorizationRules) => a
            .type(Motion, (m, facts) => facts.ofType(User)
                .join(u => u, m.tenant.creator)
                .notExists(u => facts.ofType(Veto)
                    .join(v => v.user, u)));

        const vetoReadsMotion = (a: AuthorizationRules) => a
            .type(Veto, (v, facts) => facts.ofType(Motion)
                .join(m => m.tenant, v.tenant)
                .selectMany(m => facts.ofType(User)
                    .join(u => u, m.user)));

        it("declares either rule on its own", () => {
            expect(() => motionForbidsVeto(new AuthorizationRules(model))).not.toThrow();
            expect(() => vetoReadsMotion(new AuthorizationRules(model))).not.toThrow();
        });

        it("is refused by the type call that closes the cycle", () => {
            const error = caught(() => vetoReadsMotion(motionForbidsVeto(new AuthorizationRules(model))));

            expect(error).toBeInstanceOf(AuthorizationRuleError);
            expect(error.message).toContain(Motion.Type);
            expect(error.message).toContain(Veto.Type);
        });

        it("is refused whichever rule is written first", () => {
            const error = caught(() => motionForbidsVeto(vetoReadsMotion(new AuthorizationRules(model))));

            expect(error).toBeInstanceOf(AuthorizationRuleError);
            expect(error.message).toContain(Motion.Type);
            expect(error.message).toContain(Veto.Type);
        });

        it("is refused by merge", () => {
            const first = motionForbidsVeto(new AuthorizationRules(model));
            const second = vetoReadsMotion(new AuthorizationRules(model));

            const error = caught(() => first.merge(second));

            expect(error).toBeInstanceOf(AuthorizationRuleError);
            expect(error.message).toContain(Motion.Type);
            expect(error.message).toContain(Veto.Type);
        });

        it("is refused by loadFromDescription", () => {
            const description =
                describeAuthorizationRules(model, motionForbidsVeto) +
                describeAuthorizationRules(model, vetoReadsMotion);

            const error = caught(() => AuthorizationRules.loadFromDescription(description));

            expect(error).toBeInstanceOf(AuthorizationRuleError);
            expect(error.message).toContain(Motion.Type);
            expect(error.message).toContain(Veto.Type);
        });
    });

    describe("a type that forbids a type it is a predecessor of", () => {
        // Envelope forbids Letter, and Letter names an envelope as its
        // predecessor, so a letter is accepted only after its envelope is.
        const envelopeForbidsLetter = (a: AuthorizationRules) => a
            .type(Envelope, (e, facts) => facts.ofType(User)
                .join(u => u, e.tenant.creator)
                .notExists(u => facts.ofType(Letter)
                    .join(l => l.user, u)));

        it("is refused by the type call, when the model declares the role", () => {
            const error = caught(() => envelopeForbidsLetter(new AuthorizationRules(modelWithLetter)));

            expect(error).toBeInstanceOf(AuthorizationRuleError);
            expect(error.message).toContain(Envelope.Type);
            expect(error.message).toContain(Letter.Type);
        });

        it("is refused when the role comes from another rule's path rather than a model", () => {
            // loadFromDescription has no model, so the role is read off the
            // path a rule writes. The same rule written against an unrelated
            // type closes no cycle, so the library can describe it; renaming
            // the forbidden type to Letter is what closes it.
            const envelopeForbidsMarker = describeAuthorizationRules(model, a => a
                .type(Envelope, (e, facts) => facts.ofType(User)
                    .join(u => u, e.tenant.creator)
                    .notExists(u => facts.ofType(Marker)
                        .join(other => other.user, u))));
            const envelopeForbidsLetterDescription = envelopeForbidsMarker.split(Marker.Type).join(Letter.Type);
            const letterReadsItsEnvelope = describeAuthorizationRules(modelWithLetter, a => a
                .type(Letter, l => l.envelope.user));
            expect(letterReadsItsEnvelope).toContain(Envelope.Type);

            const error = caught(() => AuthorizationRules.loadFromDescription(
                envelopeForbidsLetterDescription + letterReadsItsEnvelope));

            expect(error).toBeInstanceOf(AuthorizationRuleError);
            expect(error.message).toContain(Envelope.Type);
            expect(error.message).toContain(Letter.Type);
        });
    });

    describe("a rule set with no negative cycle", () => {
        it("declares as it did before", () => {
            // A negative condition on a type that nothing in the component
            // reads back is ordinary, and stays declarable.
            expect(() => (new AuthorizationRules(model))
                .any(User)
                .type(Tenant, t => t.creator)
                .type(Motion, (m, facts) => facts.ofType(User)
                    .join(u => u, m.tenant.creator)
                    .notExists(u => facts.ofType(Veto)
                        .join(v => v.user, u)))
            ).not.toThrow();
        });
    });
});
