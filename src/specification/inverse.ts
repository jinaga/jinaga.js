import { Condition, ExistentialCondition, isExistentialCondition, Label, Match, PathCondition, Projection, Specification } from "./specification";
import { detectDisconnectedSpecification } from "./UnionFind";
import { Trace } from "../util/trace";
import { describeSpecification } from "./description";
import { computeStringHash } from "../util/encoding";

type InverseOperation = "add" | "remove";

export interface SpecificationInverse {
    inverseSpecification: Specification;
    operation: InverseOperation;
    givenSubset: string[];
    parentSubset: string[];
    path: string;
    resultSubset: string[];
};

interface InverterContext {
    givenSubset: string[];
    parentSubset: string[];
    path: string;
    resultSubset: string[];
    projection: Projection;
}

/**
 * How many distinct specifications the inversion cache retains by default.
 *
 * Inversion is a pure function of the specification, but every caller
 * recomputed it: a production session logged 32,528 inversions for roughly 33
 * distinct specifications, because the server inverts once per streaming
 * subscription (issue #266). Server workloads see a small, stable set of
 * specifications, which is the shape that caches well.
 *
 * The bound is what makes that safe for the other shape. A caller that
 * generates specifications dynamically would otherwise grow the cache without
 * limit, so entries are evicted least-recently-used once the capacity is
 * reached.
 */
export const DEFAULT_INVERSE_CACHE_CAPACITY = 500;

export interface InverseCacheStatistics {
    /** Distinct specifications currently retained. */
    size: number;
    /** The configured bound. Zero means caching is disabled. */
    capacity: number;
    /** Calls served from the cache since the last `clearInverseCache`. */
    hits: number;
    /** Calls that had to compute an inversion since the last `clearInverseCache`. */
    misses: number;
}

/**
 * Insertion-ordered, so the first key is the least recently used. A hit
 * re-inserts its key to move it to the end.
 */
const inverseCache = new Map<string, SpecificationInverse[]>();
let inverseCacheCapacity = DEFAULT_INVERSE_CACHE_CAPACITY;
let inverseCacheHits = 0;
let inverseCacheMisses = 0;

/**
 * Bound how many distinct specifications are retained. Pass 0 to disable
 * caching entirely, which restores the previous compute-every-time behavior.
 * Lowering the capacity evicts the least recently used entries immediately.
 */
export function setInverseCacheCapacity(capacity: number): void {
    if (!Number.isInteger(capacity) || capacity < 0) {
        throw new Error(`Inverse cache capacity must be a non-negative integer, but received ${capacity}.`);
    }
    inverseCacheCapacity = capacity;
    trimInverseCache();
}

/**
 * Drop every retained inversion and reset the hit and miss counters. Inversion
 * is pure, so this is never required for correctness; it exists for tests and
 * for a host that wants to reclaim the memory.
 */
export function clearInverseCache(): void {
    inverseCache.clear();
    inverseCacheHits = 0;
    inverseCacheMisses = 0;
}

/**
 * Report cache occupancy and the hit and miss counts. Issue #266 could measure
 * the redundancy but not the compute it costs; this is how a host quantifies
 * what the cache actually saves in its own workload.
 */
export function inverseCacheStatistics(): InverseCacheStatistics {
    return {
        size: inverseCache.size,
        capacity: inverseCacheCapacity,
        hits: inverseCacheHits,
        misses: inverseCacheMisses
    };
}

function trimInverseCache(): void {
    while (inverseCache.size > inverseCacheCapacity) {
        const oldest = inverseCache.keys().next();
        if (oldest.done) {
            return;
        }
        inverseCache.delete(oldest.value);
    }
}

/**
 * Invert a specification, memoized on its STRUCTURE rather than its identity.
 *
 * Two distinct `Specification` objects that describe the same thing share one
 * cache entry, and that is the point rather than a side effect: the server
 * inverts once per subscription, and the specifications arriving are separate
 * object graphs of a handful of shapes. Object-identity memoization would miss
 * every one of those.
 *
 * The key is the hash of the specification's description, which is already
 * this codebase's identity for a specification: `deduplicateInverses` below
 * dedupes on it, and `ObservableSource.addSpecificationListener` groups
 * listeners by it. Computing the key is also strictly cheaper than the
 * deduplication step alone, which describes every inverse it produced.
 *
 * A thrown inversion is not cached. `detectDisconnectedSpecification` and the
 * infinite-loop guard in `shakeTree` reject a specification outright, so a
 * caller that retries gets the same rejection rather than a stale success, and
 * no failure occupies a cache slot.
 *
 * The returned array is a copy. The inverses inside it are shared, and callers
 * have always treated them as read-only, but handing out the stored array
 * would let one caller's in-place sort reorder what every later caller sees.
 */
