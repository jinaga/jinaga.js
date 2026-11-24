import { Condition, DisconnectedSpecificationError, ExistentialCondition, Invalid, Match, Specification, SpecificationParser, buildFeeds, detectDisconnectedSpecification, wellFormedErrors } from "@src";

function parseSpecification(input: string): Specification {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

const given = (name: string, type: string) => ({ label: { name, type }, conditions: [] });
const successor = (role: string, predecessorType: string, labelRight: string): Condition => ({
    type: "path", rolesLeft: [{ name: role, predecessorType }], labelRight, rolesRight: []
});
const predecessor = (role: string, predecessorType: string, labelRight: string): Condition => ({
    type: "path", rolesLeft: [], labelRight, rolesRight: [{ name: role, predecessorType }]
});
const match = (name: string, type: string, ...conditions: Condition[]): Match => ({
    unknown: { name, type }, conditions
});
const not = (...matches: Match[]): ExistentialCondition => ({ type: "existential", exists: false, matches });
const exists = (...matches: Match[]): Condition => ({ type: "existential", exists: true, matches });

/**
 * The refusal names every label of each side of the break, and puts the two
 * sides in different subgraphs.
 *
 * Both sides are the vector's own: a message that omits a label, or that lumps
 * the two sides together, does not say what was refused or where to rewrite it.
 */
function expectSidesNamed(message: string, left: string[], right: string[]) {
    const subgraphs = message.split("Subgraph ").slice(1);
    expect(subgraphs.length).toBeGreaterThanOrEqual(2);
    const sideOf = (labels: string[]) => {
        const indices = labels.map(label => subgraphs.findIndex(subgraph => subgraph.includes(`'${label}'`)));
        expect(indices).not.toContain(-1);
        expect(new Set(indices).size).toBe(1);
        return indices[0];
    };
    expect(sideOf(left)).not.toBe(sideOf(right));
}

function refusal(specification: Specification): DisconnectedSpecificationError {
    // The vectors are well formed, so the refusal is for connectedness alone.
    expect(wellFormedErrors(specification)).toEqual([]);
    let thrown: any = undefined;
    try {
        detectDisconnectedSpecification(specification);
    }
    catch (error: any) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(DisconnectedSpecificationError);
    return thrown;
}

// The five well-formed vectors of jinaga-spec on which jinaga.js's
// `detectDisconnectedSpecification` disagreed with `isConnectedDeep`
// (jinaga/jinaga-spec#55, #57). Each is transcribed from the vector of the
// same name under `vectors/well-formed`.

// P, `child-joins-two-chains-only-in-a-grandchild`: a child joins its parent
// only through a grandchild.
const childJoinsTwoChainsOnlyInAGrandchild: Specification = {
    given: [given("p1", "R"), given("p2", "A")],
    matches: [match("u", "A", successor("a", "A", "p2"))],
    projection: {
        type: "composite",
        components: [{
            type: "specification",
            name: "k",
            matches: [match("c", "A", successor("r", "R", "p1"))],
            projection: {
                type: "composite",
                components: [{
                    type: "specification",
                    name: "g",
                    matches: [match("x", "B", successor("c", "A", "c"), successor("u", "A", "u"))],
                    projection: { type: "fact", label: "x" }
                }]
            }
        }]
    }
};

// J!, `negative-condition-before-the-join`: a negative condition cuts the feed
// before the match that joins two chains.
const negativeConditionBeforeTheJoin: Specification = {
    given: [given("p1", "R"), given("p2", "A")],
    matches: [
        match("u", "A", successor("a", "A", "p2")),
        match("c", "A", successor("r", "R", "p1"), not(match("e", "E", successor("c", "A", "c")))),
        match("x", "B", successor("c", "A", "c"), successor("u", "A", "u"))
    ],
    projection: { type: "fact", label: "x" }
};

// N, `negative-condition-joins-another-given`: a negative condition is the only
// thing that reaches a second given.
const negativeConditionJoinsAnotherGiven: Specification = {
    given: [given("p1", "R"), given("p2", "A")],
    matches: [
        match("u", "A", successor("a", "A", "p2"), not(match("e", "E", successor("r", "R", "p1"))))
    ],
    projection: { type: "fact", label: "u" }
};

// B, `negative-condition-joins-two-chains`: a filter is the only thing that
// joins two chains.
const negativeConditionJoinsTwoChains: Specification = {
    given: [given("p1", "R"), given("p2", "A")],
    matches: [
        match("u", "U", successor("r", "R", "p1")),
        match("x", "X", successor("a", "A", "p2"),
            not(match("e", "E", successor("u", "U", "u"), successor("x", "X", "x"))))
    ],
    projection: { type: "fact", label: "x" }
};

// `negative-condition-joined-only-inside-its-own`: a filter joined only through
// its own negative condition.
const negativeConditionJoinedOnlyInsideItsOwn: Specification = {
    given: [given("p", "P")],
    matches: [
        match("u", "U", predecessor("up", "U", "p"),
            not(match("e", "E",
                not(match("f", "F", successor("e", "E", "e"), successor("u", "U", "u")))))),
        match("x", "X", successor("u", "U", "u"))
    ],
    projection: { type: "fact", label: "x" }
};

describe("a specification whose feeds would be a product", () => {
    it("refuses P, where a child joins its parent only through a grandchild", () => {
        const error = refusal(childJoinsTwoChainsOnlyInAGrandchild);
        expectSidesNamed(error.message, ["u:A", "p2:A"], ["c:A", "p1:R"]);
    });

    it("refuses J!, where a negative condition cuts the feed before the join", () => {
        const error = refusal(negativeConditionBeforeTheJoin);
        expectSidesNamed(error.message, ["u:A", "p2:A"], ["c:A", "p1:R", "e:E"]);
    });

    it("refuses N, where a negative condition is the only thing that reaches a second given", () => {
        const error = refusal(negativeConditionJoinsAnotherGiven);
        expectSidesNamed(error.message, ["u:A", "p2:A"], ["e:E", "p1:R"]);
    });

    it("refuses B, where a filter is the only thing that joins two chains", () => {
        const error = refusal(negativeConditionJoinsTwoChains);
        expectSidesNamed(error.message, ["u:U", "p1:R"], ["x:X", "p2:A"]);
    });

    it("refuses a filter joined only through its own negative condition", () => {
        const error = refusal(negativeConditionJoinedOnlyInsideItsOwn);
        expectSidesNamed(error.message, ["u:U", "p:P", "x:X"], ["e:E"]);
    });

    it("refuses two chains that only a condition on a given names together", () => {
        // A condition on a given filters the one row that given contributes;
        // it joins nothing, so a feed takes its givens without their
        // conditions. Counting the labels such a condition names as joins
        // accepted this specification, and its matches walk only predecessors,
        // so it has no feed for clause 3 to read either.
        const error = refusal({
            given: [
                {
                    label: { name: "p1", type: "Post" },
                    conditions: [not(match("x", "Flag",
                        successor("post", "Post", "p1"),
                        successor("other", "Post", "p2")))]
                },
                given("p2", "Post")
            ],
            matches: [
                match("a", "Author", predecessor("author", "Author", "p1")),
                match("b", "Author", predecessor("author", "Author", "p2"))
            ],
            projection: {
                type: "composite",
                components: [
                    { type: "fact", name: "a", label: "a" },
                    { type: "fact", name: "b", label: "b" }
                ]
            }
        });
        expectSidesNamed(error.message, ["a:Author", "p1:Post"], ["b:Author", "p2:Post"]);
    });

    it("refuses P where feeds are built, rather than returning feeds", () => {
        expect(() => buildFeeds(childJoinsTwoChainsOnlyInAGrandchild))
            .toThrow(DisconnectedSpecificationError);
    });
});

describe("a specification whose feeds would be a product, in text", () => {
    // P, J! and B parse, so the connectedness check is what refuses them.
    it("refuses P when it is parsed", () => {
        expect(() => parseSpecification(`
            (p1: R, p2: A) {
                u: A [
                    u->a: A = p2
                ]
            } => {
                k = {
                    c: A [
                        c->r: R = p1
                    ]
                } => {
                    g = {
                        x: B [
                            x->c: A = c
                            x->u: A = u
                        ]
                    } => x
                }
            }`)).toThrow(DisconnectedSpecificationError);
    });

    it("refuses J! when it is parsed", () => {
        expect(() => parseSpecification(`
            (p1: R, p2: A) {
                u: A [
                    u->a: A = p2
                ]
                c: A [
                    c->r: R = p1
                    !E {
                        e: E [
                            e->c: A = c
                        ]
                    }
                ]
                x: B [
                    x->c: A = c
                    x->u: A = u
                ]
            } => x`)).toThrow(DisconnectedSpecificationError);
    });

    it("refuses B when it is parsed", () => {
        expect(() => parseSpecification(`
            (p1: R, p2: A) {
                u: U [
                    u->r: R = p1
                ]
                x: X [
                    x->a: A = p2
                    !E {
                        e: E [
                            e->u: U = u
                            e->x: X = x
                        ]
                    }
                ]
            } => x`)).toThrow(DisconnectedSpecificationError);
    });

    // N's condition names no label of the match it is written on, which the
    // parser refuses by its own rule, before connectedness is read. That
    // message carries N's rewrite.
    it("refuses N when it is parsed, naming the unknown its condition must be based on", () => {
        let thrown: any = undefined;
        try {
            parseSpecification(`
                (p1: R, p2: A) {
                    u: A [
                        u->a: A = p2
                        !E {
                            e: E [
                                e->r: R = p1
                            ]
                        }
                    ]
                } => u`);
        }
        catch (error: any) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(Invalid);
        expect(thrown.message).toContain("'u'");
    });

    // The match for `e` has no path condition, which the parser refuses by its
    // own rule, with a message that already says how to fix it.
    it("refuses a filter joined only through its own negative condition when it is parsed", () => {
        let thrown: any = undefined;
        try {
            parseSpecification(`
                (p: P) {
                    u: U [
                        u = p->up: U
                        !E {
                            e: E [
                                !E {
                                    f: F [
                                        f->e: E = e
                                        f->u: U = u
                                    ]
                                }
                            ]
                        }
                    ]
                    x: X [
                        x->u: U = u
                    ]
                } => x`);
        }
        catch (error: any) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(Invalid);
        expect(thrown.message).toContain("'e'");
    });
});

describe("the rewrite of a specification whose feeds would be a product", () => {
    function accepts(text: string) {
        const specification = parseSpecification(text);
        expect(wellFormedErrors(specification)).toEqual([]);
        expect(() => buildFeeds(specification)).not.toThrow();
        return specification;
    }

    it("accepts P's sparse matrix, with the column declared beside the cell", () => {
        accepts(`
            (p1: R, p2: A) {
                u: A [
                    u->a: A = p2
                ]
            } => {
                cells = {
                    c: A [
                        c->r: R = p1
                    ]
                    x: B [
                        x->c: A = c
                        x->u: A = u
                    ]
                } => {
                    column = c
                    value = x
                }
            }`);
    });

    it("accepts P's rows and columns as children of a root with no matches", () => {
        accepts(`
            (p1: R, p2: A) {
            } => {
                rows = {
                    u: A [
                        u->a: A = p2
                    ]
                } => {
                    cells = {
                        c: A [
                            c->r: R = p1
                        ]
                        x: B [
                            x->c: A = c
                            x->u: A = u
                        ]
                    } => x
                }
                columns = {
                    k: A [
                        k->r: R = p1
                    ]
                }
            }`);
    });

    it("accepts J! ordered from c, which defers x", () => {
        accepts(`
            (p1: R, p2: A) {
                c: A [
                    c->r: R = p1
                    !E {
                        e: E [
                            e->c: A = c
                        ]
                    }
                ]
                x: B [
                    x->c: A = c
                ]
                u: A [
                    u = x->u: A
                    u->a: A = p2
                ]
            } => x`);
    });

    it("accepts J! ordered to reach c through x, which sends only joined facts", () => {
        accepts(`
            (p1: R, p2: A) {
                u: A [
                    u->a: A = p2
                ]
                x: B [
                    x->u: A = u
                ]
                c: A [
                    c = x->c: A
                    c->r: R = p1
                    !E {
                        e: E [
                            e->c: A = c
                        ]
                    }
                ]
            } => x`);
    });

    it("accepts N with its condition joined to the match it filters", () => {
        accepts(`
            (p1: R, p2: A) {
                u: A [
                    u->a: A = p2
                    !E {
                        e: E [
                            e->r: R = p1
                            e->u: A = u
                        ]
                    }
                ]
            } => u`);
    });

    it("accepts N's blockers and users as children of a root with no matches", () => {
        accepts(`
            (p1: R, p2: A) {
            } => {
                blockers = {
                    e: E [
                        e->r: R = p1
                    ]
                }
                users = {
                    u: A [
                        u->a: A = p2
                    ]
                }
            }`);
    });

    it("accepts B with the member moved into the condition", () => {
        accepts(`
            (p1: R, p2: A) {
                x: X [
                    x->a: A = p2
                    !E {
                        u: U [
                            u->r: R = p1
                        ]
                        e: E [
                            e->u: U = u
                            e->x: X = x
                        ]
                    }
                ]
            } => x`);
    });

    it("accepts B's links and items as children of a root with no matches", () => {
        accepts(`
            (p1: R, p2: A) {
            } => {
                members = {
                    u: U [
                        u->r: R = p1
                    ]
                } => {
                    links = {
                        e: E [
                            e->u: U = u
                        ]
                    }
                }
                items = {
                    x: X [
                        x->a: A = p2
                    ]
                }
            }`);
    });

    it("accepts two chains of predecessors as one child each", () => {
        accepts(`
            (p1: Post, p2: Post) {
            } => {
                a = {
                    a: Author [
                        a = p1->author: Author
                    ]
                }
                b = {
                    b: Author [
                        b = p2->author: Author
                    ]
                }
            }`);
    });

});

// A given that no match uses contributes one row to every answer, so it is no
// factor of a product and no component of its own. jinaga/jinaga-spec#60
// dropped the clause that refused one, and `isConnected` counts only the
// givens the matches use. The first two are transcribed from the vectors of
// those names under `vectors/well-formed`.
describe("a given no match uses", () => {
    function accepts(text: string) {
        const specification = parseSpecification(text);
        expect(wellFormedErrors(specification)).toEqual([]);
        expect(() => detectDisconnectedSpecification(specification)).not.toThrow();
        expect(() => buildFeeds(specification)).not.toThrow();
        return specification;
    }

    it("accepts unused-given, where a match uses one of the two givens", () => {
        accepts(`
            (p1: R, p2: A) {
                u: A [
                    u->r: R = p1
                ]
            } => u`);
    });

    it("accepts no-matches-two-givens, where neither given is used", () => {
        accepts(`
            (p1: R, p2: A) {
            } => p2`);
    });

    it("accepts a given that no match of the specification or of a child uses", () => {
        accepts(`
            (p1: R, p2: A) {
                u: A [
                    u->r: R = p1
                ]
            } => {
                children = {
                    c: C [
                        c->u: A = u
                    ]
                }
            }`);
    });

    it("accepts a given that only the filter of a negative condition names", () => {
        accepts(`
            (p1: R, p2: A) {
                u: A [
                    u->r: R = p1
                    !E {
                        e: E [
                            e->u: A = u
                            e->a: A = p2
                        ]
                    }
                ]
            } => u`);
    });
});

describe("an independent child placed under a match", () => {
    // A child inherits its parent's matches, so a child placed under a match is
    // joined to that match's chain and is not independent of it. Each of these
    // is the rewrite of the row above it, hung under `u` instead of under a
    // root with no matches.
    it("refuses P's columns under u", () => {
        expect(() => parseSpecification(`
            (p1: R, p2: A) {
                u: A [
                    u->a: A = p2
                ]
            } => {
                columns = {
                    k: A [
                        k->r: R = p1
                    ]
                }
            }`)).toThrow(DisconnectedSpecificationError);
    });

    it("refuses N's blockers under u", () => {
        expect(() => parseSpecification(`
            (p1: R, p2: A) {
                u: A [
                    u->a: A = p2
                ]
            } => {
                blockers = {
                    e: E [
                        e->r: R = p1
                    ]
                }
            }`)).toThrow(DisconnectedSpecificationError);
    });

    it("refuses B's items under u", () => {
        expect(() => parseSpecification(`
            (p1: R, p2: A) {
                u: U [
                    u->r: R = p1
                ]
            } => {
                items = {
                    x: X [
                        x->a: A = p2
                    ]
                }
            }`)).toThrow(DisconnectedSpecificationError);
    });
});
