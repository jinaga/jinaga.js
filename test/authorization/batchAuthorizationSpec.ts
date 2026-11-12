import { AuthorizationEngine, AuthorizationRules, FactEnvelope, FactFeed, FactRecord, FactReference, Forbidden, MemoryStore, ProjectedResult, Specification, Storage, User, buildModel, dehydrateFact } from "@src";

// Issue #396. `authorizeFacts` decided a batch in one pass with every rule tail
// read from the store alone. Nothing in a batch is in the store until the whole
// batch has been authorized, so the verdict on a fact depended on how the
// sender cut its requests: a positive condition that reached a fact in the same
// batch refused it, and a negative condition that forbade one admitted it.

class Tenant {
    static Type = "H.Tenant";
    type = Tenant.Type;
    constructor(
        public creator: User
    ) { }
}

class Attendee {
    static Type = "H.Attendee";
    type = Attendee.Type;
    constructor(
        public user: User,
        public tenant: Tenant
    ) { }
}

class Withdrawal {
    static Type = "H.Withdrawal";
    type = Withdrawal.Type;
    constructor(
        public attendee: Attendee
    ) { }
}

class Rejoin {
    static Type = "H.Rejoin";
    type = Rejoin.Type;
    constructor(
        public withdrawal: Withdrawal
    ) { }
}

class Group {
    static Type = "H.Group";
    type = Group.Type;
    constructor(
        public creator: User
    ) { }
}

class Member {
    static Type = "H.Member";
    type = Member.Type;
    constructor(
        public group: Group,
        public user: User
    ) { }
}

class Alpha {
    static Type = "H.Alpha";
    type = Alpha.Type;
    constructor(
        public tenant: Tenant,
        public author: User
    ) { }
}

class Beta {
    static Type = "H.Beta";
    type = Beta.Type;
    constructor(
        public tenant: Tenant,
        public author: User
    ) { }
}

/**
 * The model of issue #396's *Demonstrated* section, with the type name of the
 * answer left open. The strata are derived from the rules, so the order in
 * which the batch is decided must not depend on how the type names sort.
 */
function conferenceModel(answerType: string) {
    class Answer {
        static Type = answerType;
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
        .type(Answer, x => x
            .predecessor("tenant", Tenant)
            .predecessor("author", User))
    );

    // Answer is authorized for the user of every Attendee of its tenant. That is
    // a successor walk, so the rule's tail reads Attendee from the store.
    const authorization = (a: AuthorizationRules) => a
        .any(User)
        .type(Tenant, t => t.creator)
        .type(Attendee, att => att.user)
        .type(Answer, (ans, facts) => facts.ofType(Attendee)
            .join(att => att.tenant, ans.tenant)
            .selectMany(att => facts.ofType(User)
                .join(u => u, att.user)));

    return { Answer, model, authorization };
}

// A store that delegates everything and implements no `readAsIfSaved`, which is
// what a store that has not taken up the seam looks like.
class DelegatingStore implements Storage {
    constructor(
        protected readonly inner: Storage
    ) { }

    close(): Promise<void> {
        return this.inner.close();
    }

    save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        return this.inner.save(envelopes);
    }

    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        return this.inner.read(start, specification);
    }

    feed(feed: Specification, start: FactReference[], bookmark: string): Promise<FactFeed> {
        return this.inner.feed(feed, start, bookmark);
    }

    whichExist(references: FactReference[]): Promise<FactReference[]> {
        return this.inner.whichExist(references);
    }

    load(references: FactReference[]): Promise<FactEnvelope[]> {
        return this.inner.load(references);
    }

    purge(purgeConditions: Specification[]): Promise<number> {
        return this.inner.purge(purgeConditions);
    }

    purgeDescendants(purgeRoot: FactReference, triggers: FactReference[]): Promise<number> {
        return this.inner.purgeDescendants(purgeRoot, triggers);
    }

    loadBookmark(feed: string): Promise<string> {
        return this.inner.loadBookmark(feed);
    }

    saveBookmark(feed: string, bookmark: string): Promise<void> {
        return this.inner.saveBookmark(feed, bookmark);
    }

    getMruDate(specificationHash: string): Promise<Date | null> {
        return this.inner.getMruDate(specificationHash);
    }

    setMruDate(specificationHash: string, mruDate: Date): Promise<void> {
        return this.inner.setMruDate(specificationHash, mruDate);
    }
}

