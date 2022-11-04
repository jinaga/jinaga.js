import { ChildProjections, Condition, Label, Match, Specification } from "../../src/specification/specification";

export function describeSpecification(specification: Specification, depth: number) {
    const indent = "    ".repeat(depth);
    const given = specification.given.map(given => describeGiven(given)).join(", ");
    const matches = specification.matches.map(match => describeMatch(match, depth + 1)).join("");
    const projection = (Array.isArray(specification.childProjections) && specification.childProjections.length === 0) ? "" :
        " => " + describeProjections(specification.childProjections, depth + 1);

    return `${indent}(${given}) {\n${matches}${indent}}${projection}\n`;
}

function describeGiven(given: Label) {
    return `${given.name}: ${given.type}`;
}

function describeMatch(match: Match, depth: number) {
    const indent = "    ".repeat(depth);
    const conditions = match.conditions.map(condition => describeCondition(condition, match.unknown.name, depth + 1)).join(", ");

    return `${indent}${match.unknown.name}: ${match.unknown.type} [\n${conditions}${indent}]\n`;
}

function describeCondition(condition: Condition, unknown: string, depth: number): string {
    const indent = "    ".repeat(depth);
    if (condition.type === "path") {
        const rolesLeft = condition.rolesLeft.map(r => `->${r.name}: ${r.targetType}`).join("");
        const rolesRight = condition.rolesRight.map(r => `->${r.name}: ${r.targetType}`).join("");
        return `${indent}${unknown}${rolesLeft} = ${condition.labelRight}${rolesRight}\n`;
    }
    else {
        throw new Error("Not implemented");
    }
}

function describeProjections(projections: ChildProjections, depth: number): string {
    if (Array.isArray(projections)) {
        throw new Error("Not implemented");
    }
    else {
        return `${projections.label}.${projections.field}`;
    }
}

