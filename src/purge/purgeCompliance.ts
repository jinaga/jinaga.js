import { describeSpecification } from "../specification/description";
import { Condition, Match, Role, Specification } from "../specification/specification";

export function isSpecificationCompliant(specification: Specification, purgeConditions: Specification[]) {
    return specification.matches.every(m => isMatchCompliant(m, purgeConditions));
}

export function testSpecificationForCompliance(specification: Specification, purgeConditions: Specification[]): string[] {
    return specification.matches.map(m => testMatchForCompliance(m, purgeConditions)).flat();
}

function isMatchCompliant(match: Match, purgeConditions: Specification[]) {
    var failedUnknown = purgeConditions.some(pc =>
        pc.given[0].type === match.unknown.type &&
        !hasCondition(match.conditions, pc)
    );
    if (failedUnknown) {
        return false;
    }

    var failedIntermediate = purgeConditions.some(pc =>
        match.conditions.some(c => hasIntermediateType(c, pc.given[0].type))
    )
    if (failedIntermediate) {
        return false;
    }

    // TODO: We need to check the existential conditions.
    return true;
}

function testMatchForCompliance(match: Match, purgeConditions: Specification[]): string[] {
    var failedUnknownConditions = purgeConditions.filter(pc =>
        pc.given[0].type === match.unknown.type &&
        !hasCondition(match.conditions, pc)
    );
    if (failedUnknownConditions.length > 0) {
        const specificationDescriptions = failedUnknownConditions.map(pc => describePurgeCondition(pc)).join("");
        return [`The match for ${match.unknown.type} is missing purge conditions:\n${specificationDescriptions}`];
    }

    var failedIntermediateConditions = purgeConditions.filter(pc =>
        match.conditions.some(c => hasIntermediateType(c, pc.given[0].type))
    )
    if (failedIntermediateConditions.length > 0) {
        const specificationDescriptions = failedIntermediateConditions.map(pc => describePurgeCondition(pc)).join("");
        return [`The match for ${match.unknown.type} passes through types that should have purge conditions:\n${specificationDescriptions}`];
    }

    return [];
}

function hasCondition(conditions: Condition[], purgeCondition: Specification) {
    return conditions.some(c => conditionMatches(c, purgeCondition));
}

function conditionMatches(condition: Condition, purgeCondition: Specification) {
    if (condition.type === "existential") {
        if (condition.exists) {
            // We only match negative existential conditions.
            return false;
        }
        // Compare the matches of the condition with the matches of the purge condition.
        if (condition.matches.length !== purgeCondition.matches.length) {
            return false;
        }
        return condition.matches.every((m, i) => matchesAreEquivalent(m, purgeCondition.matches[i]));
    }
}

function matchesAreEquivalent(match: Match, purgeMatch: Match): unknown {
    if (match.unknown.type !== purgeMatch.unknown.type) {
        return false;
    }
    if (match.conditions.length !== purgeMatch.conditions.length) {
        return false;
    }
    return match.conditions.every((c, i) => conditionsAreEquivalent(c, purgeMatch.conditions[i]));
}

function conditionsAreEquivalent(condition: Condition, purgeCondition: Condition) {
    if (condition.type === "path") {
        if (purgeCondition.type !== "path") {
            return false;
        }
        if (condition.rolesLeft.length !== purgeCondition.rolesLeft.length) {
            return false;
        }
        if (condition.rolesRight.length !== purgeCondition.rolesRight.length) {
            return false;
        }
        return condition.rolesLeft.every((r, i) => rolesAreEquivalent(r, purgeCondition.rolesLeft[i]))
            && condition.rolesRight.every((r, i) => rolesAreEquivalent(r, purgeCondition.rolesRight[i]));
    }
    else if (condition.type === "existential") {
        if (purgeCondition.type !== "existential") {
            return false;
        }
        if (condition.exists !== purgeCondition.exists) {
            return false;
        }
        if (condition.matches.length !== purgeCondition.matches.length) {
            return false;
        }
        return condition.matches.every((m, i) => matchesAreEquivalent(m, purgeCondition.matches[i]));
    }
}

function rolesAreEquivalent(role: Role, purgeRole: Role) {
    return role.predecessorType === purgeRole.predecessorType &&
        role.name === purgeRole.name;
}

function hasIntermediateType(condition: Condition, type: string) {
    if (condition.type === "path") {
        var leftOnly = condition.rolesRight.length === 0;
        var rightOnly = condition.rolesLeft.length === 0;

        // If we only have left roles, then ignore the last role on the right.
        // If any of the roles is the type we're looking for, then we have an intermediate type.
        if (leftOnly) {
            var found = condition.rolesLeft.some((r, i) =>
                r.predecessorType === type &&
                i < condition.rolesLeft.length - 1);
            if (found) {
                return true;
            }
        }
        else {
            var found = condition.rolesLeft.some(r => r.predecessorType === type);
            if (found) {
                return true;
            }
        }

        // If we only have right roles, then ignore the last role on the left.
        // If any of the roles is the type we're looking for, then we have an intermediate type.
        if (rightOnly) {
            var found = condition.rolesRight.some((r, i) =>
                r.predecessorType === type &&
                i < condition.rolesRight.length - 1);
            if (found) {
                return true;
            }
        }
        else {
            var found = condition.rolesRight.some(r => r.predecessorType === type);
            if (found) {
                return true;
            }
        }
    }
    return false;
}

function describePurgeCondition(specification: Specification): string {
    var specificationWithoutProjection: Specification = {
        ...specification,
        projection: {
            type: "composite",
            components: []
        }
    };
    var description = describeSpecification(specificationWithoutProjection, 0);
    return `!E ${description}`;
}

