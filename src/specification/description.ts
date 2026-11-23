import { ComponentProjection, Condition, ExistentialCondition, SpecificationGiven, Label, Match, NamedComponentProjection, Projection, Specification, SpecificationProjection } from "../../src/specification/specification";
import { FactReference } from "../storage";

export function describeDeclaration(references: FactReference[], labels: Label[]) {
    const declaration = references.map((reference, index) => {
        const label = labels[index];
        return `let ${label.name}: ${label.type} = #${reference.hash}\n`;
    }).join("");
    return declaration;
}

export function describeSpecification(specification: Specification, depth: number) {
    const indent = "    ".repeat(depth);
    const given = specification.given.map(given => describeGiven(given, depth)).join(", ");
    const matches = specification.matches.map(match => describeMatch(match, depth + 1)).join("");
    const projection = (specification.projection.type === "composite" && specification.projection.components.length === 0) ? "" :
        " => " + describeProjection(specification.projection, depth);

    return `${indent}(${given}) {\n${matches}${indent}}${projection}\n`;
}

function describeGiven(given: SpecificationGiven, depth: number) {
    if (given.conditions.length === 0) {
        return `${given.label.name}: ${given.label.type}`;
    }
    
    const indent = "    ".repeat(depth);
    const conditions = given.conditions.map(condition => describeExistentialCondition(condition, depth + 1)).join("");
    
    return `${given.label.name}: ${given.label.type} [\n${conditions}${indent}]`;
}

function describeExistentialCondition(condition: ExistentialCondition, depth: number): string {
    const indent = "    ".repeat(depth);
    const matches = condition.matches.map(match => describeMatch(match, depth + 1)).join("");
    const op = condition.exists ? "" : "!";
    return `${indent}${op}E {\n${matches}${indent}}\n`;
}

function describeMatch(match: Match, depth: number) {
    const indent = "    ".repeat(depth);
    const conditions = match.conditions.map(condition => describeCondition(condition, match.unknown.name, depth + 1)).join("");

    return `${indent}${match.unknown.name}: ${match.unknown.type} [\n${conditions}${indent}]\n`;
}

function describeCondition(condition: Condition, unknown: string, depth: number): string {
    const indent = "    ".repeat(depth);
    if (condition.type === "path") {
        const rolesLeft = condition.rolesLeft.map(r => `->${r.name}: ${r.predecessorType}`).join("");
        const rolesRight = condition.rolesRight.map(r => `->${r.name}: ${r.predecessorType}`).join("");
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

/**
 * Order two component names by UTF-16 code unit, the comparison
 * `Array.prototype.sort` applies when it is given no comparator. Every replica
 * must print one specification as one text, so the order cannot depend on the
 * host's collation the way `localeCompare` does (#438). jinaga-spec's printer
 * sorts by `String ≤` and jinaga.net's by `StringComparer.Ordinal`, and a
 * component name matches `^[a-zA-Z_][a-zA-Z0-9_]*`, so code unit, code point
 * and byte order agree with both on every name the parser accepts.
 */
function compareComponentNames(a: NamedComponentProjection, b: NamedComponentProjection): number {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function describeProjection(projection: Projection, depth: number): string {
    if (projection.type === "composite") {
        const indent = "    ".repeat(depth);
        // Sort a copy: `Array.prototype.sort` is in place, and a printer must not
        // reorder the specification it was handed (#313).
        const orderedProjections = [...projection.components].sort(compareComponentNames);
        const projectionDescriptions = orderedProjections.map(projection => `    ${indent}${projection.name} = ${describeComponentProjection(projection, depth + 1)}\n`).join("");
        return `{\n${projectionDescriptions}${indent}}`;
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
    else if (projection.type === "time") {
        return `@${projection.label}`;
    }
    else {
        const _exhaustiveCheck: never = projection;
        throw new Error(`Unknown projection type: ${(_exhaustiveCheck as any).type}`);
    }
}

function describeComponentProjection(projection: ComponentProjection, depth: number): string {
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
    else if (projection.type === "time") {
        return `@${projection.label}`;
    }
    else {
        const _exhaustiveCheck: never = projection;
        throw new Error(`Unknown projection type: ${(_exhaustiveCheck as any).type}`);
    }
}

function describeChildSpecification(specification: SpecificationProjection, depth: number) {
    const indent = "    ".repeat(depth);
    const matches = specification.matches.map(match => describeMatch(match, depth + 1)).join("");
    const projection = (specification.projection.type === "composite" && specification.projection.components.length === 0) ? "" :
        " => " + describeProjection(specification.projection, depth);

    return `{\n${matches}${indent}}${projection}`;
}
