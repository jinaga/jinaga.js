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
        expect(() => parseSpecification(`
            (parent: MyApp.Parent) {
                child: MyApp.Child []
            }`)).toThrowError(
            /The match for 'child' has no conditions/
        );
    });

    it("requires that each label be different from given", () => {
        expect(() => parseSpecification(`
            (parent: MyApp.Parent) {
                parent: MyApp.Parent [
                    parent->parent:MyApp.Parent = parent
                ]
            }`)).toThrowError(
            /The name 'parent' has already been used/
        );
    });

    it("requires that each label be unique", () => {
        expect(() => parseSpecification(`
            (parent: MyApp.Parent) {
                child: MyApp.Child [
                    child->parent:MyApp.Parent = parent
                ]
                child: MyApp.Child [
                    child->parent:MyApp.Parent = child
                ]
            }`)).toThrowError(
            /The name 'child' has already been used/
        );
    });

    it("requires that the left label be the unknown", () => {
        expect(() => parseSpecification(`
            (parent: MyApp.Parent) {
                child: MyApp.Child [
                    parent = child->parent:MyApp.Parent
                ]
            }`)).toThrowError(
            /The unknown 'child' must appear on the left side of the path/
        );
    });

    it("requires that a label be defined before use", () => {
        expect(() => parseSpecification(`
            (parent: MyApp.Parent) {
                child: MyApp.Child [
                    child->parent:MyApp.Parent = sibling
                ]
            }`)).toThrowError(
            /The label 'sibling' has not been defined/
        );
    });

    it("accepts multiple givens", () => {
        const specification = parseSpecification(`
            (user: Jinaga.User, company: MyApp.Company) {
                assignment: MyApp.Assignment [
                    assignment->user:Jinaga.User = user
                    assignment->project:MyApp.Project->company:MyApp.Company = company
                ]
            }`);
        const expected: Specification = {
            given: [
                {
                    name: "user",
                    type: "Jinaga.User"
                },
                {
                    name: "company",
                    type: "MyApp.Company"
                }
            ],
            matches: [
                {
                    unknown: {
                        name: "assignment",
                        type: "MyApp.Assignment"
                    },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [
                                {
                                    name: "user",
                                    targetType: "Jinaga.User"
                                }
                            ],
                            labelRight: "user",
                            rolesRight: []
                        },
                        {
                            type: "path",
                            rolesLeft: [
                                {
                                    name: "project",
                                    targetType: "MyApp.Project"
                                },
                                {
                                    name: "company",
                                    targetType: "MyApp.Company"
                                }
                            ],
                            labelRight: "company",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projections: []
        };
        expect(specification).toEqual(expected);
    });

    it("requires that the graph be connected", () => {
        expect(() => parseSpecification(`
            (user: Jinaga.User, company: MyApp.Company) {
                assignment: MyApp.Assignment [
                    assignment->user:Jinaga.User = user
                ]
            }`)).toThrowError(
            /The graph is not connected/
        );
    });
});