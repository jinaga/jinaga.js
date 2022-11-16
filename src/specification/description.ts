import { ChildProjections, Condition, Label, Match, Projection, Specification, SpecificationProjection } from "../../src/specification/specification";

export function describeSpecification(specification: Specification, depth: number) {
    const indent = "    ".repeat(depth);
    const given = specification.given.map(given => describeGiven(given)).join(", ");
    const matches = specification.matches.map(match => describeMatch(match, depth + 1)).join("");
    const projection = (Array.isArray(specification.childProjections) && specification.childProjections.length === 0) ? "" :
        " => " + describeProjections(specification.childProjections, depth);

    return `${indent}(${given}) {\n${matches}${indent}}${projection}\n`;
}

function describeGiven(given: Label) {
    return `${given.name}: ${given.type}`;
}

function describeMatch(match: Match, depth: number) {
    const indent = "    ".repeat(depth);
    const conditions = match.conditions.map(condition => describeCondition(condition, match.unknown.name, depth + 1)).join("");

    return `${indent}${match.unknown.name}: ${match.unknown.type} [\n${conditions}${indent}]\n`;
}

function describeCondition(condition: Condition, unknown: string, depth: number): string {
    const indent = "    ".repeat(depth);
    if (condition.type === "path") {
        const rolesLeft = condition.rolesLeft.map(r => `->${r.name}: ${r.targetType}`).join("");
        const rolesRight = condition.rolesRight.map(r => `->${r.name}: ${r.targetType}`).join("");
        return `${indent}${unknown}${rolesLeft} = ${condition.labelRight}${rolesRight}\n`;
    }
    else if (condition.type === "existential") {
        const matches = condition.matches.map(match => describeMatch(match, depth + 1)).join("");
        const op = condition.exists ? "" : "!";
        return `${indent}${op}E {\n${matches}${indent}}\n`;
    }
    else {
        throw new Error("Not implemented");
    }
}

function describeProjections(projections: ChildProjections, depth: number): string {
    if (Array.isArray(projections)) {
        const indent = "    ".repeat(depth);
        const orderedProjections = projections.sort((a, b) => a.name.localeCompare(b.name));
        const projectionDescriptions = orderedProjections.map(projection => `    ${indent}${projection.name} = ${describeProjection(projection, depth + 1)}\n`).join("");
        return `{\n${projectionDescriptions}${indent}}`;
    }
    else if (projections.type === "field") {
        return `${projections.label}.${projections.field}`;
    }
    else if (projections.type === "fact") {
        return projections.label;
    }
    else {
        const _exhaustiveCheck: never = projections;
        throw new Error(`Unknown projection type: ${(projections as any).type}`);
    }
}

function describeProjection(projection: Projection, depth: number): string {
    if (projection.type === "specification") {
        return describeChildSpecification(projection, depth);
    }
    else if (projection.type === "field") {
        return `${projection.label}.${projection.field}`;
    }
    else if (projection.type === "fact") {
        return projection.label;
    }
    else if (projection.type === "hash") {
        return `#${projection.label}`;
    }
    else {
        const _exhaustiveCheck: never = projection;
        throw new Error(`Unknown projection type: ${(projection as any).type}`);
    }
}

function describeChildSpecification(specification: SpecificationProjection, depth: number) {
    const indent = "    ".repeat(depth);
    const matches = specification.matches.map(match => describeMatch(match, depth + 1)).join("");
    const projection = (Array.isArray(specification.childProjections) && specification.childProjections.length === 0) ? "" :
        " => " + describeProjections(specification.childProjections, depth);

    return `{\n${matches}${indent}}${projection}`;
}
