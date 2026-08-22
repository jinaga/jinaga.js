import { Condition, Match, Specification } from "@src";

/**
 * Every label that a condition references must be bound by the given or by an
 * earlier match. SpecificationRunner throws "The label X is not defined" otherwise.
 */
export function expectWellOrdered(specification: Specification) {
    const bound = new Set<string>(specification.given.map(g => g.label.name));
    for (const given of specification.given) {
        for (const condition of given.conditions) {
            expectLabelsBound(condition, bound, given.label.name);
        }
    }
    expectMatchesBound(specification.matches, bound);
}

/**
 * A path condition is resolved before its match's own label is bound (SpecificationRunner
 * evaluates every path condition against the tuple as it stood before this match ran), so
 * it must not reference the match's own label. An existential condition runs after, against
 * the tuple with this match's label already bound, so its nested matches may reference it.
 */
function expectMatchesBound(matches: Match[], bound: Set<string>) {
    for (const match of matches) {
        for (const condition of match.conditions) {
            if (condition.type === "path") {
                expectLabelsBound(condition, bound, match.unknown.name);
            }
        }
        bound.add(match.unknown.name);
        for (const condition of match.conditions) {
            if (condition.type !== "path") {
                expectLabelsBound(condition, bound, match.unknown.name);
            }
        }
    }
}

function expectLabelsBound(condition: Condition, bound: Set<string>, owner: string) {
    if (condition.type === "path") {
        if (!bound.has(condition.labelRight)) {
            throw new Error(`Condition on ${owner} references unbound label ${condition.labelRight}. ` +
                `Bound: [${Array.from(bound).join(", ")}]`);
        }
    }
    else {
        expectMatchesBound(condition.matches, new Set<string>(bound));
    }
}
