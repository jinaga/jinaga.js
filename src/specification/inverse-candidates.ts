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
    SpecificationGiven,
    isExistentialCondition,
    isPathCondition,
    reservedLabelPrefix
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
 * so a consumer of them re-checks each one against a read of the specification
 * (#336), which is what made a stream built on them exact (`stream_correct`).
 *
 * That is why a candidate carries no "add" or "remove" operation, unlike an
 * inverse of `invertSpecification`. A candidate from any inverse that
 * `candidateInverses` returns may be an add, a remove, or no change, and only
 * such a re-check decides.
 *
 * No consumer in this library reads `candidateInverses` any more: the observer
 * moved to `exactInverses` in #376 and the row stream in #377. It stays because
 * it is this library's port of jinaga-spec's `candidates`, which the
 * conformance runners check, and `buildInverses` beneath it is deep-equaled by
 * them.
 *
 * `exactInverses` reports changes rather than proposing candidates. jinaga-spec
 * has since proved (`JinagaSpec/Exact.lean`, `JinagaSpec/Proofs/Exact.lean`,
 * jinaga/jinaga-spec#19) that a small strengthening of the same inverses is
 * exact: every row an add inverse returns is in the new result
 * (`adds_sound`), every row a remove inverse returns is absent from it
 * (`removes_sound`), and together they report every row that changed
 * (`changes_complete`, `exact_correct`, `exact_stream_correct`). The remove
 * direction needs `ProjectsUnknowns` — the row identity names every top-level
 * unknown, so a row determines its solution.
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
    return [...inversesFor(true, specification), ...inversesFor(false, specification)];
}

/**
 * Every inverse in one direction, given the subscription's givens and the new
 * fact as `__f`. `buildInverses` is the two concatenated, in that order, and
 * the exact inverses strengthen each direction on its own.
 */
function inversesFor(gained: boolean, specification: Specification): Specification[] {
    return touchMatches(gained, specification.matches).map(t => ({
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

/* ---------------- Conditions on a given, reduced as jinaga-spec proves ---------------- */

/** Every label a list of matches declares or names, at any depth. */
function labelsInMatches(matches: Match[]): string[] {
    return matches.flatMap(m => [m.unknown.name, ...m.conditions.flatMap(c =>
        c.type === "path" ? [c.labelRight] : labelsInMatches(c.matches))]);
}

/** Every label a projection names, including those inside nested specifications. */
function labelsInProjection(projection: Projection): string[] {
    switch (projection.type) {
        case "fact": case "field": case "hash": case "time": return [projection.label];
        case "composite": return projection.components.flatMap(c =>
            c.type === "specification"
                ? [...labelsInMatches(c.matches), ...labelsInProjection(c.projection)]
                : [c.label]);
    }
}

/**
 * Move every condition on a given onto one new first match, bound to the first
 * given that has a condition. An existential condition does not read the match
 * it is written on, so one match serves every given's conditions. Its label is
 * the first of `given`, `given2`, `given3`, ... that the specification does not
 * name. jinaga-spec proves the result reads the same rows
 * (`read_reduceGivenConditions`), so the candidates of its inverses are
 * complete (`stream_correct_given`, jinaga/jinaga-spec#16).
 */
export function reduceGivenConditions(specification: Specification): Specification {
    const first = specification.given.find(g => g.conditions.length > 0);
    if (!first) {
        return specification;
    }
    const conditions = specification.given.flatMap(g => g.conditions);
    const used = new Set([
        ...specification.given.map(g => g.label.name),
        ...labelsInMatches(conditions.flatMap(c => c.matches)),
        ...labelsInMatches(specification.matches),
        ...labelsInProjection(specification.projection)
    ]);
    let k = 1;
    while (used.has(k === 1 ? "given" : `given${k}`)) {
        k++;
    }
    const label = k === 1 ? "given" : `given${k}`;
    return {
        given: specification.given.map(g => ({ label: g.label, conditions: [] })),
        matches: [
            {
                unknown: { name: label, type: first.label.type },
                conditions: [
                    { type: "path", rolesLeft: [], labelRight: first.label.name, rolesRight: [] },
                    ...conditions
                ]
            },
            ...specification.matches
        ],
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

/* ---------------- Exact inverses: the same construction, by direction ---------------- */

/**
 * Two match lists over the same unknowns, as one: match by match, the unknown,
 * and the conditions of both. Every inverse `touchMatches` builds keeps the
 * original's top-level unknowns in order, so the zip is well defined.
 *
 * A condition of the second list structurally equal to one the match already
 * carries is dropped. That is Lean's `conj` with duplicates removed; a
 * conjunction is idempotent, so the solutions are the same. The duplicates are
 * not harmless in every store: jinaga.net's SQLite generator returns no rows
 * for a duplicated join (jinaga/jinaga.net#330), and jinaga-server's Postgres
 * compiler has never run the shape, so neither port emits it.
 */
function conj(ms1: Match[], ms2: Match[]): Match[] {
    return ms1.map((m1, i) => ({
        unknown: m1.unknown,
        conditions: [...m1.conditions, ...ms2[i].conditions.filter(c => !m1.conditions.some(c1 => deepEqual(c1, c)))]
    }));
}

/**
 * The gained-direction inverses, each with every original top-level condition
 * re-attached. Every solution one finds is then a solution of the
 * specification on the new graph, so its row is in the new result.
 */
function addInverses(specification: Specification): Specification[] {
    return inversesFor(true, specification).map(inverse => ({
        ...inverse,
        matches: conj(inverse.matches, specification.matches)
    }));
}

/** The existential condition that asks the opposite. */
const flip = (condition: ExistentialCondition): ExistentialCondition => ({ ...condition, exists: !condition.exists });

/**
 * For each top-level match and each existential condition on it: the same
 * unknowns, with no conditions but that one flipped, on that match.
 *
 * A path condition cannot change on a fresh batch, so it is not flipped, and a
 * specification with no top-level existential condition yields no test — a row
 * can be lost only when one of them flips.
 */
function removeTests(matches: Match[]): Match[][] {
    if (matches.length === 0) {
        return [];
    }
    const [m, ...rest] = matches;
    const cleared = rest.map(r => ({ unknown: r.unknown, conditions: [] }));
    return [
        ...m.conditions.filter(isExistentialCondition)
            .map(d => [{ unknown: m.unknown, conditions: [flip(d)] }, ...cleared]),
        ...removeTests(rest).map(t => [{ unknown: m.unknown, conditions: [] }, ...t])
    ];
}

/**
 * The lost-direction inverses, each strengthened by one remove test. Every
 * solution one finds fails the flipped condition on the new graph, so it is
 * not a solution of the specification there.
 */
function removeInverses(specification: Specification): Specification[] {
    return inversesFor(false, specification).flatMap(inverse =>
        removeTests(specification.matches).map(t => ({ ...inverse, matches: conj(inverse.matches, t) })));
}

/** The inverses that report a row added, and those that report one removed. */
export interface ExactInverses {
    adds: Specification[];
    removes: Specification[];
}

const exactCache = new Map<string, ExactInverses>();

/**
 * The exact inverses of the specification, each read with
 * `[...subscriptionGivenRefs, newFactRef]`. Every row an `adds` inverse
 * returns is in the new result, and every row a `removes` inverse returns is
 * absent from it, so a reader applies them without reading the specification
 * again. Together they report every row that changed.
 *
 * The guarantee is the one the module comment states, under the same
 * fresh-batch hypothesis as `candidateInverses`, and the remove direction
 * holds where the row identity names every top-level unknown.
 *
 * Memoized on the specification's STRUCTURE rather than its identity, and
 * bounded, exactly as `candidateInverses` is and for the same reasons. The
 * returned lists are copies, so one caller's in-place sort cannot reorder what
 * a later caller sees.
 */
export function exactInverses(specification: Specification): ExactInverses {
    const key = computeStringHash(describeSpecification(specification, 0));
    const cached = exactCache.get(key);
    if (cached !== undefined) {
        // Re-insert to mark the entry most recently used.
        exactCache.delete(key);
        exactCache.set(key, cached);
        return { adds: [...cached.adds], removes: [...cached.removes] };
    }

    const reduced = reduceGivenConditions(specification);
    const inverses: ExactInverses = {
        adds: addInverses(reduced).map(reorderInverse),
        removes: removeInverses(reduced).map(reorderInverse)
    };
    exactCache.set(key, inverses);
    while (exactCache.size > CANDIDATE_CACHE_CAPACITY) {
        const oldest = exactCache.keys().next();
        if (oldest.done) {
            break;
        }
        exactCache.delete(oldest.value);
    }
    return { adds: [...inverses.adds], removes: [...inverses.removes] };
}

/* ---------------- Membership: deciding one fully bound tuple ---------------- */

/**
 * A specification that decides ONE fully bound tuple, and the labels it binds.
 *
 * `specification`'s givens are the original specification's, followed by
 * `pinned` in order, so a read starts from
 * `[...subscriptionGivenRefs, ...pinnedRefs]`.
 */
export interface MembershipSpecification {
    specification: Specification;
    pinned: Label[];
}

/**
 * The specification rewritten to answer "is this tuple a row?" rather than
 * "which tuples are rows?".
 *
 * A candidate from `candidateInverses` binds every one of its level's match
 * unknowns, so deciding it is a membership test of one fully bound tuple rather
 * than a search. A tuple is a row exactly when each bound fact is in the graph
 * with its declared type, each path condition holds of that binding, and each
 * existential condition holds of it (`evalMatches` in
 * `JinagaSpec/Semantics.lean`). Re-reading the whole result to answer that
 * costs as much as the result holds, which is what made absorbing one save
 * grow with the size of the watch (#359).
 *
 * The rewrite pins each label in `pinned` as a given, and then says the three
 * conditions above in a form the runner can check without enumerating
 * successors:
 *
 * - A path condition `u->L = r->R` on a pinned `u` becomes an auxiliary match
 *   `__p<i>` bound to `u->L` and filtered to `r->R`. Both sides are
 *   predecessor walks from facts that are already bound, so each costs the
 *   length of its path. Written any other way it enumerates: `filterByCondition`
 *   walks a path condition from its right side through successors, so keeping
 *   `task->project = project` as a filter reads every task of the project —
 *   the whole result again.
 * - A pinned match's existential conditions move onto an identity match
 *   `__e<i>` equal to `u`, so they run unchanged against the bound tuple. An
 *   existential condition does not read the match it is written on, only the
 *   labels in scope around it, and those are all bound here.
 * - The specification's own projection is kept, so a nested collection is
 *   computed for that one row and the delivery path gets the result it needs.
 *
 * A match whose unknown is NOT in `pinned` is kept as written, in place. That
 * is what lets a distribution-intersected branch be decided: the row identity a
 * row stream holds covers the caller's own unknowns, which every branch carries
 * under the same names, while each branch's lifted authorization unknowns
 * differ and stay a search — over the authorization path, not over the result.
 *
 * The given facts' own existential conditions are carried through untouched;
 * `SpecificationRunner.read` evaluates those.
 *
 * Memoized on the specification's STRUCTURE and the pinned labels, as
 * `candidateInverses` is and for the same reason. The result is shared between
 * callers rather than copied, so a caller holds it and does not mutate it.
 *
 * NOT proven. jinaga-spec proves the re-check as membership in the full
 * evaluation (`maintain_correct` in `JinagaSpec/Maintain.lean`), and the
 * reduction to a per-tuple read follows from the definitions, but the lemma is
 * not stated there: Lean's `Row` holds only the projection's labels, so it
 * would have to be stated on full bindings. Until it is, the equivalence tests
 * in `test/observer/membershipSpecificationSpec.ts` are the gate.
 */
export function membershipSpecification(specification: Specification, pinned: string[]): MembershipSpecification {
    const key = computeStringHash(`${pinned.join(",")}\n${describeSpecification(specification, 0)}`);
    const cached = membershipCache.get(key);
    if (cached !== undefined) {
        // Re-insert to mark the entry most recently used.
        membershipCache.delete(key);
        membershipCache.set(key, cached);
        return cached;
    }

    const membership = buildMembership(specification, pinned);
    membershipCache.set(key, membership);
    while (membershipCache.size > CANDIDATE_CACHE_CAPACITY) {
        const oldest = membershipCache.keys().next();
        if (oldest.done) {
            break;
        }
        membershipCache.delete(oldest.value);
    }
    return membership;
}

const membershipCache = new Map<string, MembershipSpecification>();

function buildMembership(specification: Specification, pinned: string[]): MembershipSpecification {
    const unknowns = new Map(specification.matches.map(m => [m.unknown.name, m.unknown]));
    const pinnedLabels = pinned.map(name => {
        const unknown = unknowns.get(name);
        if (unknown === undefined) {
            throw new Error(`The specification has no match for the pinned label ${name}.`);
        }
        return unknown;
    });
    const pinnedNames = new Set(pinned);

    // The auxiliary labels are fresh in the whole specification, not only at
    // its top level: an existential condition's own matches and a projected
    // collection's are in scope around the matches built here, and a name they
    // already declare would shadow rather than join.
    const taken = declaredLabels(specification);
    let index = 0;
    const fresh = (kind: string): string => {
        let name: string;
        do {
            name = `${reservedLabelPrefix}${kind}${index++}`;
        } while (taken.has(name));
        taken.add(name);
        return name;
    };

    const matches: Match[] = [];
    for (const match of specification.matches) {
        if (!pinnedNames.has(match.unknown.name)) {
            // Left as a search, in place, so the matches around it still name
            // it and the labels it names are still bound before it.
            matches.push(match);
            continue;
        }
        for (const condition of match.conditions) {
            if (isPathCondition(condition)) {
                matches.push({
                    unknown: { name: fresh("p"), type: joinType(match.unknown, condition) },
                    conditions: [
                        { type: "path", rolesLeft: [], labelRight: match.unknown.name, rolesRight: condition.rolesLeft },
                        { type: "path", rolesLeft: [], labelRight: condition.labelRight, rolesRight: condition.rolesRight }
                    ]
                });
            }
        }
        const existentialConditions = match.conditions.filter(isExistentialCondition);
        if (existentialConditions.length > 0) {
            matches.push({
                unknown: { name: fresh("e"), type: match.unknown.type },
                conditions: [
                    { type: "path", rolesLeft: [], labelRight: match.unknown.name, rolesRight: [] },
                    ...existentialConditions
                ]
            });
        }
    }

    const pinnedGivens: SpecificationGiven[] = pinnedLabels.map(label => ({ label, conditions: [] }));
    return {
        specification: {
            given: [...specification.given, ...pinnedGivens],
            matches,
            projection: specification.projection
        },
        pinned: pinnedLabels
    };
}

/** The fact a path condition joins on, from the pinned side. */
function joinType(unknown: Label, condition: PathCondition): string {
    return condition.rolesLeft.length === 0
        ? unknown.type
        : condition.rolesLeft[condition.rolesLeft.length - 1].predecessorType;
}

/** Every label the specification declares, at any depth. */
function declaredLabels(specification: Specification): Set<string> {
    const labels = new Set<string>();
    for (const given of specification.given) {
        labels.add(given.label.name);
        for (const condition of given.conditions) {
            collectMatchLabels(condition.matches, labels);
        }
    }
    collectMatchLabels(specification.matches, labels);
    collectProjectionLabels(specification.projection, labels);
    return labels;
}

function collectMatchLabels(matches: Match[], labels: Set<string>): void {
    for (const match of matches) {
        labels.add(match.unknown.name);
        for (const condition of match.conditions) {
            if (!isPathCondition(condition)) {
                collectMatchLabels(condition.matches, labels);
            }
        }
    }
}

function collectProjectionLabels(projection: Projection, labels: Set<string>): void {
    if (projection.type === "composite") {
        for (const component of projection.components) {
            if (component.type === "specification") {
                collectMatchLabels(component.matches, labels);
                collectProjectionLabels(component.projection, labels);
            }
        }
    }
}
