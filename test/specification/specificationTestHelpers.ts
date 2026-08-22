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
    for (const match of specification.matches) {
        bound.add(match.unknown.name);
        for (const condition of match.conditions) {
            expectLabelsBound(condition, bound, match.unknown.name);
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
        expectMatchesBound(condition.matches, bound, owner);
    }
}

function expectMatchesBound(matches: Match[], bound: Set<string>, owner: string) {
    const inner = new Set<string>(bound);
    for (const match of matches) {
        inner.add(match.unknown.name);
        for (const condition of match.conditions) {
            expectLabelsBound(condition, inner, owner);
        }
    }
}
