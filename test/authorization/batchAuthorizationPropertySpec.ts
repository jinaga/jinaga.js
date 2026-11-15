import { AuthorizationEngine, AuthorizationRuleError, AuthorizationRules, FactEnvelope, FactRecord, FactReference, Forbidden, MemoryStore, PredecessorCollection, computeHash, dehydrateFact } from "@src";

// Issue #396's simulation, ported as a property test.
//
// The simulation abstracts a rule's tail to a random relation between facts.
// Here the relation is "under the same root": every generated fact hangs off one
// root, and every clause of a rule reaches the facts of a type under that root.
// The rules are built as text and parsed, so the specifications the engine runs
// are real ones.
//
// The expectation is computed independently of the engine, by brute force over
// the subsets of the batch. A fact is admitted when its predecessors are stored
// or accepted, its positive clauses are satisfied by the store plus the facts
// accepted so far, and its negative clauses are satisfied by the store as it
// was before the batch. A subset S is a fixpoint when S is exactly the facts of
// the batch admitted with that positive view; the engine has to accept the
// least such S, whatever order the batch arrives in.
//
// The negative view is fixed, so accepting a fact can only satisfy more
// positive clauses and never withdraw a negative one. The operator is therefore
// monotone and the least fixpoint is unique, which this suite asserts rather
// than assumes.

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
 * Whether the rules admit `fact`. Its predecessors and its positive clauses
 * read `positive`, the store plus the facts accepted so far; its negative
 * clauses, and the condition nested inside one, read `negative`, the store as
 * it was before the batch. The clauses are read off the generated rule rather
 * than from the engine, and the relation is "under the same root", which every
 * generated fact satisfies.
 */
function admitted(fact: FactRecord, positive: FactRecord[], negative: FactRecord[], types: GeneratedType[]): boolean {
    const keys = new Set(positive.map(factKey));
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
            if (!positive.some(f => f.type === clause.type)) {
                return false;
            }
        }
        else if (clause.kind === "neg") {
            if (negative.some(f => f.type === clause.type)) {
                return false;
            }
        }
        else {
            const witness = negative.some(f => f.type === clause.outer) &&
                !negative.some(f => f.type === clause.inner);
            if (witness) {
                return false;
            }
        }
    }
    return true;
}

function admittedSet(candidates: FactRecord[], positive: FactRecord[], negative: FactRecord[], types: GeneratedType[]): FactRecord[] {
    return candidates.filter(fact => admitted(fact, positive, negative, types));
}

function sameSet(a: FactRecord[], b: FactRecord[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    const keys = new Set(a.map(factKey));
    return b.every(fact => keys.has(factKey(fact)));
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

/** Every subset of the batch that is exactly the set it admits. */
function fixpoints(instance: Instance): FactRecord[][] {
    const negative = instance.storedGenerated;
    return subsetsOf(instance.batch).filter(subset => {
        const positive = [ ...instance.storedGenerated, ...subset ];
        return sameSet(subset, admittedSet(instance.batch, positive, negative, instance.types));
    });
}

function isSubset(a: FactRecord[], b: FactRecord[]): boolean {
    const keys = new Set(b.map(factKey));
    return a.every(fact => keys.has(factKey(fact)));
}

/**
 * The fixpoint contained in every other, which is the set the engine has to
 * accept. Returns null when there is none, so the suite reports that rather
 * than picking one.
 */
function leastFixpoint(instance: Instance): FactRecord[] | null {
    const sets = fixpoints(instance);
    const least = sets.filter(candidate => sets.every(other => isSubset(candidate, other)));
    return least.length === 1 ? least[0] : null;
}

/**
 * Whether the accepted set holds a fact whose own prohibition was accepted
 * alongside it. That is the trade this semantics makes, and a run that never
 * reaches one is not evidence about it.
 */
function admitsAFactItsOwnBatchForbids(accepted: FactRecord[], instance: Instance): boolean {
    const full = [ ...instance.storedGenerated, ...accepted ];
    return accepted.some(fact => !admitted(fact, full, full, instance.types));
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
    it("accepts exactly the least fixpoint, whatever order the batch arrives in", async () => {
        const random = seededRandom(0x396f1c);
        let checked = 0;
        let partiallyAccepted = 0;
        let forbiddenByTheirOwnBatch = 0;

        for (let index = 0; index < 150; index++) {
            const instance = generateInstance(random, index);
            if (instance.batch.length < 2) {
                continue;
            }

            // Criterion 6. No shape is refused, however its negative clauses
            // run, so every generated rule set declares.
            const rules: AuthorizationRules = AuthorizationRules.loadFromDescription(instance.description);

            const orders = topologicalOrders(instance.batch, 4);
            const expected = leastFixpoint(instance);
            expect(expected).not.toBeNull();
            const refused = instance.batch.filter(fact => !expected!.some(e => factKey(e) === factKey(fact)));
            checked++;
            if (refused.length > 0) {
                partiallyAccepted++;
            }
            if (admitsAFactItsOwnBatchForbids(expected!, instance)) {
                forbiddenByTheirOwnBatch++;
            }

            for (const order of orders) {
                const result = await runEngine(rules, instance, order);
                // Nothing is refused for its shape, at declaration or here.
                expect(result).not.toBeInstanceOf(AuthorizationRuleError);
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

            // The least fixpoint is closed under predecessors, so it is a batch
            // of its own, and every fact in it is accepted.
            if (expected!.length > 0) {
                const accepted = await runEngine(rules, instance, expected!);
                expect(Array.isArray(accepted)).toBe(true);
                const verdicts = accepted as unknown as { verdict: string }[];
                expect(verdicts.every(v => v.verdict === "Accept")).toBe(true);
            }
        }

        // The run is only evidence if it reached a useful number of rule sets,
        // if some of them refused part of their batch, and if some admitted a
        // fact whose prohibition travelled with it. That last one is the trade
        // the issue's answer chooses, and a run that never hit it would pass
        // whichever way negation read the batch.
        expect(checked).toBeGreaterThan(40);
        expect(partiallyAccepted).toBeGreaterThan(5);
        expect(forbiddenByTheirOwnBatch).toBeGreaterThan(0);
    }, 60000);
});
