import { AuthorizationEngine, AuthorizationRuleError, AuthorizationRules, FactEnvelope, FactRecord, FactReference, Forbidden, MemoryStore, PredecessorCollection, computeHash, dehydrateFact } from "@src";

// Issue #396's simulation, ported as a property test.
//
// The simulation abstracts a rule's tail to a random relation between facts.
// Here the relation is "under the same root": every generated fact hangs off one
// root, and every clause of a rule reaches the facts of a type under that root.
// The rules are built as text and parsed, so the specifications the engine runs
// are real ones.
//
// The expectation is computed independently of the engine. A set S of batch
// facts is a ground-truth set when S is exactly the facts admitted against the
// store plus S, and when some order of one-fact requests reaches it. The engine
// has to accept exactly that set, whatever order the batch arrives in.

const ROOT_TYPE = "P.Root";
const USER_TYPE = "Jinaga.User";
const CREATOR_KEY = "property-root-creator";

type Clause =
    | { kind: "pos", type: string }
    | { kind: "neg", type: string }
    | { kind: "nested", outer: string, inner: string };

interface GeneratedType {
    name: string;
    /** The type of this type's second predecessor role, if it has one. */
    parentType: string | null;
    clauses: Clause[];
}

/** mulberry32: a small seeded generator, so a failure can be replayed. */
function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randomInt(random: () => number, low: number, high: number): number {
    return low + Math.floor(random() * (high - low + 1));
}

function pick<T>(random: () => number, items: T[]): T {
    return items[Math.floor(random() * items.length)];
}

function generateTypes(random: () => number): GeneratedType[] {
    const count = randomInt(random, 2, 4);
    const names = Array.from({ length: count }, (_, i) => `P.T${i}`);
    return names.map((name, index) => {
        const earlier = names.slice(0, index);
        const parentType = earlier.length > 0 && random() < 0.3 ? pick(random, earlier) : null;
        const clauses: Clause[] = [];
        const clauseCount = pick(random, [ 0, 1, 1, 2 ]);
        for (let i = 0; i < clauseCount; i++) {
            const roll = random();
            const type = pick(random, names);
            if (roll < 0.15) {
                clauses.push({ kind: "nested", outer: type, inner: pick(random, names) });
            }
            else if (roll < 0.4) {
                clauses.push({ kind: "neg", type });
            }
            else {
                clauses.push({ kind: "pos", type });
            }
        }
        return { name, parentType, clauses };
    });
}

/**
 * The rules as a description, in the form `saveToDescription` writes. Each rule
 * binds the root in its head, then the root's creator, and hangs its clauses off
 * that: the user who created the root may write a fact of the type, provided the
 * clauses hold.
 */
function describeRules(types: GeneratedType[]): string {
    let text = `authorization {\n    any ${USER_TYPE}\n    any ${ROOT_TYPE}\n`;
    for (const type of types) {
        let label = 2;
        const next = () => `u${++label}`;
        let conditions = "";
        for (const clause of type.clauses) {
            if (clause.kind === "nested") {
                const outer = next();
                const inner = next();
                conditions +=
                    `            !E {\n` +
                    `                ${outer}: ${clause.outer} [\n` +
                    `                    ${outer}->root: ${ROOT_TYPE} = u1\n` +
                    `                    !E {\n` +
                    `                        ${inner}: ${clause.inner} [\n` +
                    `                            ${inner}->root: ${ROOT_TYPE} = ${outer}->root: ${ROOT_TYPE}\n` +
                    `                        ]\n` +
                    `                    }\n` +
                    `                ]\n` +
                    `            }\n`;
            }
            else {
                const unknown = next();
                const operator = clause.kind === "pos" ? "E" : "!E";
                conditions +=
                    `            ${operator} {\n` +
                    `                ${unknown}: ${clause.type} [\n` +
                    `                    ${unknown}->root: ${ROOT_TYPE} = u1\n` +
                    `                ]\n` +
                    `            }\n`;
            }
        }
        text +=
            `    (p1: ${type.name}) {\n` +
            `        u1: ${ROOT_TYPE} [\n` +
            `            u1 = p1->root: ${ROOT_TYPE}\n` +
            conditions +
            `        ]\n` +
            `        u2: ${USER_TYPE} [\n` +
            `            u2 = u1->creator: ${USER_TYPE}\n` +
            `        ]\n` +
            `    } => u2\n`;
    }
    return text + "}\n";
}

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