export function invertSpecification(specification: Specification): SpecificationInverse[] {
    if (inverseCacheCapacity === 0) {
        return computeInverses(specification);
    }

    const key = computeStringHash(describeSpecification(specification, 0));
    const cached = inverseCache.get(key);
    if (cached !== undefined) {
        // Re-insert to mark the entry most recently used.
        inverseCache.delete(key);
        inverseCache.set(key, cached);
        inverseCacheHits++;
        Trace.counter("invert_specification_cache_hit", 1);
        return [...cached];
    }

    // Count the miss only once the inversion has actually succeeded. A
    // rejected specification caches nothing, so counting it here would inflate
    // the miss total against a cache that was never given anything to hold,
    // and understate the hit rate for a host repeatedly inverting a bad spec.
    const inverses = computeInverses(specification);
    inverseCacheMisses++;
    Trace.counter("invert_specification_cache_miss", 1);
    inverseCache.set(key, inverses);
    trimInverseCache();
    return [...inverses];
}

function computeInverses(specification: Specification): SpecificationInverse[] {
    const givenTypes = specification.given.map(g => g.label.type).join(', ');
    const givenNames = specification.given.map(g => g.label.name).join(', ');
    const matchCount = specification.matches.length;
    
    Trace.info(`[InvertSpec] START - Given types: [${givenTypes}], Given names: [${givenNames}], Matches: ${matchCount}`);
    
    // Detect disconnected specifications before inversion
    detectDisconnectedSpecification(specification);
    
    // Turn each given into a match.
    const emptyMatches: Match[] = specification.given.map(g => ({
        unknown: g.label,
        conditions: g.conditions
    }));
    const matches: Match[] = [...emptyMatches, ...specification.matches];

    const labels: Label[] = [...specification.given.map(g => g.label), ...specification.matches.map(m => m.unknown)];
    const givenSubset: string[] = specification.given.map(g => g.label.name);
    const matchLabels: Label[] = specification.matches.map(m => m.unknown);
    const resultSubset: string[] = [ ...givenSubset, ...matchLabels.map(l => l.name) ];
    const context: InverterContext = {
        path: "",
        givenSubset,
        parentSubset: givenSubset,
        resultSubset,
        projection: specification.projection
    };
    
    Trace.info(`[InvertSpec] Inverting matches - Labels: ${labels.length}, Context path: "${context.path}"`);
    const inverses: SpecificationInverse[] = invertMatches(matches, labels, context);
    Trace.info(`[InvertSpec] Match inverses generated: ${inverses.length}`);
    
    Trace.info(`[InvertSpec] Inverting projection - Projection type: ${specification.projection.type}`);
    const projectionInverses: SpecificationInverse[] = invertProjection(matches, context);
    Trace.info(`[InvertSpec] Projection inverses generated: ${projectionInverses.length}`);
    
    // Check if self-inverse is needed and create it
    const selfInverse = createSelfInverse(specification, context);
    const selfInverseCount = selfInverse ? 1 : 0;
    if (selfInverse) {
        Trace.info(`[InvertSpec] Self-inverse created for given type: ${specification.given[0].label.type}`);
    }
    
    const totalInverses = inverses.length + projectionInverses.length + selfInverseCount;
    Trace.info(`[InvertSpec] COMPLETE - Total inverses: ${totalInverses} (${inverses.length} match + ${projectionInverses.length} projection + ${selfInverseCount} self-inverse)`);
    
    // Deduplicate inverses based on specification structure
    const allInverses = selfInverse 
        ? [...inverses, ...projectionInverses, selfInverse] 
        : [...inverses, ...projectionInverses];

    const deduplicatedInverses = deduplicateInverses(allInverses);

    Trace.info(`[InvertSpec] Deduplication - Before: ${allInverses.length}, After: ${deduplicatedInverses.length}`);

    return deduplicatedInverses;
}

