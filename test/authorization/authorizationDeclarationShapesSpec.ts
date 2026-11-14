import { AuthorizationEngine, AuthorizationRules, FactEnvelope, FactRecord, MemoryStore, User, buildModel, dehydrateFact, describeAuthorizationRules } from "@src";
import { Administrator, AdministratorRevoked, Company, model as companyModel } from "../companyModel";

// Issue #396, criterion 6. No rule set is refused for its shape. A negative
// existential condition reads the store as it was before the batch, so it takes
// no part in deciding which facts of the batch admit each other: a cycle
// through a negation cannot leave a verdict ambiguous, and there is nothing to
// refuse at declaration. The revocation idiom in particular declares as it
// always has.

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
    .type(Letter, x => x
        .predecessor("envelope", Envelope)
        .predecessor("user", User))
);

// The shape of a uniqueness rule: a user may claim unless a claim of theirs
// already exists. The rule for C.Claim forbids its own type.
const claimForbidsClaim = (a: AuthorizationRules) => a
    .any(User)
    .type(Tenant, t => t.creator)
    .type(Claim, (c, facts) => facts.ofType(User)
        .join(u => u, c.tenant.creator)
        .notExists(u => facts.ofType(Claim)
            .join(other => other.user, u)));

// A motion may be raised while nothing vetoes it, and a veto is authorized by
// the motion it answers. C.Motion forbids C.Veto, whose own rule reads
// C.Motion.
const motionForbidsVeto = (a: AuthorizationRules) => a
    .any(User)
    .type(Tenant, t => t.creator)
    .type(Motion, (m, facts) => facts.ofType(User)
        .join(u => u, m.tenant.creator)
        .notExists(u => facts.ofType(Veto)
            .join(v => v.user, u)));

const vetoReadsMotion = (a: AuthorizationRules) => a
    .type(Veto, (v, facts) => facts.ofType(Motion)
        .join(m => m.tenant, v.tenant)
        .selectMany(m => facts.ofType(User)
            .join(u => u, m.user)));

// C.Envelope forbids C.Letter, and a letter names an envelope as its
// predecessor, so the model's own predecessor role runs the other way. That is
// the shape of revocation: the forbidden fact points back at the fact it
// forbids.
const envelopeForbidsLetter = (a: AuthorizationRules) => a
    .any(User)
    .type(Tenant, t => t.creator)
    .type(Envelope, (e, facts) => facts.ofType(User)
        .join(u => u, e.tenant.creator)
        .notExists(u => facts.ofType(Letter)
            .join(l => l.user, u)));

// "An administrator of the company who has not been revoked may add an
// administrator", written against this repository's own company model. Two
// jinaga-spec conformance vectors carry this rule.
const administratorNotRevoked = (a: AuthorizationRules) => a
    .any(User)
    .type(Company, c => c.creator)
    .type(Administrator, (admin, facts) => facts.ofType(Administrator)
        .join(other => other.company, admin.company)
        .notExists(other => facts.ofType(AdministratorRevoked)
            .join(revoked => revoked.administrator, other))
        .selectMany(other => facts.ofType(User)
            .join(u => u, other.user)));

const shapes: { name: string, model: typeof model | typeof companyModel, declare: (a: AuthorizationRules) => AuthorizationRules }[] = [
    { name: "a rule that forbids its own type", model, declare: claimForbidsClaim },
    { name: "a rule that forbids a type whose own rule reads it", model, declare: a => vetoReadsMotion(motionForbidsVeto(a)) },
    { name: "a rule that forbids a type it is a predecessor of", model, declare: envelopeForbidsLetter },
    { name: "the revocation idiom", model: companyModel, declare: administratorNotRevoked }
];

describe("A rule set whose negative conditions form a cycle", () => {
    for (const shape of shapes) {
        describe(shape.name, () => {
            it("declares through type", () => {
                expect(() => shape.declare(new AuthorizationRules(shape.model))).not.toThrow();
            });

            it("declares through merge", () => {
                // Each half on its own, then merged, which is the other way a
                // rule set reaches a cycle.
                const declared = shape.declare(new AuthorizationRules(shape.model));
                const empty = new AuthorizationRules(shape.model);

                expect(() => empty.merge(declared)).not.toThrow();
                expect(() => declared.merge(empty)).not.toThrow();
            });

            it("declares through loadFromDescription", () => {
                const description = describeAuthorizationRules(shape.model, shape.declare);

                expect(() => AuthorizationRules.loadFromDescription(description)).not.toThrow();
            });

            it("describes to the same text it loads from", () => {
                // Nothing about the shape is lost on the way through, so the
                // description a replicator ships carries the cycle too.
                const description = describeAuthorizationRules(shape.model, shape.declare);
                const loaded = AuthorizationRules.loadFromDescription(description);

                expect(loaded.saveToDescription()).toEqual(description);
            });
        });
    }

    describe("the verdict a uniqueness rule gives", () => {
        // The shape declares, and it decides. Both claims of one batch are
        // accepted: each reads the store as it was before the batch, where
        // there is no claim, and nothing beneath a negative condition sees the
        // other. The rule still refuses a claim that arrives in a later
        // request, which is the whole of what it can promise over a local
        // graph.
        function recordsOf(...facts: {}[]): FactRecord[] {
            const records: FactRecord[] = [];
            for (const fact of facts) {
                for (const record of dehydrateFact(fact)) {
                    if (!records.some(r => r.type === record.type && r.hash === record.hash)) {
                        records.push(record);
                    }
                }
            }
            return records;
        }

        async function fixture() {
            const creator = new User("tenant-creator-key");
            const tenant = new Tenant(creator);
            const stored = recordsOf(creator, tenant);
            const store = new MemoryStore();
            await store.save(stored.map(fact => ({ fact, signatures: [] })));
            const rules = claimForbidsClaim(new AuthorizationRules(model));
            const engine = new AuthorizationEngine(rules, store);
            const userFact = recordsOf(creator).find(f => f.type === User.Type)!;
            const claims = [
                new Claim(tenant, creator),
                new Claim(tenant, new User("second-claimant-key"))
            ];
            const batch = (facts: {}[]): FactEnvelope[] => recordsOf(...facts)
                .filter(record => !stored.some(s => s.type === record.type && s.hash === record.hash))
                .map(fact => ({ fact, signatures: [] }));
            return { engine, store, userFact, claims, batch };
        }

        it("accepts two claims that arrive in one batch", async () => {
            const { engine, userFact, claims, batch } = await fixture();

            const results = await engine.authorizeFacts(batch(claims), userFact);

            const verdicts = results.filter(r => r.fact.type === Claim.Type);
            expect(verdicts.length).toEqual(2);
            expect(verdicts.every(r => r.verdict === "Accept")).toBe(true);
        });

        it("refuses a claim that arrives after one was saved", async () => {
            const { engine, store, userFact, claims, batch } = await fixture();
            const first = batch([ claims[0] ]);
            await engine.authorizeFacts(first, userFact);
            await store.save(first);

            const promise = engine.authorizeFacts(batch([ claims[1] ]), userFact);

            await expect(promise).rejects.toThrow(`Rejected 1 fact of type ${Claim.Type}.`);
        });
    });
});