function makeFact(type: string, predecessors: PredecessorCollection, index: number): FactRecord {
    const fields = { index };
    return { type, hash: computeHash(fields, predecessors), predecessors, fields };
}

interface Instance {
    types: GeneratedType[];
    description: string;
    storeRecords: FactRecord[];
    storedGenerated: FactRecord[];
    batch: FactRecord[];
    userFact: FactRecord;
}

function generateInstance(random: () => number, index: number): Instance {
    const types = generateTypes(random);
    const rootRecords = dehydrateFact({
        type: ROOT_TYPE,
        creator: { type: USER_TYPE, publicKey: CREATOR_KEY }
    });
    const root = rootRecords.find(r => r.type === ROOT_TYPE)!;
    const userFact = rootRecords.find(r => r.type === USER_TYPE)!;
    const rootReference: FactReference = { type: root.type, hash: root.hash };

    const storedCount = randomInt(random, 0, 2);
    const batchCount = randomInt(random, 2, 5);
    const created: FactRecord[] = [];
    let serial = 0;
    for (let i = 0; i < storedCount + batchCount; i++) {
        // A type with a parent role needs a fact to hang off, so fall back to a
        // type without one when nothing suitable has been created yet.
        const candidates = types.filter(t => t.parentType === null ||
            created.some(c => c.type === t.parentType));
        if (candidates.length === 0) {
            continue;
        }
        const type = pick(random, candidates);
        const predecessors: PredecessorCollection = { root: rootReference };
        if (type.parentType !== null) {
            const parent = pick(random, created.filter(c => c.type === type.parentType));
            predecessors.parent = { type: parent.type, hash: parent.hash };
        }
        created.push(makeFact(type.name, predecessors, serial++));
    }

    const storedGenerated = created.slice(0, Math.min(storedCount, created.length));
    const batch = created.slice(storedGenerated.length);
    return {
        types,
        description: describeRules(types),
        storeRecords: [ ...rootRecords, ...storedGenerated ],
        storedGenerated,
        batch,
        userFact
    };
}

/**
 * Whether the rules admit `fact` against a view of the facts that exist. The
 * clauses are read off the generated rule rather than from the engine, and the
 * relation is "under the same root", which every generated fact satisfies.
 */
function admitted(fact: FactRecord, view: FactRecord[], types: GeneratedType[]): boolean {
    const keys = new Set(view.map(factKey));
    for (const reference of predecessorsOf(fact)) {
        if (reference.type === ROOT_TYPE || reference.type === USER_TYPE) {
            continue;
        }
        if (!keys.has(factKey(reference))) {
            return false;
        }
    }
    const rule = types.find(t => t.name === fact.type)!;
    for (const clause of rule.clauses) {
        if (clause.kind === "pos") {
            if (!view.some(f => f.type === clause.type)) {
                return false;
            }
        }
        else if (clause.kind === "neg") {
            if (view.some(f => f.type === clause.type)) {
                return false;
            }
        }
        else {
            const witness = view.some(f => f.type === clause.outer) &&
                !view.some(f => f.type === clause.inner);
            if (witness) {
                return false;
            }
        }
    }
    return true;
}

function admittedSet(candidates: FactRecord[], view: FactRecord[], types: GeneratedType[]): FactRecord[] {
    return candidates.filter(fact => admitted(fact, view, types));
}

function sameSet(a: FactRecord[], b: FactRecord[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    const keys = new Set(a.map(factKey));
    return b.every(fact => keys.has(factKey(fact)));
}

/** Whether one fact at a time, in some order, reaches every fact of `subset`. */
function supported(subset: FactRecord[], stored: FactRecord[], types: GeneratedType[]): boolean {
    const accepted: FactRecord[] = [];
    let changed = true;
    while (changed) {
        changed = false;
        for (const fact of subset) {
            if (accepted.some(a => factKey(a) === factKey(fact))) {
                continue;
            }
            if (admitted(fact, [ ...stored, ...accepted ], types)) {
                accepted.push(fact);
                changed = true;
            }
        }
    }
    return accepted.length === subset.length;
}

function subsetsOf(facts: FactRecord[]): FactRecord[][] {
    const subsets: FactRecord[][] = [ [] ];
    for (const fact of facts) {
        for (const subset of subsets.slice()) {
            subsets.push([ ...subset, fact ]);
        }
    }
    return subsets;
}

function groundTruthSets(instance: Instance): FactRecord[][] {
    return subsetsOf(instance.batch).filter(subset => {
        const view = [ ...instance.storedGenerated, ...subset ];
        return sameSet(subset, admittedSet(instance.batch, view, instance.types)) &&
            supported(subset, instance.storedGenerated, instance.types);
    });
}

function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) {
        return [ items ];
    }
    return items.flatMap((item, index) => permutations([ ...items.slice(0, index), ...items.slice(index + 1) ])
        .map(rest => [ item, ...rest ]));
}

