import { computeStringHash } from "../util/encoding";
import { describeSpecification } from "./description";
import {
    Condition,
    ExistentialCondition,
    Label,
    Match,
    PathCondition,
    Projection,
    Specification,
    isPathCondition
} from "./specification";

/**
 * jinaga-spec's proven inverse algorithm, `candidates`
 * (`JinagaSpec/Candidates.lean`, `JinagaSpec/Reorder.lean`, jinaga/jinaga-spec#7
 * and #11), ported from `ports/typescript/inverse-candidates.ts` at jinaga-spec
 * `07d5788576975265a6179270a857e954c5678185`.
 *
 * What it guarantees: take a well-formed specification, a subscription's
 * givens, a replica's graph, and a *fresh batch* of facts — no fact stored
 * before the batch has the hash of a fact in it, or names one as a predecessor,
 * though facts of the batch may name each other. Then every row whose
 * membership in the result changes when the batch is saved is among the rows
 * these inverses find, read with the subscription's givens and one of the
 * batch's facts, on the store that holds the whole batch
 * (`candidates_complete`). They may find more: the candidates are a superset,
 * and the row stream re-checks each one against a read of the specification
 * (#336), which is what makes the stream exact (`stream_correct`).
 *
 * That is why an inverse here carries no "add" or "remove" operation, unlike
 * `invertSpecification`. A candidate from any inverse may be an add, a remove,
 * or no change, and only the re-check decides.
 *
 * These inverses are internal. `pinLabel` starts with the prefix the parser
 * reserves, on purpose, so it can never collide with a declared label — so do
 * not pass an inverse through `validateSpecification` or the parser.
 */

/** The label an inverse gives the new fact. Reserved, so no specification declares it. */
export const pinLabel = "__f";

const pinCondition: PathCondition = { type: "path", rolesLeft: [], labelRight: pinLabel, rolesRight: [] };

/** Structural equality: never object identity. */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a as object), kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every(k => deepEqual((a as any)[k], (b as any)[k]));
}

function removeFirst<T>(list: T[], item: T): T[] {
    const i = list.findIndex(x => deepEqual(x, item));
    return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)];
}

/* ---------------- Step 1: one inverse per way the new fact can touch a row ---------------- */

interface Touch<T> {
    pinned: Label;
    value: T;
}

/** A level that lost its solution keeps only its path conditions, in order. */
function relax(gained: boolean, conditions: Condition[]): Condition[] {
    return gained ? conditions : conditions.filter(isPathCondition);
}

function relaxMatches(gained: boolean, matches: Match[]): Match[] {
    return gained ? matches : matches.map(m => ({ unknown: m.unknown, conditions: relax(false, m.conditions) }));
}

/** Every way the new fact can change a solution of `matches`, in direction `gained`. */
function touchMatches(gained: boolean, matches: Match[]): Touch<Match[]>[] {
    if (matches.length === 0) return [];
    const [m, ...rest] = matches;
    const out: Touch<Match[]>[] = [];
    // Pin this unknown. Only a gained solution can contain the new fact.
    if (gained) {
        out.push({ pinned: m.unknown, value: [{ unknown: m.unknown, conditions: [pinCondition, ...m.conditions] }, ...rest] });
    }
    // Through one of this match's conditions; the matches after it relax.
    for (const t of touchConditions(gained, m.conditions)) {
        out.push({ pinned: t.pinned, value: [{ unknown: m.unknown, conditions: t.value }, ...relaxMatches(gained, rest)] });
    }
    // In the matches after it; this match relaxes.
    for (const t of touchMatches(gained, rest)) {
        out.push({ pinned: t.pinned, value: [{ unknown: m.unknown, conditions: relax(gained, m.conditions) }, ...t.value] });
    }
    return out;
}

/** Through exactly one condition; the others relax. */
function touchConditions(gained: boolean, conditions: Condition[]): Touch<Condition[]>[] {
    if (conditions.length === 0) return [];
    const [c, ...cs] = conditions;
    const out: Touch<Condition[]>[] = [];
    for (const t of touchCondition(gained, c)) {
        out.push({ pinned: t.pinned, value: [t.value, ...relax(gained, cs)] });
    }
    for (const t of touchConditions(gained, cs)) {
        out.push({ pinned: t.pinned, value: [...relax(gained, [c]), ...t.value] });
    }
    return out;
}

