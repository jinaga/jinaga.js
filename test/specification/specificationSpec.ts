import { Specification } from "../../src/specification/specification"
import { parseSpecification } from "../../src/specification/specification-parser"

describe("Specification parser", () => {
    it("parses a simple specification", () => {
        const specification = parseSpecification(`
            (parent: MyApp.Parent) {
                child: MyApp.Child [
                    child->parent:MyApp.Parent = parent
                ]
            }`);
        const expected: Specification = {
            given: [
                {
                    name: "parent",
                    type: "MyApp.Parent"
                }
            ],
            matches: [
                {
                    unknown: {
                        name: "child",
                        type: "MyApp.Child"
                    },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [
                                {
                                    name: "parent",
                                    targetType: "MyApp.Parent"
                                }
                            ],
                            labelRight: "parent",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projections: []
        };
        expect(specification).toEqual(expected);
    });

    it("requires at least one given", () => {
        expect(() => parseSpecification("() { }")).toThrowError(
            /The specification must contain at least one given label/
        );
    });

    it("requires at least one match", () => {
        expect(() => parseSpecification("(parent: MyApp.Parent) { }")).toThrowError(
            /The specification must contain at least one match/
        );
    });

    it("requires at least one condition", () => {
        expect(() => parseSpecification("(parent: MyApp.Parent) { child: MyApp.Child [] }")).toThrowError(
            /The match for child has no conditions/
        );
    });
});