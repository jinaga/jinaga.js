"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
describe("skeleton", () => {
    it("should produce an empty skeleton for an identity specification", () => {
        const skeleton = getSkeleton(`
            (root: Root) { }`);
        const expectedSkeleton = {
            facts: [],
            inputs: [],
            edges: [],
            notExistsConditions: [],
            outputs: []
        };
        expect(skeleton).toEqual(expectedSkeleton);
    });
    it("should produce a skeleton for a simple specification", () => {
        const skeleton = getSkeleton(`
            (root: Root) {
                child: Child [
                    child->root:Root = root
                ]
            }`);
        const expectedSkeleton = {
            facts: [
                {
                    factIndex: 1,
                    factType: "Root"
                },
                {
                    factIndex: 2,
                    factType: "Child"
                }
            ],
            inputs: [
                {
                    factIndex: 1,
                    inputIndex: 0
                }
            ],
            edges: [
                {
                    edgeIndex: 1,
                    predecessorFactIndex: 1,
                    successorFactIndex: 2,
                    roleName: "root"
                }
            ],
            notExistsConditions: [],
            outputs: [
                {
                    factIndex: 2
                }
            ]
        };
        expect(skeleton).toEqual(expectedSkeleton);
    });
    it("should accept multiple givens", () => {
        const skeleton = getSkeleton(`
            (user: Jinaga.User, root: Root) {
                assignment: MyApp.Assignment [
                    assignment->user:Jinaga.User = user
                    assignment->project:MyApp.Project->root:Root = root
                ]
            }
        `);
        const expectedSkeleton = {
            facts: [
                {
                    factIndex: 1,
                    factType: "Jinaga.User"
                },
                {
                    factIndex: 2,
                    factType: "MyApp.Assignment"
                },
                {
                    factIndex: 3,
                    factType: "Root"
                },
                {
                    factIndex: 4,
                    factType: "MyApp.Project"
                }
            ],
            inputs: [
                {
                    factIndex: 1,
                    inputIndex: 0
                },
                {
                    factIndex: 3,
                    inputIndex: 1
                }
            ],
            edges: [
                {
                    edgeIndex: 1,
                    predecessorFactIndex: 1,
                    successorFactIndex: 2,
                    roleName: "user"
                },
                {
                    edgeIndex: 2,
                    predecessorFactIndex: 3,
                    successorFactIndex: 4,
                    roleName: "root"
                },
                {
                    edgeIndex: 3,
                    predecessorFactIndex: 4,
                    successorFactIndex: 2,
                    roleName: "project"
                }
            ],
            notExistsConditions: [],
            outputs: [
                {
                    factIndex: 2
                }
            ]
        };
        expect(skeleton).toEqual(expectedSkeleton);
    });
    it("should accept existential conditions", () => {
        const skeleton = getSkeleton(`
            (user: Jinaga.User, root: Root) {
                assignment: MyApp.Assignment [
                    assignment->user:Jinaga.User = user
                    assignment->project:MyApp.Project->root:Root = root
                    !E {
                        revoked: MyApp.Assignment.Revoked [
                            revoked->assignment:MyApp.Assignment = assignment
                        ]
                    }
                ]
            }`);
        const expectedSkeleton = {
            facts: [
                {
                    factIndex: 1,
                    factType: "Jinaga.User"
                },
                {
                    factIndex: 2,
                    factType: "MyApp.Assignment"
                },
                {
                    factIndex: 3,
                    factType: "Root"
                },
                {
                    factIndex: 4,
                    factType: "MyApp.Project"
                },
                {
                    factIndex: 5,
                    factType: "MyApp.Assignment.Revoked"
                }
            ],
            inputs: [
                {
                    factIndex: 1,
                    inputIndex: 0
                },
                {
                    factIndex: 3,
                    inputIndex: 1
                }
            ],
            edges: [
                {
                    edgeIndex: 1,
                    predecessorFactIndex: 1,
                    successorFactIndex: 2,
                    roleName: "user"
                },
                {
                    edgeIndex: 2,
                    predecessorFactIndex: 3,
                    successorFactIndex: 4,
                    roleName: "root"
                },
                {
                    edgeIndex: 3,
                    predecessorFactIndex: 4,
                    successorFactIndex: 2,
                    roleName: "project"
                }
            ],
            notExistsConditions: [
                {
                    edges: [
                        {
                            edgeIndex: 4,
                            predecessorFactIndex: 2,
                            successorFactIndex: 5,
                            roleName: "assignment"
                        }
                    ],
                    notExistsConditions: []
                }
            ],
            outputs: [
                {
                    factIndex: 2
                }
            ]
        };
        expect(skeleton).toEqual(expectedSkeleton);
    });
    it("should accept multiple matches", () => {
        const skeleton = getSkeleton(`
            (root: Root) {
                project: MyApplication.Project [
                    project->root: Root = root
                ]
                name: MyApplication.Project.Name [
                    name->project: MyApplication.Project = project
                ]
            }`);
        const expectedSkeleton = {
            facts: [
                {
                    factIndex: 1,
                    factType: "Root"
                },
                {
                    factIndex: 2,
                    factType: "MyApplication.Project"
                },
                {
                    factIndex: 3,
                    factType: "MyApplication.Project.Name"
                }
            ],
            inputs: [
                {
                    factIndex: 1,
                    inputIndex: 0
                }
            ],
            edges: [
                {
                    edgeIndex: 1,
                    predecessorFactIndex: 1,
                    successorFactIndex: 2,
                    roleName: "root"
                },
                {
                    edgeIndex: 2,
                    predecessorFactIndex: 2,
                    successorFactIndex: 3,
                    roleName: "project"
                }
            ],
            notExistsConditions: [],
            outputs: [
                {
                    factIndex: 2
                },
                {
                    factIndex: 3
                }
            ]
        };
        expect(skeleton).toEqual(expectedSkeleton);
    });
});
function getSkeleton(input) {
    const parser = new _src_1.SpecificationParser(input);
    parser.skipWhitespace();
    const specification = parser.parseSpecification();
    const skeleton = (0, _src_1.skeletonOfSpecification)(specification);
    return skeleton;
}
//# sourceMappingURL=skeletonSpec.js.map