/** Into an existential condition, which becomes `exists: true`. Inside a notExists, a gain is a loss. */
function touchCondition(gained: boolean, c: Condition): Touch<Condition>[] {
    if (isPathCondition(c)) return [];
    return touchMatches(gained === c.exists, c.matches)
        .map(t => ({ pinned: t.pinned, value: { type: "existential", exists: true, matches: t.value } as ExistentialCondition }));
}

/**
 * Step 1: every inverse, given the subscription's givens and the new fact as
 * `__f`. All the gained touches come first, then all the lost ones, in exactly
 * this order and with nothing deduplicated: jinaga-spec's
 * `run-inverse-vectors.ts` deep-equals this output against each vector's
 * expected inverses.
 *
 * This is the proven definition, which has no conditions on a given. Callers
 * reach it through `candidateInverses`, which reduces those away first.
 */
export function buildInverses(specification: Specification): Specification[] {
    return [...touchMatches(true, specification.matches), ...touchMatches(false, specification.matches)].map(t => ({
        given: [...specification.given, { label: { name: pinLabel, type: t.pinned.type }, conditions: [] }],
        matches: t.value,
        projection: specification.projection
    }));
}

/* ---------------- Step 2: start each inverse at the new fact, and check it ---------------- */

const isPin = (c: Condition) =>
    isPathCondition(c) && c.rolesLeft.length === 0 && c.labelRight === pinLabel && c.rolesRight.length === 0;
const pinnedMatches = (ms: Match[]): boolean => ms.some(m => m.conditions.some(pinnedCondition));
const pinnedCondition = (c: Condition): boolean => isPathCondition(c) ? isPin(c) : pinnedMatches(c.matches);

/** Lift the matches of every `exists` condition that holds the pin, right after the match that held it. */
function flattenMatches(ms: Match[]): Match[] {
    return ms.flatMap(m => {
        const keep: Condition[] = [];
        const lifted: Match[] = [];
        for (const c of m.conditions) {
            if (!isPathCondition(c) && c.exists && pinnedMatches(c.matches)) lifted.push(...flattenMatches(c.matches));
            else keep.push(c);
        }
        return [{ unknown: m.unknown, conditions: keep }, ...lifted];
    });
}

/** A path condition and the match it is written on. */
interface Edge {
    home: string;
    condition: PathCondition;
}

/** `r->R = u->L` instead of `u->L = r->R`. */
const reverse = (e: Edge): Edge => ({
    home: e.condition.labelRight,
    condition: { type: "path", rolesLeft: e.condition.rolesRight, labelRight: e.home, rolesRight: e.condition.rolesLeft }
});

/** Labels the matches name but do not bind; `inner` holds the labels bound around them. */
function freeInMatches(inner: string[], ms: Match[]): string[] {
    return ms.flatMap(m => freeInConditions(inner, m.conditions));
}

function freeInConditions(inner: string[], cs: Condition[]): string[] {
    return cs.flatMap(c => isPathCondition(c)
        ? (inner.includes(c.labelRight) ? [] : [c.labelRight])
        : freeInMatches([...inner, ...c.matches.map(m => m.unknown.name)], c.matches));
}

const freeLabels = (c: Condition): string[] =>
    isPathCondition(c) ? [c.labelRight] : freeInMatches(c.matches.map(m => m.unknown.name), c.matches);