/**
 * Removes duplicate inverse specifications based on their structure.
 * Two inverses are considered duplicates if they have:
 * - Identical inverse specification structure
 * - Same operation (add/remove)
 * - Same metadata (givenSubset, parentSubset, path, resultSubset)
 */
function deduplicateInverses(inverses: SpecificationInverse[]): SpecificationInverse[] {
    const seen = new Map<string, SpecificationInverse>();
    
    for (const inverse of inverses) {
        // Create a unique key from the inverse specification and metadata
        const specKey = computeStringHash(describeSpecification(inverse.inverseSpecification, 0));
        const metadataKey = JSON.stringify({
            operation: inverse.operation,
            givenSubset: inverse.givenSubset,
            parentSubset: inverse.parentSubset,
            path: inverse.path,
            resultSubset: inverse.resultSubset
        });
        const key = `${specKey}|${metadataKey}`;
        
        if (!seen.has(key)) {
            seen.set(key, inverse);
        } else {
            Trace.info(`[InvertSpec] Skipping duplicate inverse - Spec key: ${specKey.substring(0, 8)}..., Operation: ${inverse.operation}`);
        }
    }
    
    return Array.from(seen.values());
}

function invertMatches(matches: Match[], labels: Label[], context: InverterContext): SpecificationInverse[] {
    const inverses: SpecificationInverse[] = [];

    // Produce an inverse for each unknown in the original specification.
    for (const label of labels) {
        matches = shakeTree(matches, label.name);
        // The given will not have any successors.
        // Simplify the matches by removing any conditions that cannot be satisfied.
        const simplified: Match[] | null = simplifyMatches(matches, label.name);
        if (simplified !== null) {
            const ordered: Match[] = relocateConditions(simplified);
            const inverseSpecification: Specification = {
                given: [{label, conditions: ordered[0].conditions.filter(isExistentialCondition) as ExistentialCondition[]}],
                matches: ordered.slice(1),
                projection: context.projection
            };
            const inverse: SpecificationInverse = {
                inverseSpecification,
                operation: "add",
                givenSubset: context.givenSubset,
                parentSubset: context.parentSubset,
                path: context.path,
                resultSubset: context.resultSubset
            };
    
            inverses.push(inverse);
        }

        const existentialInverses: SpecificationInverse[] = invertExistentialConditions(matches, matches[0].conditions, "add", context);
        inverses.push(...existentialInverses);
    }

    return inverses;
}

function shakeTree(matches: Match[], label: string): Match[] {
    // Find the match for the given label.
    const match: Match = findMatch(matches, label);

    // Move the match to the beginning of the list.
    matches = [ match, ...matches.filter(m => m !== match) ];

    // Invert all path conditions in the match and move them to the tagged match.
    for (const condition of match.conditions) {
        if (condition.type === "path") {
            matches = invertAndMovePathCondition(matches, label, condition);
        }
    }

    // Move any other matches with no paths down.
    for (let i = 1; i < matches.length; i++) {
        let otherMatch: Match = matches[i];
        const firstLabel = otherMatch.unknown.name;
        while (!otherMatch.conditions.some(c => c.type === "path")) {
            // Find all matches beyond this point that tag this one.
            for (let j = i + 1; j < matches.length; j++) {
                const taggedMatch: Match = matches[j];
                // Move their path conditions to the other match.
                for (const taggedCondition of taggedMatch.conditions) {
                    if (taggedCondition.type === "path" &&
                        taggedCondition.labelRight === otherMatch.unknown.name) {
                        matches = invertAndMovePathCondition(matches, taggedMatch.unknown.name, taggedCondition);
                    }
                }
            }

            // Move the other match to the bottom of the list.
            matches = [ ...matches.slice(0, i), ...matches.slice(i + 1), matches[i] ];
            otherMatch = matches[i];

            // If we have returned to the first match, we have found an infinite loop.
            if (otherMatch.unknown.name === firstLabel) {
                const remainingLabelTypes = matches.slice(i).map(m => m.unknown.type).join(", ");
                throw new Error(`The labels with types [${remainingLabelTypes}] are not connected to the rest of the graph`);
            }
        }
    }

    return matches;
}

