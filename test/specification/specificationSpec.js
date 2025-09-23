"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
function parseSpecification(input) {
    const parser = new _src_1.SpecificationParser(input);
    parser.skipWhitespace();
    return parser.parseSpecification();
}
describe("Specification parser", () => {
    it("parses an identity specification", () => {
        const specification = parseSpecification(`(root: Root) { }`);
        const expected = {
            given: [
                {
                    label: {
                        name: "root",
                        type: "Root"
                    },
                    conditions: []
                }
            ],
            matches: [],
            projection: {
                type: "composite",
                components: []
            }
        };
        expect(specification).toEqual(expected);
    });
    it("parses a simple specification", () => {
        const specification = parseSpecification(`
            (parent: MyApp.Parent) {
                child: MyApp.Child [
                    child->parent:MyApp.Parent = parent
                ]
            }`);
        const expected = {
            given: [
                {
                    label: {
                        name: "parent",
                        type: "MyApp.Parent"
                    },
                    conditions: []
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
                                    predecessorType: "MyApp.Parent"
                                }
                            ],
                            labelRight: "parent",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: {
                type: "composite",
                components: []
            }
        };
        expect(specification).toEqual(expected);
    });
    it("requires at least one given", () => {
        expect(() => parseSpecification("() { }")).toThrowError(/The specification must contain at least one given label/);
    });
    it("requires at least one condition", () => {
        expect(() => parseSpecification(`
            (parent: MyApp.Parent) {
                child: MyApp.Child []
            }`)).toThrowError(/The match for 'child' has no conditions/);
    });
    it("requires that each label be different from given", () => {
        expect(() => parseSpecification(`
            (parent: MyApp.Parent) {
                parent: MyApp.Parent [
                    parent->parent:MyApp.Parent = parent
                ]
            }`)).toThrowError(/The name 'parent' has already been used/);
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
            }`)).toThrowError(/The name 'child' has already been used/);
    });
    it("requires that the left label be the unknown", () => {
        expect(() => parseSpecification(`
            (parent: MyApp.Parent) {
                child: MyApp.Child [
                    parent = child->parent:MyApp.Parent
                ]
            }`)).toThrowError(/The unknown 'child' must appear on the left side of the path/);
    });
    it("requires that a label be defined before use", () => {
        expect(() => parseSpecification(`
            (parent: MyApp.Parent) {
                child: MyApp.Child [
                    child->parent:MyApp.Parent = sibling
                ]
            }`)).toThrowError(/The label 'sibling' has not been defined/);
    });
    it("accepts multiple givens", () => {
        const specification = parseSpecification(`
            (user: Jinaga.User, company: MyApp.Company) {
                assignment: MyApp.Assignment [
                    assignment->user:Jinaga.User = user
                    assignment->project:MyApp.Project->company:MyApp.Company = company
                ]
            }`);
        const expected = {
            given: [
                {
                    label: {
                        name: "user",
                        type: "Jinaga.User"
                    },
                    conditions: []
                },
                {
                    label: {
                        name: "company",
                        type: "MyApp.Company"
                    },
                    conditions: []
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
                                    predecessorType: "Jinaga.User"
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
                                    predecessorType: "MyApp.Project"
                                },
                                {
                                    name: "company",
                                    predecessorType: "MyApp.Company"
                                }
                            ],
                            labelRight: "company",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: {
                type: "composite",
                components: []
            }
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
        const expected = {
            given: [
                {
                    label: {
                        name: "user",
                        type: "Jinaga.User"
                    },
                    conditions: []
                },
                {
                    label: {
                        name: "company",
                        type: "MyApp.Company"
                    },
                    conditions: []
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
                                    predecessorType: "Jinaga.User"
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
                                    predecessorType: "MyApp.Project"
                                },
                                {
                                    name: "company",
                                    predecessorType: "MyApp.Company"
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
                                                    predecessorType: "MyApp.Assignment"
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
            projection: {
                type: "composite",
                components: []
            }
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
            }`)).toThrowError(/The existential condition must be based on the unknown 'assignment'/);
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
        const expected = {
            given: [
                {
                    label: {
                        name: "user",
                        type: "Jinaga.User"
                    },
                    conditions: []
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
                                    predecessorType: "Jinaga.User"
                                }
                            ],
                            labelRight: "user",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: {
                type: "composite",
                components: [
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
                                                predecessorType: "MyApp.Assignment"
                                            }
                                        ],
                                        labelRight: "assignment",
                                        rolesRight: []
                                    }
                                ]
                            }
                        ],
                        projection: {
                            type: "composite",
                            components: []
                        }
                    }
                ]
            }
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
        const expected = {
            given: [
                {
                    label: {
                        name: "user",
                        type: "Jinaga.User"
                    },
                    conditions: []
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
                                    predecessorType: "Jinaga.User"
                                }
                            ],
                            labelRight: "user",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: {
                type: "composite",
                components: [
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
                                                predecessorType: "MyApp.Assignment"
                                            }
                                        ],
                                        labelRight: "assignment",
                                        rolesRight: []
                                    }
                                ]
                            }
                        ],
                        projection: {
                            type: "composite",
                            components: [
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
                                                            predecessorType: "MyApp.Project"
                                                        }
                                                    ],
                                                    labelRight: "project",
                                                    rolesRight: []
                                                }
                                            ]
                                        }
                                    ],
                                    projection: {
                                        type: "composite",
                                        components: []
                                    }
                                }
                            ]
                        }
                    }
                ]
            }
        };
        expect(specification).toEqual(expected);
    });
    it("accepts field accessors", () => {
        const specification = parseSpecification(`
            (user: Jinaga.User) {
                name: MyApp.User.Name [
                    name->user:Jinaga.User = user
                ]
            } => {
                value = name.value
            }`);
        const expected = {
            given: [
                {
                    label: {
                        name: "user",
                        type: "Jinaga.User"
                    },
                    conditions: []
                }
            ],
            matches: [
                {
                    unknown: {
                        name: "name",
                        type: "MyApp.User.Name"
                    },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [
                                {
                                    name: "user",
                                    predecessorType: "Jinaga.User"
                                }
                            ],
                            labelRight: "user",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: {
                type: "composite",
                components: [
                    {
                        type: "field",
                        name: "value",
                        label: "name",
                        field: "value"
                    }
                ]
            }
        };
        expect(specification).toEqual(expected);
    });
    it("accepts fact component", () => {
        const specification = parseSpecification(`
            (user: Jinaga.User) {
                name: MyApp.User.Name [
                    name->user:Jinaga.User = user
                ]
            } => {
                userName = name
            }`);
        const expected = {
            given: [
                {
                    label: {
                        name: "user",
                        type: "Jinaga.User"
                    },
                    conditions: []
                }
            ],
            matches: [
                {
                    unknown: {
                        name: "name",
                        type: "MyApp.User.Name"
                    },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [
                                {
                                    name: "user",
                                    predecessorType: "Jinaga.User"
                                }
                            ],
                            labelRight: "user",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: {
                type: "composite",
                components: [
                    {
                        type: "fact",
                        name: "userName",
                        label: "name"
                    }
                ]
            }
        };
        expect(specification).toEqual(expected);
    });
    it("accepts hash result", () => {
        const specification = parseSpecification(`
            (user: Jinaga.User) {
                name: MyApp.User.Name [
                    name->user:Jinaga.User = user
                ]
            } => #name`);
        const expected = {
            given: [
                {
                    label: {
                        name: "user",
                        type: "Jinaga.User"
                    },
                    conditions: []
                }
            ],
            matches: [
                {
                    unknown: {
                        name: "name",
                        type: "MyApp.User.Name"
                    },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [
                                {
                                    name: "user",
                                    predecessorType: "Jinaga.User"
                                }
                            ],
                            labelRight: "user",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: {
                type: "hash",
                label: "name"
            }
        };
        expect(specification).toEqual(expected);
    });
    it("accepts fact result", () => {
        const specification = parseSpecification(`
            (user: Jinaga.User) {
                name: MyApp.User.Name [
                    name->user:Jinaga.User = user
                ]
            } => name`);
        const expected = {
            given: [
                {
                    label: {
                        name: "user",
                        type: "Jinaga.User"
                    },
                    conditions: []
                }
            ],
            matches: [
                {
                    unknown: {
                        name: "name",
                        type: "MyApp.User.Name"
                    },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [
                                {
                                    name: "user",
                                    predecessorType: "Jinaga.User"
                                }
                            ],
                            labelRight: "user",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: {
                type: "fact",
                label: "name"
            }
        };
        expect(specification).toEqual(expected);
    });
    it("parses a given with existential conditions", () => {
        const specification = parseSpecification(`
            (office: Office [
                !E {
                    closed: Office.Closed [
                        closed->office: Office = office
                    ]
                }
            ]) {} => office`);
        const expected = {
            given: [
                {
                    label: {
                        name: "office",
                        type: "Office"
                    },
                    conditions: [
                        {
                            type: "existential",
                            exists: false,
                            matches: [
                                {
                                    conditions: [
                                        {
                                            type: "path",
                                            rolesLeft: [
                                                {
                                                    name: "office",
                                                    predecessorType: "Office"
                                                }
                                            ],
                                            labelRight: "office",
                                            rolesRight: []
                                        }
                                    ],
                                    unknown: {
                                        name: "closed",
                                        type: "Office.Closed"
                                    }
                                }
                            ]
                        }
                    ]
                }
            ],
            matches: [],
            projection: {
                type: "fact",
                label: "office"
            }
        };
        expect(specification).toEqual(expected);
    });
});
//# sourceMappingURL=specificationSpec.js.map