/** First what the new fact reaches, then what the givens reach; `null` if anything is left. */
function orderFromPin(givens: string[], ms: Match[]): Match[] | null {
    let labels: Label[] = ms.map(m => m.unknown);
    let edges: Edge[] = ms.flatMap(m => m.conditions.filter(isPathCondition).map(c => ({ home: m.unknown.name, condition: c })));
    let filters: Condition[] = ms.flatMap(m => m.conditions.filter(c => !isPathCondition(c)));

    const reaching = (reach: string[], u: string, e: Edge): [Edge, Edge] | null =>
        e.home === u && reach.includes(e.condition.labelRight) ? [e, e] :
        e.condition.labelRight === u && reach.includes(e.home) ? [e, reverse(e)] : null;

    function grow(reach: string[], bound: string[]): { bound: string[], placed: Match[] } {
        const placed: Match[] = [];
        for (let n = ms.length; n > 0; n--) {
            // The first pending label, in pending order, that the first pending
            // edge, in pending order, reaches.
            let found: { u: Label, lead: [Edge, Edge] } | null = null;
            for (const u of labels) {
                for (const e of edges) {
                    const lead = reaching(reach, u.name, e);
                    if (lead) { found = { u, lead }; break; }
                }
                if (found) break;
            }
            if (!found) break;
            const { u, lead } = found;
            bound = [u.name, ...bound];
            reach = [u.name, ...reach];
            const ready = (e: Edge) => bound.includes(e.home) && bound.includes(e.condition.labelRight);
            const isReady = (c: Condition) => freeLabels(c).every(l => bound.includes(l));
            edges = removeFirst(edges, lead[0]);
            const attached = edges.filter(ready);
            const attachedFilters = filters.filter(isReady);
            edges = edges.filter(e => !ready(e));
            filters = filters.filter(c => !isReady(c));
            labels = removeFirst(labels, u);
            placed.push({
                unknown: u,
                conditions: [
                    lead[1].condition,
                    ...attached.map(e => (e.home === u.name ? e : reverse(e)).condition),
                    ...attachedFilters
                ]
            });
        }
        return { bound, placed };
    }

    const fromPin = grow([pinLabel], [pinLabel, ...givens]);
    const fromGivens = grow(fromPin.bound, fromPin.bound);
    return labels.length === 0 && edges.length === 0 && filters.length === 0
        ? [...fromPin.placed, ...fromGivens.placed] : null;
}

/** Every path condition names a label in scope; a match's unknown is in scope for its existential conditions. */
function isScoped(scope: string[], ms: Match[]): boolean {
    for (const m of ms) {
        const inner = [m.unknown.name, ...scope];
        for (const c of m.conditions) {
            if (isPathCondition(c) ? !scope.includes(c.labelRight) : !isScoped(inner, c.matches)) return false;
        }
        scope = inner;
    }
    return true;
}

function bindsOnce(scope: string[], ms: Match[]): boolean {
    const names = ms.map(m => m.unknown.name);
    return new Set(names).size === names.length && names.every(n => !scope.includes(n)) && isScoped(scope, ms);
}

/** As written; a path condition reversed onto its other end; an existential condition on any match. */
function sameConstraint([u1, c1]: [string, Condition], [u2, c2]: [string, Condition]): boolean {
    if (isPathCondition(c1) && isPathCondition(c2)) {
        return (u1 === u2 && deepEqual(c1, c2)) ||
            (u2 === c1.labelRight && deepEqual(reverse({ home: u1, condition: c1 }), { home: u2, condition: c2 }));
    }
    return deepEqual(c1, c2);
}

const constraints = (ms: Match[]) => ms.flatMap(m => m.conditions.map(c => [m.unknown.name, c] as [string, Condition]));
const covers = (a: Match[], b: Match[]) => constraints(a).every(x => constraints(b).some(y => sameConstraint(x, y)));

/** `b` is an arrangement of `a`: the same unknowns, each bound once, and the same conditions. */
function arranges(scope: string[], a: Match[], b: Match[]): boolean {
    return bindsOnce(scope, a) && bindsOnce(scope, b) &&
        a.every(m => b.some(n => deepEqual(m.unknown, n.unknown))) &&
        b.every(m => a.some(n => deepEqual(m.unknown, n.unknown))) &&
        covers(a, b) && covers(b, a);
}

/** Every label the projection reads from this level. */
function projectionLabels(projection: Projection): string[] {
    switch (projection.type) {
        case "fact": case "field": case "hash": case "time": return [projection.label];
        case "composite": return projection.components.flatMap(c =>
            c.type === "specification" ? freeInMatches(c.matches.map(m => m.unknown.name), c.matches) : [c.label]);
    }
}