// Counts the reads a rule's tail makes, however they are made, so that a second
// pass over a stratum cannot hide behind the staged form of the call.
class CountingStore extends DelegatingStore {
    tailReads = 0;

    constructor(
        private readonly memory: MemoryStore
    ) {
        super(memory);
    }

    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        this.tailReads++;
        return super.read(start, specification);
    }

    readAsIfSaved(staged: FactEnvelope[], start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        this.tailReads++;
        // Cast, so that the suite compiles against a MemoryStore that does not
        // yet have the method. A pre-fix run fails here rather than silently
        // reporting no reads.
        return (this.memory as any).readAsIfSaved(staged, start, specification);
    }
}

// Structural, so that this suite compiles against the source as it stood
// before the fix as well as after it.
type Verdict = { fact: FactRecord, verdict: string };

function factKey(reference: FactReference): string {
    return `${reference.type}:${reference.hash}`;
}

function predecessorsOf(fact: FactRecord): FactReference[] {
    const references: FactReference[] = [];
    for (const role in fact.predecessors) {
        const value = fact.predecessors[role];
        if (Array.isArray(value)) {
            references.push(...value);
        }
        else if (value) {
            references.push(value);
        }
    }
    return references;
}

function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) {
        return [ items ];
    }
    return items.flatMap((item, index) => permutations([ ...items.slice(0, index), ...items.slice(index + 1) ])
        .map(rest => [ item, ...rest ]));
}

/** Every order of the batch that puts a fact after the predecessors it names. */
function topologicalOrders(batch: FactRecord[]): FactRecord[][] {
    const inBatch = new Set(batch.map(factKey));
    return permutations(batch).filter(order => {
        const seen = new Set<string>();
        for (const fact of order) {
            for (const reference of predecessorsOf(fact)) {
                const key = factKey(reference);
                if (inBatch.has(key) && !seen.has(key)) {
                    return false;
                }
            }
            seen.add(factKey(fact));
        }
        return true;
    });
}

function userFactOf(user: User): FactRecord {
    return dehydrateFact(user).find(f => f.type === User.Type)!;
}

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

/** The records of `facts` that the store does not already hold. */
function batchOf(stored: FactRecord[], ...facts: {}[]): FactRecord[] {
    return recordsOf(...facts).filter(record =>
        !stored.some(s => s.type === record.type && s.hash === record.hash));
}

async function storeWith(records: FactRecord[]): Promise<MemoryStore> {
    const store = new MemoryStore();
    await store.save(records.map(fact => ({ fact, signatures: [] })));
    return store;
}

function authorize(rules: AuthorizationRules, store: Storage, batch: FactRecord[], user: User): Promise<Verdict[]> {
    const engine = new AuthorizationEngine(rules, store);
    return engine.authorizeFacts(batch.map(fact => ({ fact, signatures: [] })), userFactOf(user));
}

function verdictsByType(results: Verdict[]): { [type: string]: string } {
    const verdicts: { [type: string]: string } = {};
    for (const result of results) {
        verdicts[result.fact.type] = result.verdict;
    }
    return verdicts;
}

