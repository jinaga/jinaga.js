import { Condition, ExistentialCondition, Match, Specification } from "../specification/specification";

export function validatePurgeSpecification(specification: Specification): string[] {
    // Validate that the specification has only one given.
    if (specification.given.length !== 1) {
        return ["A purge specification must have exactly one given."];
    }
    var purgeRoot = specification.given[0];

    // Search for negative existential conditions.
    // Those indicate that the specification will reverse a purge.
    var failures: string[] = specification.matches.map(match => match.conditions
        .filter(isNegativeExistentialCondition)
        .map(condition =>
            `A specified purge condition would reverse the purge of ${purgeRoot.type} with ${describeTuple(condition.matches)}.`
        )
    ).flat();
    return failures;
}

function isNegativeExistentialCondition(condition: Condition): condition is ExistentialCondition {
    return condition.type === "existential" && !condition.exists;
}

function describeTuple(matches: Match[]): string {
    return matches.map(match => match.unknown.type).join(", ");
}