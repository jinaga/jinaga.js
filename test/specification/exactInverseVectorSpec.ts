import { readFileSync } from "fs";
import { join } from "path";
import { FactRecord, FactReference, MemoryStore } from "@src";
import { exactInverses } from "../../src/specification/inverse-candidates";
import { Match, Specification, isPathCondition } from "../../src/specification/specification";

// Issue #375. jinaga-spec proves that a small strengthening of the candidate
// inverses is exact: every row an add inverse returns is in the new result
// (`adds_sound`), every row a remove inverse returns is absent from it
// (`removes_sound`), and together they report every row that changed
// (`changes_complete`, `exact_correct`, `exact_stream_correct`).
//
// `exact-inverse-vectors.json` holds 39 cases generated from those Lean
// definitions at jinaga-spec `65a5d18524a05e7720f3b58e5a9b59d9e1b523bf`
// (jinaga/jinaga-spec#19): the named inverse cases, then the fixed-seed random
// ones. Each case carries a specification, the graph already stored, the
// subscription's givens, the facts that arrive, the specification's top-level
// unknowns as `keyLabels`, and the rows `gained`, `lost`, `adds` and
// `removes`. A fact id stands in for a hash, so a case reads as its graph.
//
// `adds` and `removes` are jinaga-spec's `changes`, with the row identity the
// observer uses: every top-level unknown. Always `gained` is within `adds`,
// `lost` is within `removes`, and the two are disjoint — a row in `adds` the
// reader already held, or in `removes` it never held, is a no-op.
//
// The vectors are generated from the proof. Never edit one to match the
// library: a failing case means the two disagree.

/** A fact of a case's graph or batch. `id` stands in for the hash. */
interface VectorFact {
    id: number;
    type: string;
    predecessors: { role: string, id: number }[];
}

type Row = (number | null)[];

interface Vector {
    name: string;
    specification: Specification;
    givens: { [label: string]: number };
    graph: VectorFact[];
    fact?: VectorFact;
    batch?: VectorFact[];
    keyLabels: string[];
    expected: { gained: Row[], lost: Row[], adds: Row[], removes: Row[] };
}

// `tsconfig.test.json` has no `resolveJsonModule`, so the fixture is read
// rather than imported.
const vectors: Vector[] = JSON.parse(
    readFileSync(join(__dirname, "exact-inverse-vectors.json"), "utf8"));

/** The facts that arrive together: a batch, or a single fact. */
const arrivals = (vector: Vector): VectorFact[] => vector.batch ?? [vector.fact!];

const key = (row: Row) => JSON.stringify(row);

/** A store holding the case's graph and then every fact that arrives. */
async function storeOf(vector: Vector) {
    const facts = [...vector.graph, ...arrivals(vector)];
    const typeOf = new Map<number, string>(facts.map(f => [f.id, f.type]));
    const reference = (id: number): FactReference => ({ type: typeOf.get(id)!, hash: `h${id}` });
    const record = (fact: VectorFact): FactRecord => {
        const predecessors: FactRecord["predecessors"] = {};
        for (const predecessor of fact.predecessors) {
            const existing = predecessors[predecessor.role];
            const value = reference(predecessor.id);
            predecessors[predecessor.role] = Array.isArray(existing) ? [...existing, value] : [value];
        }
        return { type: fact.type, hash: `h${fact.id}`, predecessors, fields: {} };
    };
    const store = new MemoryStore();
    const save = (list: VectorFact[]) =>
        store.save(list.map(fact => ({ fact: record(fact), signatures: [] })));
    await save(vector.graph);
    await save(arrivals(vector));
    return { store, reference };
}

/**
 * Read one specification and key each solution by the case's `keyLabels`. An
 * inverse is read from the subscription's givens, in order, and then the new
 * fact, which `exactInverses` pins last.
 */
async function readRows(
    store: MemoryStore,
    vector: Vector,
    specification: Specification,
    start: FactReference[]
): Promise<Row[]> {
    const results = await store.read(start, specification);
    return results.map(result => vector.keyLabels.map(label => {
        const bound = result.tuple[label];
        return bound ? Number(bound.hash.slice(1)) : null;
    }));
}

const sorted = (rows: Iterable<string>) => [...rows].sort();

describe("exact inverse vectors", () => {
    it("covers the cases the fixture carries", () => {
        // The count is the fixture's own, so a truncated copy is a failure
        // rather than a quieter suite.
        expect(vectors.length).toBe(39);
    });

    it.each(vectors.map(vector => [vector.name, vector] as [string, Vector]))(
        "reports the exact changes of %s", async (_name, vector) => {
            const { store, reference } = await storeOf(vector);
            const givenRefs = vector.specification.given.map(g => reference(vector.givens[g.label.name]));

            const adds = new Set<string>();
            const removes = new Set<string>();
            for (const fact of arrivals(vector)) {
                const isGiven = vector.specification.given.some(g => vector.givens[g.label.name] === fact.id);
                if (isGiven) {
                    // Nothing was read before the subscription's given arrived,
                    // so every row read now is added and none is removed.
                    for (const row of await readRows(store, vector, vector.specification, givenRefs)) {
                        adds.add(key(row));
                    }
                    continue;
                }
                const start = [...givenRefs, reference(fact.id)];
                const inverses = exactInverses(vector.specification);
                for (const inverse of inverses.adds) {
                    for (const row of await readRows(store, vector, inverse, start)) {
                        adds.add(key(row));
                    }
                }
                for (const inverse of inverses.removes) {
                    for (const row of await readRows(store, vector, inverse, start)) {
                        removes.add(key(row));
                    }
                }
            }

            expect(sorted(adds)).toEqual(sorted(vector.expected.adds.map(key)));
            expect(sorted(removes)).toEqual(sorted(vector.expected.removes.map(key)));

            // A check on the harness itself, which the proof also states.
            for (const row of vector.expected.gained) {
                expect(adds.has(key(row))).toBe(true);
            }
            for (const row of vector.expected.lost) {
                expect(removes.has(key(row))).toBe(true);
            }
            expect([...adds].filter(row => removes.has(row))).toEqual([]);
        });

    it("builds no match that carries a condition twice", () => {
        // A duplicated join is not harmless in every store: jinaga.net's SQLite
        // generator returns no rows for one (jinaga/jinaga.net#330).
        const duplicated: string[] = [];
        for (const vector of vectors) {
            const inverses = exactInverses(vector.specification);
            for (const inverse of [...inverses.adds, ...inverses.removes]) {
                if (hasDuplicate(inverse.matches)) {
                    duplicated.push(vector.name);
                    break;
                }
            }
        }
        expect(duplicated).toEqual([]);
    });
});

/** Any match, at any depth, carrying two structurally equal conditions. */
function hasDuplicate(matches: Match[]): boolean {
    return matches.some(match =>
        match.conditions.some((condition, index) =>
            match.conditions.slice(index + 1).some(other => deepEqual(condition, other))) ||
        match.conditions.some(condition => !isPathCondition(condition) && hasDuplicate(condition.matches)));
}

/** Structural equality: never object identity. */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a as object), kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every(k => deepEqual((a as any)[k], (b as any)[k]));
}
