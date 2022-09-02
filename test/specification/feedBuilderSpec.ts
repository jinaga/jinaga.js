import { dehydrateReference } from "../../src/fact/hydrate";
import { Feed } from "../../src/specification/feed";
import { FeedBuilder } from "../../src/specification/feed-builder";
import { SpecificationParser } from "../../src/specification/specification-parser";

describe("feed generator", () => {
    it("should produce a single feed for a simple specification", () => {
        const feeds = getFeeds(`
            (root: Root) {
                child: Child [
                    child->root:Root = root
                ]
            }`);

        const expectedFeeds: Feed[] = [
            {
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
                        factHash: root.hash
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
                outputs: [
                    {
                        factIndex: 2
                    }
                ]
            }
        ];

        expect(feeds).toEqual(expectedFeeds);
    });

    it("should accept multiple givens", () => {
        const feeds = getFeeds(`
            (user: Jinaga.User, root: Root) {
                assignment: MyApp.Assignment [
                    assignment->user:Jinaga.User = user
                    assignment->project:MyApp.Project->root:Root = root
                ]
            }
        `);

        const expectedFeeds: Feed[] = [
            {
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
                        factHash: user.hash
                    },
                    {
                        factIndex: 3,
                        factHash: root.hash
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
                outputs: [
                    {
                        factIndex: 2
                    }
                ]
            }
        ];

        expect(feeds).toEqual(expectedFeeds);
    });

    it("should accept existential conditions", () => {
        const feeds = getFeeds(`
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

        const expectedFeeds: Feed[] = [
            {
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
                        factHash: user.hash
                    },
                    {
                        factIndex: 3,
                        factHash: root.hash
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
                outputs: [
                    {
                        factIndex: 2
                    }
                ]
            },
            {
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
                        factHash: user.hash
                    },
                    {
                        factIndex: 3,
                        factHash: root.hash
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
                    },
                    {
                        edgeIndex: 4,
                        predecessorFactIndex: 2,
                        successorFactIndex: 5,
                        roleName: "assignment"
                    }
                ],
                outputs: [
                    {
                        factIndex: 2
                    },
                    {
                        factIndex: 5
                    }
                ]
            }
        ];

        expect(feeds).toEqual(expectedFeeds);
    });
});

const root = dehydrateReference({ type: 'Root' });
const user = dehydrateReference({ type: "Jinaga.User", publicKey: "PUBLIC KEY"});

function getFeeds(input: string): Feed[] {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    const specification = parser.parseSpecification();

    const start = specification.given.map(input => {
        if (input.type === 'Root') {
            return root;
        }
        if (input.type === 'Jinaga.User') {
            return user;
        }
        throw new Error(`Unknown input type ${input.type}`);
    });

    const feedBuilder = new FeedBuilder();
    const feeds = feedBuilder.buildFeeds(start, specification);
    return feeds;
}