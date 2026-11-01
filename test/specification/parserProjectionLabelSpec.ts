import { SpecificationParser } from "@src";
import { Invalid } from "../../src/specification/specification-parser";

// Issue #314: the parser checks a label in exactly two places -- `parsePathCondition`
// requires that a joined label be defined, and `parseMatch` requires that an unknown
// be new. `parseProjection` and `parseComponent` read an identifier and never look it
// up, so a projection that names a label nothing defines parses. The defect surfaces
// much later, from `SpecificationRunner`, when the specification first runs -- or, for
// a specification the split hands to a rule, when the rule is first evaluated.

function parse(text: string) {
    const parser = new SpecificationParser(text);
    parser.skipWhitespace();
    const specification = parser.parseSpecification();
    parser.expectEnd();
    return specification;
}

const matches = `(p1: Employee) {
    u1: Office [ u1 = p1->office: Office ]
    u2: President [ u2->office: Office = u1 ]
}`;

describe("Parser projection labels", () => {
    it("should reject a fact projection that names an undefined label", () => {
        expect(() => parse(`${matches} => nosuchlabel`))
            .toThrow(/The label 'nosuchlabel' has not been defined/);
    });

    it("should reject a hash projection that names an undefined label", () => {
        expect(() => parse(`${matches} => #nosuchlabel`))
            .toThrow(/The label 'nosuchlabel' has not been defined/);
    });

    it("should reject a time projection that names an undefined label", () => {
        expect(() => parse(`${matches} => @nosuchlabel`))
            .toThrow(/The label 'nosuchlabel' has not been defined/);
    });

    it("should reject a field projection that names an undefined label", () => {
        expect(() => parse(`${matches} => nosuchlabel.field`))
            .toThrow(/The label 'nosuchlabel' has not been defined/);
    });

    it("should throw Invalid, as the parser's other label checks do", () => {
        expect(() => parse(`${matches} => nosuchlabel`)).toThrow(Invalid);
    });

    it("should reject each kind of undefined component of a composite projection", () => {
        const components = [
            "president = nosuchlabel",
            "hash = #nosuchlabel",
            "time = @nosuchlabel",
            "field = nosuchlabel.name"
        ];
        for (const component of components) {
            expect(() => parse(`${matches} => {\n    ${component}\n}`))
                .toThrow(/The label 'nosuchlabel' has not been defined/);
        }
    });

    it("should reject an undefined label beside components that are defined", () => {
        expect(() => parse(`${matches} => {
    office = u1
    president = nosuchlabel
}`)).toThrow(/The label 'nosuchlabel' has not been defined/);
    });

    it("should reject an undefined label in the projection of a nested specification", () => {
        expect(() => parse(`${matches} => {
    managers = {
        u3: Manager [ u3->office: Office = u1 ]
    } => nosuchlabel
}`)).toThrow(/The label 'nosuchlabel' has not been defined/);
    });

    it("should reject an undefined label in a component of a nested specification", () => {
        expect(() => parse(`${matches} => {
    managers = {
        u3: Manager [ u3->office: Office = u1 ]
    } => {
        name = nosuchlabel.name
    }
}`)).toThrow(/The label 'nosuchlabel' has not been defined/);
    });

    it("should accept a projection that names a given, an unknown, or an outer label", () => {
        expect(() => parse(`${matches} => p1`)).not.toThrow();
        expect(() => parse(`${matches} => u2`)).not.toThrow();
        expect(() => parse(`${matches} => #u2`)).not.toThrow();
        expect(() => parse(`${matches} => @u2`)).not.toThrow();
        expect(() => parse(`${matches} => u2.name`)).not.toThrow();
        expect(() => parse(`${matches} => {
    employee = p1
    office = u1
    presidentHash = #u2
    presidentTime = @u2
    presidentName = u2.name
    managers = {
        u3: Manager [ u3->office: Office = u1 ]
    } => {
        office = u1
        manager = u3
        name = u3.name
    }
}`)).not.toThrow();
    });

    it("should not leak a nested specification's label into the outer projection", () => {
        // `u3` is declared inside the component, so the outer projection must not see
        // it. A label list threaded by reference rather than copied would accept this.
        expect(() => parse(`${matches} => {
    managers = {
        u3: Manager [ u3->office: Office = u1 ]
    } => u3
    stray = u3
}`)).toThrow(/The label 'u3' has not been defined/);
    });
});