function invertAndMovePathCondition(matches: Match[], label: string, pathCondition: PathCondition): Match[] {
    // Find the match for the given label.
    const match: Match = findMatch(matches, label);

    // Find the match for the target label.
    const targetMatch: Match = findMatch(matches, pathCondition.labelRight);

    // Invert the path condition.
    const invertedPathCondition: PathCondition = {
        type: "path",
        labelRight: match.unknown.name,
        rolesRight: pathCondition.rolesLeft,
        rolesLeft: pathCondition.rolesRight
    };

    // Remove the path condition from the match.
    const newMatch: Match = {
        unknown: match.unknown,
        conditions: match.conditions.filter(c => c !== pathCondition)
    };
    const matchIndex = matches.indexOf(match);
    matches = [ ...matches.slice(0, matchIndex), newMatch, ...matches.slice(matchIndex + 1) ];

    // Add the inverted path condition to the target match.
    const newTargetMatch: Match = {
        unknown: targetMatch.unknown,
        conditions: [ invertedPathCondition, ...targetMatch.conditions ]
    };
    const targetMatchIndex = matches.indexOf(targetMatch);
    matches = [ ...matches.slice(0, targetMatchIndex), newTargetMatch, ...matches.slice(targetMatchIndex + 1) ];

    return matches;
}

/**
 * Move each existential condition to the match at which every label it references
 * is bound.
 *
 * `shakeTree` reorders the matches so that the tagged label comes first, which can
 * leave an existential condition on a match that precedes a label the condition
 * path-references. An existential condition is a filter on the tuple, not a binder
 * of outer labels, so moving it later in the conjunction preserves the result set
 * while restoring the invariant that `SpecificationRunner` relies on: every label a
 * condition names is already bound by the time the condition runs.
 *
 * Conditions are appended, never prepended, so the "first condition must be a path
 * condition" invariant holds. Conditions whose labels are already bound do not move,
 * which leaves authored given conditions exactly where they were.
 *
 * This must run only when the inverse specification is built, not inside
 * `shakeTree`: `invertMatches` still reads `matches[0].conditions` to drive the
 * recursive `invertExistentialConditions` call, and relocating conditions there
 * would drop inverses.
 */
function relocateConditions(matches: Match[]): Match[] {
    const bindingIndex = new Map<string, number>();
    matches.forEach((match, index) => bindingIndex.set(match.unknown.name, index));

    const conditionsByIndex: Condition[][] = matches.map(match => [ ...match.conditions ]);
    let moved = false;

    for (let index = 0; index < conditionsByIndex.length; index++) {
        const remaining: Condition[] = [];
        for (const condition of conditionsByIndex[index]) {
            const target = condition.type === "existential" ?
                latestBindingIndex(condition, bindingIndex) :
                index;
            if (target > index) {
                conditionsByIndex[target].push(condition);
                moved = true;
            }
            else {
                remaining.push(condition);
            }
        }
        conditionsByIndex[index] = remaining;
    }

    if (!moved) {
        return matches;
    }

    return matches.map((match, index) => ({
        unknown: match.unknown,
        conditions: conditionsByIndex[index]
    }));
}

/**
 * The index of the last match that binds a label referenced by this condition, or
 * -1 if the condition references no label bound by the match list.
 */
function latestBindingIndex(condition: ExistentialCondition, bindingIndex: Map<string, number>): number {
    let latest = -1;
    for (const label of freeLabels(condition.matches, new Set<string>())) {
        const index = bindingIndex.get(label);
        if (index !== undefined && index > latest) {
            latest = index;
        }
    }
    return latest;
}

/**
 * The labels that these matches reference but do not themselves bind.
 */
function freeLabels(matches: Match[], bound: Set<string>): string[] {
    const innerBound = new Set<string>(bound);
    for (const match of matches) {
        innerBound.add(match.unknown.name);
    }

    const labels: string[] = [];
    for (const match of matches) {
        for (const condition of match.conditions) {
            if (condition.type === "path") {
                if (!innerBound.has(condition.labelRight)) {
                    labels.push(condition.labelRight);
                }
            }
            else {
                labels.push(...freeLabels(condition.matches, innerBound));
            }
        }
    }
    return labels;
}

function findMatch(matches: Match[], label: string): Match {
    for (const match of matches) {
        if (match.unknown.name === label) {
            return match;
        }
    }

    throw new Error(`Label ${label} not found`);
}

