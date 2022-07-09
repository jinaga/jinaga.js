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

    it("recognizes existential conditions", () => {
        const specification = parseSpecification(`
            (user: Jinaga.User, company: MyApp.Company) {
                assignment: MyApp.Assignment [
                    assignment->user:Jinaga.User = user
                    assignment->project:MyApp.Project->company:MyApp.Company = company
                    !E {
                        revoked: MyApp.Assignment.Revoked [
                            revoked->assignment:MyApp.Assignment = assignment
                        ]
                    }
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
                        },
                        {
                            type: "existential",
                            exists: false,
                            matches: [
                                {
                                    unknown: {
                                        name: "revoked",
                                        type: "MyApp.Assignment.Revoked"
                                    },
                                    conditions: [
                                        {
                                            type: "path",
                                            rolesLeft: [
                                                {
                                                    name: "assignment",
                                                    targetType: "MyApp.Assignment"
                                                }
                                            ],
                                            labelRight: "assignment",
                                            rolesRight: []
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ],
            projections: []
        };
        expect(specification).toEqual(expected);
    });

    it("requires that the existential condition be based on the unknown", () => {
        expect(() => parseSpecification(`
            (user: Jinaga.User, company: MyApp.Company) {
                assignment: MyApp.Assignment [
                    assignment->user:Jinaga.User = user
                    assignment->project:MyApp.Project->company:MyApp.Company = company
                    !E {
                        revoked: MyApp.Assignment.Revoked [
                            revoked->assignment:MyApp.Assignment->user:Jinaga.User = user
                        ]
                    }
                ]
            }`)).toThrowError(
            /The existential condition must be based on the unknown 'assignment'/
        );
    });

    it("accepts projections", () => {
        const specification = parseSpecification(`
            (user: Jinaga.User) {
                assignment: MyApp.Assignment [
                    assignment->user:Jinaga.User = user
                ]
            } => {
                descriptions = {
                    description: MyApp.Assignment.Description [
                        description->assignment:MyApp.Assignment = assignment
                    ]
                }
            }`);
        const expected: Specification = {
            given: [
                {
                    name: "user",
                    type: "Jinaga.User"
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
                        }
                    ]
                }
            ],
            projections: [
                {
                    type: "specification",
                    name: "descriptions",
                    matches: [
                        {
                            unknown: {
                                name: "description",
                                type: "MyApp.Assignment.Description"
                            },
                            conditions: [
                                {
                                    type: "path",
                                    rolesLeft: [
                                        {
                                            name: "assignment",
                                            targetType: "MyApp.Assignment"
                                        }
                                    ],
                                    labelRight: "assignment",
                                    rolesRight: []
                                }
                            ]
                        }
                    ],
                    projections: []
                }
            ]
        };
        expect(specification).toEqual(expected);
    });

    it("accepts projections on projections", () => {
        const specification = parseSpecification(`
            (user: Jinaga.User) {
                assignment: MyApp.Assignment [
                    assignment->user:Jinaga.User = user
                ]
            } => {
                projects = {
                    project: MyApp.Project [
                        project->assignment:MyApp.Assignment = assignment
                    ]
                } => {
                    descriptions = {
                        description: MyApp.Project.Description [
                            description->project:MyApp.Project = project
                        ]
                    }
                }
            }`);
        const expected: Specification = {
            given: [
                {
                    name: "user",
                    type: "Jinaga.User"
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
                        }
                    ]
                }
            ],
            projections: [
                {
                    type: "specification",
                    name: "projects",
                    matches: [
                        {
                            unknown: {
                                name: "project",
                                type: "MyApp.Project"
                            },
                            conditions: [
                                {
                                    type: "path",
                                    rolesLeft: [
                                        {
                                            name: "assignment",
                                            targetType: "MyApp.Assignment"
                                        }
                                    ],
                                    labelRight: "assignment",
                                    rolesRight: []
                                }
                            ]
                        }
                    ],
                    projections: [
                        {
                            type: "specification",
                            name: "descriptions",
                            matches: [
                                {
                                    unknown: {
                                        name: "description",
                                        type: "MyApp.Project.Description"
                                    },
                                    conditions: [
                                        {
                                            type: "path",
                                            rolesLeft: [
                                                {
                                                    name: "project",
                                                    targetType: "MyApp.Project"
                                                }
                                            ],
                                            labelRight: "project",
                                            rolesRight: []
                                        }
                                    ]
                                }
                            ],
                            projections: []
                        }
                    ]
                }
            ]
        };
        expect(specification).toEqual(expected);
    });
});