/** Up to `limit` orders of the batch that put a fact after its predecessors. */
function topologicalOrders(batch: FactRecord[], limit: number): FactRecord[][] {
    const inBatch = new Set(batch.map(factKey));
    const orders = permutations(batch).filter(order => {
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
    const step = Math.max(1, Math.floor(orders.length / limit));
    return orders.filter((_, index) => index % step === 0).slice(0, limit);
}

async function runEngine(rules: AuthorizationRules, instance: Instance, order: FactRecord[]) {
    const store = new MemoryStore();
    await store.save(instance.storeRecords.map(fact => ({ fact, signatures: [] })));
    const engine = new AuthorizationEngine(rules, store);
    const envelopes: FactEnvelope[] = order.map(fact => ({ fact, signatures: [] }));
    return engine.authorizeFacts(envelopes, instance.userFact).catch(error => error as Error);
}

describe("Authorization of a batch, against brute-force ground truth", () => {
    it("accepts exactly the ground-truth set, whatever order the batch arrives in", async () => {
        const random = seededRandom(0x396f1c);
        let checked = 0;
        let refusedRuleSets = 0;
        let partiallyAccepted = 0;

        for (let index = 0; index < 150; index++) {
            const instance = generateInstance(random, index);
            if (instance.batch.length < 2) {
                continue;
            }

            let rules: AuthorizationRules;
            try {
                rules = AuthorizationRules.loadFromDescription(instance.description);
            }
            catch (error) {
                // A negative cycle has no order of evaluation that settles it,
                // so the rule set is refused where it is written.
                expect(error).toBeInstanceOf(AuthorizationRuleError);
                refusedRuleSets++;
                continue;
            }

            const orders = topologicalOrders(instance.batch, 4);
            const first = await runEngine(rules, instance, orders[0]);
            if (first instanceof AuthorizationRuleError) {
                // A predecessor role that no rule writes is first seen in the
                // batch, and this one closes a cycle the description could not.
                refusedRuleSets++;
                continue;
            }

            const truth = groundTruthSets(instance);
            expect(truth.length).toEqual(1);
            const expected = truth[0];
            const refused = instance.batch.filter(fact => !expected.some(e => factKey(e) === factKey(fact)));
            checked++;
            if (refused.length > 0) {
                partiallyAccepted++;
            }

            for (const order of orders) {
                const result = index === 0 && order === orders[0] ? first : await runEngine(rules, instance, order);
                if (refused.length === 0) {
                    expect(Array.isArray(result)).toBe(true);
                    const verdicts = result as unknown as { verdict: string }[];
                    expect(verdicts.every(v => v.verdict === "Accept")).toBe(true);
                }
                else {
                    expect(result).toBeInstanceOf(Forbidden);
                    const message = (result as Error).message;
                    const count = refused.length === 1 ? "1 fact" : `${refused.length} facts`;
                    expect(message).toContain(`Rejected ${count} of type`);
                    for (const type of new Set(refused.map(f => f.type))) {
                        expect(message).toContain(type);
                    }
                }
            }

            // The ground-truth set is closed under predecessors, so it is a
            // batch of its own, and every fact in it is accepted.
            if (expected.length > 0) {
                const accepted = await runEngine(rules, instance, expected);
                expect(Array.isArray(accepted)).toBe(true);
                const verdicts = accepted as unknown as { verdict: string }[];
                expect(verdicts.every(v => v.verdict === "Accept")).toBe(true);
            }
        }

        // The run is only evidence if it reached a useful number of rule sets,
        // and if some of them refused part of their batch.
        expect(checked).toBeGreaterThan(40);
        expect(partiallyAccepted).toBeGreaterThan(5);
        expect(refusedRuleSets).toBeGreaterThan(0);
    }, 60000);
});