function invertExistentialConditions(outerMatches: Match[], conditions: Condition[], parentOperation: InverseOperation, context: InverterContext): SpecificationInverse[] {
    const inverses: SpecificationInverse[] = [];

    // Produce inverses for each existential condition in the match.
    for (const condition of conditions) {
        if (condition.type === "existential") {
            let matches = [ ...outerMatches, ...condition.matches ];
            for (const match of condition.matches) {
                matches = shakeTree(matches, match.unknown.name);
                const matchesWithoutCondition: Match[] = removeCondition(matches, condition);
                const simplifiedMatches: Match[] | null = simplifyMatches(matchesWithoutCondition, match.unknown.name);
                if (simplifiedMatches === null) {
                    // The matches in the existential condition are unsatisfiable.
                    continue;
                }
                const ordered: Match[] = relocateConditions(simplifiedMatches);
                const inverseSpecification: Specification = {
                    given: [{ label: match.unknown, conditions: ordered[0].conditions.filter(isExistentialCondition) as ExistentialCondition[] }],
                    matches: ordered.slice(1),
                    projection: context.projection
                };
                const operation = inferOperation(parentOperation, condition.exists);
                const inverse: SpecificationInverse = {
                    inverseSpecification,
                    operation,
                    givenSubset: context.givenSubset,
                    parentSubset: context.parentSubset,
                    path: context.path,
                    resultSubset: context.resultSubset
                };

                inverses.push(inverse);

                const existentialInverses: SpecificationInverse[] = invertExistentialConditions(matches, match.conditions, operation, context);
                inverses.push(...existentialInverses);
            }
        }
    }

    return inverses;
}

function removeCondition(matches: Match[], condition: ExistentialCondition): Match[] {
    return matches.map(match =>
        match.conditions.includes(condition) ?
            {
                unknown: match.unknown,
                conditions: match.conditions.filter(c => c !== condition)
            } :
            match
    );
}

function inferOperation(parentOperation: InverseOperation, exists: boolean): InverseOperation {
    if (parentOperation === "add") {
        return exists ? "add" : "remove";
    }
    else if (parentOperation === "remove") {
        return exists ? "remove" : "add";
    }
    else {
        const _exhaustiveCheck: never = parentOperation;
        throw new Error(`Cannot infer operation from ${_exhaustiveCheck}, ${exists ? "exists" : "not exists"}`);
    }
}

function invertProjection(matches: Match[], context: InverterContext): SpecificationInverse[] {
    const inverses: SpecificationInverse[] = [];

    // Produce inverses for all collections in the projection.
    if (context.projection.type === "composite") {
        const specComponents = context.projection.components.filter(c => c.type === "specification");
        Trace.info(`[InvertProjection] Processing composite projection - Path: "${context.path}", Spec components: ${specComponents.length}/${context.projection.components.length}`);
        
        for (const component of context.projection.components) {
            if (component.type === "specification") {
                const componentMatches = [ ...matches, ...component.matches ];
                const componentLabels = component.matches.map(m => m.unknown);
                const childPath = context.path + "." + component.name;
                
                Trace.info(`[InvertProjection] NESTED SPEC - Component: ${component.name}, Path: "${childPath}", Component matches: ${component.matches.length}, Component labels: ${componentLabels.length}`);
                
                const childContext: InverterContext = {
                    ...context,
                    path: childPath,
                    parentSubset: context.resultSubset,
                    resultSubset: [ ...context.resultSubset, ...componentLabels.map(l => l.name) ],
                    projection: component.projection
                };
                
                Trace.info(`[InvertProjection] Child context - Path: "${childPath}", Parent subset: [${childContext.parentSubset.join(', ')}], Result subset: [${childContext.resultSubset.join(', ')}]`);
                
                const matchInverses = invertMatches(componentMatches, componentLabels, childContext);
                Trace.info(`[InvertProjection] Generated ${matchInverses.length} match inverses for nested spec "${component.name}"`);
                
                const projectionInverses = invertProjection(componentMatches, childContext);
                Trace.info(`[InvertProjection] Generated ${projectionInverses.length} projection inverses for nested spec "${component.name}"`);
                
                inverses.push(...matchInverses, ...projectionInverses);
            }
        }
    } else {
        Trace.info(`[InvertProjection] Non-composite projection - Path: "${context.path}", Type: ${context.projection.type}`);
    }

    return inverses;
}

