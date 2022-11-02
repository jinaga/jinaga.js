import { Label, Match, Specification } from "../../src/specification/specification";

export function describeSpecification(specification: Specification, depth: number) {
    const indent = "    ".repeat(depth);
    const given = specification.given.map(given => describeGiven(given)).join(", ");
    const matches = specification.matches.map(match => describeMatch(match, depth + 1)).join("");
    const projection = "";

    return `${indent}(${given}) {\n${matches}${indent}}${projection}\n`;
}

function describeGiven(given: Label) {
    return `${given.name}: ${given.type}`;
}

function describeMatch(match: Match, depth: number): any {
    throw new Error("Function not implemented.");
}