describe("Authorization of a batch", () => {
    describe("a positive condition that reaches a fact in the same batch", () => {
        // Criterion 1 of issue #396, run for a type name that sorts before
        // H.Attendee and one that sorts after it.
        for (const answerType of [ "H.Answer", "H.Zanswer" ]) {
            describe(`with the answer named ${answerType}`, () => {
                const { Answer, model, authorization } = conferenceModel(answerType);

                async function fixture() {
                    const creator = new User("creator-key");
                    const attendeeUser = new User("attendee-key");
                    const tenant = new Tenant(creator);
                    const attendee = new Attendee(attendeeUser, tenant);
                    const answer = new Answer(tenant, attendeeUser);
                    const stored = recordsOf(creator, attendeeUser, tenant);
                    const store = await storeWith(stored);
                    const batch = batchOf(stored, attendee, answer);
                    return { store, batch, attendeeUser, rules: authorization(new AuthorizationRules(model)) };
                }

                it("accepts the attendee and the answer together, in every order", async () => {
                    const { batch, attendeeUser, rules } = await fixture();
                    const orders = topologicalOrders(batch);
                    expect(orders.length).toBeGreaterThan(1);

                    for (const order of orders) {
                        const store = await storeWith(recordsOf(new User("creator-key"), attendeeUser, new Tenant(new User("creator-key"))));
                        const results = await authorize(rules, store, order, attendeeUser);

                        expect(verdictsByType(results)).toEqual({
                            [Attendee.Type]: "Accept",
                            [answerType]: "Accept"
                        });
                    }
                });

                it("reads each rule's tail once, because nothing in the batch is recursive", async () => {
                    // Two answers and one attendee: the attendee's rule is a
                    // predecessor walk with no tail, and each answer's tail is
                    // read once. A second pass over a stratum would double the
                    // answers' reads.
                    const creator = new User("creator-key");
                    const attendeeUser = new User("attendee-key");
                    const tenant = new Tenant(creator);
                    const attendee = new Attendee(attendeeUser, tenant);
                    const answers = [
                        new Answer(tenant, attendeeUser),
                        new Answer(tenant, creator)
                    ];
                    const stored = recordsOf(creator, attendeeUser, tenant);
                    const memory = await storeWith(stored);
                    const counting = new CountingStore(memory);
                    const batch = batchOf(stored, attendee, ...answers);

                    const results = await authorize(authorization(new AuthorizationRules(model)), counting, batch, attendeeUser);

                    expect(results.every(r => r.verdict === "Accept")).toBe(true);
                    expect(counting.tailReads).toEqual(answers.length);
                });

                it("gives the verdict it gave before, against a store that cannot read as if saved", async () => {
                    // Criterion 9. The fallback is the behavior the issue
                    // reports: the answer's tail reads the store alone, the
                    // attendee is not there yet, and the answer is refused.
                    const { store, batch, attendeeUser, rules } = await fixture();
                    const withoutSeam = new DelegatingStore(store);

                    const promise = authorize(rules, withoutSeam, batch, attendeeUser);

                    await expect(promise).rejects.toBeInstanceOf(Forbidden);
                    await expect(promise).rejects.toThrow(`Rejected 1 fact of type ${answerType}.`);
                });
            });
        }
    });

    describe("a rule that admits a fact by another of its own type", () => {
        // Criterion 3. The creator may add themselves to a group, and the user
        // of any member may add a member. The rule for H.Member names H.Member
        // in its tail, so its component is recursive and the stratum is decided
        // again until a pass accepts nothing new.
        const model = buildModel(b => b
            .type(User)
            .type(Group, x => x
                .predecessor("creator", User))
            .type(Member, x => x
                .predecessor("group", Group)
                .predecessor("user", User))
        );

        const authorization = (a: AuthorizationRules) => a
            .any(User)
            .type(Group, g => g.creator)
            .type(Member, (m, facts) => facts.ofType(User)
                .join(u => u, m.group.creator)
                .join(u => u, m.user))
            .type(Member, (m, facts) => facts.ofType(Member)
                .join(other => other.group, m.group)
                .selectMany(other => facts.ofType(User)
                    .join(u => u, other.user)));

        it("accepts a chain of two members in a batch, in every order", async () => {
            const creator = new User("creator-key");
            const invited = new User("invited-key");
            const group = new Group(creator);
            const founding = new Member(group, creator);
            const second = new Member(group, invited);
            const stored = recordsOf(creator, invited, group);
            const batch = batchOf(stored, founding, second);
            const orders = topologicalOrders(batch);
            expect(orders.length).toBeGreaterThan(1);

            for (const order of orders) {
                const store = await storeWith(stored);

                const results = await authorize(authorization(new AuthorizationRules(model)), store, order, creator);

                expect(results.length).toEqual(2);
                expect(results.every(r => r.verdict === "Accept")).toBe(true);
            }
        });
    });

    describe("two facts that support each other and nothing else", () => {
        // Criterion 4. Each rule reaches the other fact through a successor
        // walk, so neither is admitted by anything already decided. Iterating
        // the component accepts nothing on the first pass and stops.
        const model = buildModel(b => b
            .type(User)
            .type(Tenant, x => x
                .predecessor("creator", User))
            .type(Alpha, x => x
                .predecessor("tenant", Tenant)
                .predecessor("author", User))
            .type(Beta, x => x
                .predecessor("tenant", Tenant)
                .predecessor("author", User))
        );

        const authorization = (a: AuthorizationRules) => a
            .any(User)
            .type(Tenant, t => t.creator)
            .type(Alpha, (alpha, facts) => facts.ofType(Beta)
                .join(b => b.tenant, alpha.tenant)
                .selectMany(b => facts.ofType(User)
                    .join(u => u, b.author)))
            .type(Beta, (beta, facts) => facts.ofType(Alpha)
                .join(al => al.tenant, beta.tenant)
                .selectMany(al => facts.ofType(User)
                    .join(u => u, al.author)));

        it("refuses both, in every order", async () => {
            const creator = new User("creator-key");
            const tenant = new Tenant(creator);
            const alpha = new Alpha(tenant, creator);
            const beta = new Beta(tenant, creator);
            const stored = recordsOf(creator, tenant);
            const batch = batchOf(stored, alpha, beta);
            const orders = topologicalOrders(batch);
            expect(orders.length).toBeGreaterThan(1);

            for (const order of orders) {
                const store = await storeWith(stored);

                const promise = authorize(authorization(new AuthorizationRules(model)), store, order, creator);

                await expect(promise).rejects.toBeInstanceOf(Forbidden);
                await expect(promise).rejects.toThrow("Rejected 2 facts of type");
                const error = await promise.catch(e => e);
                expect(error.message).toContain(Alpha.Type);
                expect(error.message).toContain(Beta.Type);
            }
        });
    });

    describe("a negative condition that reaches a fact in the same batch", () => {
        // Criterion 5. An answer is authorized for the user of an attendee of
        // its tenant, provided no attendee of that tenant has withdrawn.
        const { Answer } = conferenceModel("H.Answer");

        const model = buildModel(b => b
            .type(User)
            .type(Tenant, x => x
                .predecessor("creator", User))
            .type(Attendee, x => x
                .predecessor("user", User)
                .predecessor("tenant", Tenant))
            .type(Withdrawal, x => x
                .predecessor("attendee", Attendee))
            .type(Rejoin, x => x
                .predecessor("withdrawal", Withdrawal))
            .type(Answer, x => x
                .predecessor("tenant", Tenant)
                .predecessor("author", User))
        );

        const withdrawalAuthorization = (a: AuthorizationRules) => a
            .any(User)
            .type(Tenant, t => t.creator)
            .type(Attendee, att => att.user)
            .type(Withdrawal, w => w.attendee.user)
            .type(Answer, (ans, facts) => facts.ofType(Attendee)
                .join(att => att.tenant, ans.tenant)
                .notExists(att => facts.ofType(Withdrawal)
                    .join(w => w.attendee.tenant, att.tenant))
                .selectMany(att => facts.ofType(User)
                    .join(u => u, att.user)));

        // The withdrawal can be undone, and only the tenant's creator may undo
        // one. An answer is admitted while every withdrawal has an undo.
        const rejoinAuthorization = (a: AuthorizationRules) => a
            .any(User)
            .type(Tenant, t => t.creator)
            .type(Attendee, att => att.user)
            .type(Withdrawal, w => w.attendee.user)
            .type(Rejoin, r => r.withdrawal.attendee.tenant.creator)
            .type(Answer, (ans, facts) => facts.ofType(Attendee)
                .join(att => att.tenant, ans.tenant)
                .notExists(att => facts.ofType(Withdrawal)
                    .join(w => w.attendee.tenant, att.tenant)
                    .notExists(w => facts.ofType(Rejoin)
                        .join(r => r.withdrawal, w)))
                .selectMany(att => facts.ofType(User)
                    .join(u => u, att.user)));

        it("refuses the answer when the withdrawal in the same batch is accepted", async () => {
            const creator = new User("creator-key");
            const attendeeUser = new User("attendee-key");
            const tenant = new Tenant(creator);
            const attendee = new Attendee(attendeeUser, tenant);
            const withdrawal = new Withdrawal(attendee);
            const answer = new Answer(tenant, attendeeUser);
            const stored = recordsOf(creator, attendeeUser, tenant, attendee);
            const batch = batchOf(stored, withdrawal, answer);
            const orders = topologicalOrders(batch);
            expect(orders.length).toBeGreaterThan(1);

            for (const order of orders) {
                const store = await storeWith(stored);

                const promise = authorize(withdrawalAuthorization(new AuthorizationRules(model)), store, order, attendeeUser);

                await expect(promise).rejects.toThrow("Rejected 1 fact of type H.Answer.");
            }
        });

        it("accepts the answer when the withdrawal in the same batch is refused", async () => {
            const creator = new User("creator-key");
            const attendeeUser = new User("attendee-key");
            const otherUser = new User("other-key");
            const tenant = new Tenant(creator);
            const attendee = new Attendee(attendeeUser, tenant);
            const otherAttendee = new Attendee(otherUser, tenant);
            // The other attendee's withdrawal is not this user's to write.
            const withdrawal = new Withdrawal(otherAttendee);
            const answer = new Answer(tenant, attendeeUser);
            const stored = recordsOf(creator, attendeeUser, otherUser, tenant, attendee, otherAttendee);
            const batch = batchOf(stored, withdrawal, answer);
            const orders = topologicalOrders(batch);
            expect(orders.length).toBeGreaterThan(1);

            for (const order of orders) {
                const store = await storeWith(stored);

                const promise = authorize(withdrawalAuthorization(new AuthorizationRules(model)), store, order, attendeeUser);

                // Only the withdrawal is refused: the answer's negative
                // condition forbids a withdrawal that will be saved, and this
                // one will not be.
                await expect(promise).rejects.toThrow("Rejected 1 fact of type H.Withdrawal.");
            }
        });

        it("accepts the answer when the undo in the same batch is accepted", async () => {
            const creator = new User("creator-key");
            const tenant = new Tenant(creator);
            const attendee = new Attendee(creator, tenant);
            const withdrawal = new Withdrawal(attendee);
            const rejoin = new Rejoin(withdrawal);
            const answer = new Answer(tenant, creator);
            const stored = recordsOf(creator, tenant, attendee);
            const batch = batchOf(stored, withdrawal, rejoin, answer);
            const orders = topologicalOrders(batch);
            expect(orders.length).toBeGreaterThan(1);

            for (const order of orders) {
                const store = await storeWith(stored);

                const results = await authorize(rejoinAuthorization(new AuthorizationRules(model)), store, order, creator);

                expect(verdictsByType(results)).toEqual({
                    [Withdrawal.Type]: "Accept",
                    [Rejoin.Type]: "Accept",
                    [Answer.Type]: "Accept"
                });
            }
        });

        it("refuses the answer when the undo in the same batch is refused", async () => {
            const creator = new User("creator-key");
            const attendeeUser = new User("attendee-key");
            const tenant = new Tenant(creator);
            const attendee = new Attendee(attendeeUser, tenant);
            const withdrawal = new Withdrawal(attendee);
            // Only the tenant's creator may undo a withdrawal.
            const rejoin = new Rejoin(withdrawal);
            const answer = new Answer(tenant, attendeeUser);
            const stored = recordsOf(creator, attendeeUser, tenant, attendee);
            const batch = batchOf(stored, withdrawal, rejoin, answer);
            const orders = topologicalOrders(batch);
            expect(orders.length).toBeGreaterThan(1);

            for (const order of orders) {
                const store = await storeWith(stored);

                const promise = authorize(rejoinAuthorization(new AuthorizationRules(model)), store, order, attendeeUser);
                const error = await promise.catch(e => e);

                expect(error).toBeInstanceOf(Forbidden);
                expect(error.message).toContain("Rejected 2 facts of type");
                expect(error.message).toContain(Rejoin.Type);
                expect(error.message).toContain(Answer.Type);
            }
        });
    });
});