function simplifyMatches(matches: Match[], given: string): Match[] | null {
    const simplifiedMatches: Match[] = [];

    for (const match of matches) {
        const simplifiedMatch: Match | null = simplifyMatch(match, given);
        if (simplifiedMatch === null) {
            return null;
        }
        else {
            simplifiedMatches.push(simplifiedMatch);
        }
    }

    return simplifiedMatches;
}

function simplifyMatch(match: Match, given: string): Match | null {
    const simplifiedConditions: Condition[] = [];

    for (const condition of match.conditions) {
        if (expectsSuccessor(condition, given)) {
            // This path condition matches successors of the given.
            // There are no successors yet, so the condition is unsatisfiable.
            return null;
        }

        let simplifiedCondition: Condition = condition;
        if (condition.type === "existential") {
            // Simplify the matches in the existential condition.
            const simplifiedMatches: Match[] | null = simplifyMatches(condition.matches, given);
            if (simplifiedMatches === null) {
                if (condition.exists) {
                    // The matches in the existential condition are unsatisfiable.
                    return null;
                }
                else {
                    // The matches in the existential condition are unsatisfiable.
                    // The existential condition is always true, so we can skip it.
                    continue;
                }
            }
            const anyExpectsSuccessor = simplifiedMatches.some(m =>
                m.conditions.some(c => expectsSuccessor(c, given)));
            if (anyExpectsSuccessor) {
                if (condition.exists) {
                    // This existential condition expects successors of the given.
                    // There are no successors yet, so the condition is unsatisfiable.
                    return null;
                }
                else {
                    // This existential condition expects successors of the given.
                    // There are no successors yet, so the condition is always true.
                    continue;
                }
            }
            simplifiedCondition = {
                type: "existential",
                exists: condition.exists,
                matches: simplifiedMatches
            };
        }

        simplifiedConditions.push(simplifiedCondition);
    }

    const simplifiedMatch: Match = {
        unknown: match.unknown,
        conditions: simplifiedConditions
    };

    return simplifiedMatch;
}

function expectsSuccessor(condition: Condition, given: string) {
    return condition.type === "path" &&
        condition.labelRight === given &&
        condition.rolesRight.length === 0 &&
        condition.rolesLeft.length > 0;
}





/**
 * Creates a self-inverse for the specification if needed.
 * 
 * Self-inverse allows the specification to react when its own given fact arrives.
 * This is critical for scenarios where:
 * 1. A subscription is started with an unpersisted given fact
 * 2. The given fact is later persisted
 * 3. The system needs to re-read the specification with the now-available given
 * 
 * Safety constraints (to avoid infinite loops):
 * - ONLY for specifications with a single given fact
 * - No complex conditions on the given
 * - Uses the original specification as-is (no actual inversion)
 * 
 * @param specification The original specification
 * @param context The inverter context
 * @returns A self-inverse SpecificationInverse or null if not needed
 */
function createSelfInverse(specification: Specification, context: InverterContext): SpecificationInverse | null {
    // Safety check: Only support single given fact
    // Multiple givens are too complex and risk infinite loops
    if (specification.given.length !== 1) {
        Trace.info(`[SelfInverse] Skipping - Multiple givens (${specification.given.length})`);
        return null;
    }
    
    const given = specification.given[0];
    const givenType = given.label.type;
    const givenName = given.label.name;
    
    // Safety check: No complex conditions on given
    // Complex conditions could cause unexpected behavior
    if (given.conditions.length > 0) {
        Trace.info(`[SelfInverse] Skipping - Given has conditions (${given.conditions.length})`);
        return null;
    }
    
    // Create self-inverse: When the given fact type arrives, re-read the entire specification
    // The inverseSpecification is the ORIGINAL specification (not inverted)
    // This triggers a complete re-evaluation when the given becomes available
    const selfInverse: SpecificationInverse = {
        inverseSpecification: specification,
        operation: "add",
        givenSubset: context.givenSubset,
        parentSubset: context.parentSubset,
        path: context.path,
        resultSubset: context.resultSubset
    };
    
    Trace.info(`[SelfInverse] Created for given: ${givenType} (${givenName})`);
    return selfInverse;
}