/**
 * Step 2: the inverse reordered to start at the new fact if the result checks,
 * and otherwise the inverse itself.
 *
 * Read in step 1's order, an inverse starts at the subscription's givens, so a
 * pin inside an existential condition is checked once per row of the
 * collection — a new `Deletion` under a `notExists` would read every message of
 * the channel. Reordering makes the read walk up from the new fact instead.
 *
 * The correctness proof is about the check rather than about `orderFromPin`, so
 * the check is not optional. It fails only when a name repeats after
 * flattening, which happens when a later match reuses a name an existential
 * condition declared (#343). Those inverses stay in step 1's order: correct,
 * but read from the givens.
 */
export function reorderInverse(inverse: Specification): Specification {
    const givens = inverse.given.map(g => g.label.name).filter(n => n !== pinLabel);
    const scope = [pinLabel, ...givens];
    const flat = flattenMatches(inverse.matches);
    const ordered = orderFromPin(givens, flat);
    const ok = ordered !== null && isScoped(scope, inverse.matches) && arranges(scope, flat, ordered) &&
        projectionLabels(inverse.projection).every(l => scope.includes(l) || inverse.matches.some(m => m.unknown.name === l));
    return ok ? { ...inverse, matches: ordered! } : inverse;
}

/* ---------------- Outside the proof: conditions on a given ---------------- */

/**
 * The proof's language has no conditions on a given, so move each given's
 * conditions onto a new first match that joins back to the given.
 *
 * An existential condition does not read the match it is written on, so a
 * condition on `given[i]` means the same thing written on a fresh unknown of
 * the same type that is joined to `given[i]` by identity. The reduction is not
 * proven, unlike everything above it.
 */
function reduceGivenConditions(specification: Specification): Specification {
    if (specification.given.every(g => g.conditions.length === 0)) {
        return specification;
    }
    const conditionMatches: Match[] = [];
    specification.given.forEach((given, index) => {
        if (given.conditions.length > 0) {
            conditionMatches.push({
                unknown: { name: `__g${index}`, type: given.label.type },
                conditions: [
                    { type: "path", rolesLeft: [], labelRight: given.label.name, rolesRight: [] },
                    ...given.conditions
                ]
            });
        }
    });
    return {
        given: specification.given.map(g => ({ label: g.label, conditions: [] })),
        matches: [...conditionMatches, ...specification.matches],
        projection: specification.projection
    };
}

/* ---------------- The whole algorithm, cached ---------------- */

/**
 * How many distinct specifications the candidate cache retains.
 *
 * `candidateInverses` is a pure function of the specification, and a
 * subscription computes it once per specification it watches, so the bound is
 * what keeps a caller that generates specifications dynamically from growing
 * the cache without limit. Entries are evicted least-recently-used.
 */
const CANDIDATE_CACHE_CAPACITY = 500;

const candidateCache = new Map<string, Specification[]>();

/**
 * Every inverse of the specification, each read with
 * `[...subscriptionGivenRefs, newFactRef]`. Every resulting tuple is a
 * candidate for a row whose membership changed, to be re-checked (#336).
 *
 * Memoized on the specification's STRUCTURE rather than its identity, as
 * `invertSpecification` is and for the same reason: a server sees separate
 * object graphs of a handful of shapes, so object-identity memoization would
 * miss every one of them. The returned array is a copy, so one caller's
 * in-place sort cannot reorder what a later caller sees.
 */
export function candidateInverses(specification: Specification): Specification[] {
    const key = computeStringHash(describeSpecification(specification, 0));
    const cached = candidateCache.get(key);
    if (cached !== undefined) {
        // Re-insert to mark the entry most recently used.
        candidateCache.delete(key);
        candidateCache.set(key, cached);
        return [...cached];
    }

    const inverses = buildInverses(reduceGivenConditions(specification)).map(reorderInverse);
    candidateCache.set(key, inverses);
    while (candidateCache.size > CANDIDATE_CACHE_CAPACITY) {
        const oldest = candidateCache.keys().next();
        if (oldest.done) {
            break;
        }
        candidateCache.delete(oldest.value);
    }
    return [...inverses];
}
