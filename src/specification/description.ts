import { Label, Specification } from "../../src/specification/specification";

export function describeSpecification(specification: Specification, depth: number) {
    const indent = "    ".repeat(depth);
    const given = specification.given.map(given => describeGiven(given)).join(", ");
    const matches = "";
    const projection = "";

    return `${indent}(${given}) {\n${matches}${indent}}${projection}\n`;
}

function describeGiven(given: Label) {
    return `${given.name}: ${given.type}`;
}

