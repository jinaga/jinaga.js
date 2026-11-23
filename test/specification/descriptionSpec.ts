import { Specification, SpecificationParser } from "@src";
import { describeSpecification } from "../../src/specification/description";
import { candidateInverses } from "../../src/specification/inverse-candidates";
import { CompositeProjection } from "../../src/specification/specification";

// Issue #313. `describeProjection` ordered a composite projection's components
// with `projection.components.sort(...)`, which sorts in place, so printing a
// specification reordered the caller's own specification. `candidateInverses`
// computes its cache key by describing the specification, which put that
// mutation on the observer's hot path, and the inverses it returns copy
// `specification.projection`.

function parseSpecification(input: string): Specification {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

/** A composite projection whose components are not in name order. */
const outOfNameOrder = `(p1: Employee) {
    u1: Office [
        u1 = p1->office: Office
    ]
} => {
    zebra = u1
    apple = p1
}`;

/** The same specification, with the components written in name order. */
const inNameOrder = `(p1: Employee) {
    u1: Office [
        u1 = p1->office: Office
    ]
} => {
    apple = p1
    zebra = u1
}`;

// Issue #438. `describeProjection` ordered the components with
// `localeCompare`, which follows the host's collation, so a projection whose
// names differ in case printed in a different order from jinaga-spec and
// jinaga.net, and one specification could print two ways on two hosts.

/** Component names that an en-US collation and code unit order disagree on. */
const caseDifferingNames = ["username", "userName", "Zone", "alpha"];

/** A composite projection of those names, written in neither order. */
const caseDifferingProjection = `(p1: Employee) {
} => {
${caseDifferingNames.map(name => `    ${name} = p1.name`).join("\n")}
}`;

/** The order in which a description prints the names it was given. */
function printedOrder(description: string, names: string[]): string[] {
    const positions = names.map(name => {
        const position = description.indexOf(`${name} = `);
        expect(position).toBeGreaterThan(-1);
        return { name, position };
    });
    return positions.sort((a, b) => a.position - b.position).map(p => p.name);
}

function componentNames(specification: Specification): string[] {
    expect(specification.projection.type).toEqual("composite");
    return (specification.projection as CompositeProjection).components.map(c => c.name);
}

describe("describeSpecification", () => {
    it("leaves its argument unchanged", () => {
        const specification = parseSpecification(outOfNameOrder);
        const before = structuredClone(specification);

        describeSpecification(specification, 0);

        expect(specification).toEqual(before);
        expect(componentNames(specification)).toEqual(["zebra", "apple"]);
    });

    it("prints a composite projection's components in name order", () => {
        const description = describeSpecification(parseSpecification(outOfNameOrder), 0);

        expect(description.indexOf("apple")).toBeGreaterThan(-1);
        expect(description.indexOf("apple")).toBeLessThan(description.indexOf("zebra"));
    });

    it("orders components by code unit, not by the host's collation", () => {
        // `Array.prototype.sort` with no comparator compares UTF-16 code units,
        // so the expectation is derived from the language rather than restated
        // from the printer's own comparison.
        const byCodeUnit = [...caseDifferingNames].sort();

        const description = describeSpecification(parseSpecification(caseDifferingProjection), 0);

        expect(printedOrder(description, caseDifferingNames)).toEqual(byCodeUnit);
    });

    it("gives two specifications that differ only in component order one description", () => {
        // `candidateInverses` keys its cache on this description, so an equal
        // description is a shared cache key.
        const fromOutOfOrder = describeSpecification(parseSpecification(outOfNameOrder), 0);
        const fromInOrder = describeSpecification(parseSpecification(inNameOrder), 0);

        expect(fromOutOfOrder).toEqual(fromInOrder);
    });
});

describe("candidateInverses", () => {
    it("leaves its argument unchanged", () => {
        const specification = parseSpecification(outOfNameOrder);
        const before = structuredClone(specification);

        candidateInverses(specification);

        expect(specification).toEqual(before);
        expect(componentNames(specification)).toEqual(["zebra", "apple"]);
    });

    it("returns inverses that keep the argument's component order", () => {
        const specification = parseSpecification(outOfNameOrder);

        const inverses = candidateInverses(specification);

        expect(inverses.length).toBeGreaterThan(0);
        for (const inverse of inverses) {
            expect(componentNames(inverse)).toEqual(["zebra", "apple"]);
        }
    });
});
