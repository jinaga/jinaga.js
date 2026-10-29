import { FactRecord, FactReference, MemoryStore } from "@src";
import { candidateInverses, pinLabel, reduceGivenConditions } from "../../src/specification/inverse-candidates";
import { describeSpecification } from "../../src/specification/description";
import { Condition, ExistentialCondition, Match, PathCondition, Specification } from "../../src/specification/specification";

// Issue #338. An inverse of `invertSpecification` reads, on the new graph, the
// conditions of a level whose solution existed only on the old one, so a change
// that reaches a row through a negation is never reported. The shapes below are
// jinaga-spec's inverse vectors for that defect, each one a case its randomized
// check traced to this cause:
//
//   exists { notExists }        exists-not-exists-removes
//   sibling notExists           sibling-not-exists
//   notExists{notExists{exists}} depth-three-gain
//   a reused label (#343)       reused-label
//   unread messages (#141)      correlated-not-exists
//
// Each test asserts what `candidates_complete` proves: every row the fresh fact
// gains or loses is among the rows the candidate inverses find. The candidates
// are a superset by design — the re-check in #336 decides membership — so the
// assertion is coverage, not equality.

const match = (name: string, type: string, conditions: Condition[]): Match =>
    ({ unknown: { name, type }, conditions });

/** `u->role: predecessorType = labelRight` */
const path = (role: string, predecessorType: string, labelRight: string): PathCondition =>
    ({ type: "path", rolesLeft: [{ name: role, predecessorType }], labelRight, rolesRight: [] });

const exists = (matches: Match[]): ExistentialCondition =>
    ({ type: "existential", exists: true, matches });

const notExists = (matches: Match[]): ExistentialCondition =>
    ({ type: "existential", exists: false, matches });

/**
 * A fact of the graph. `id` stands in for the hash, as jinaga-spec's vectors do,
 * so a shape reads as its graph rather than as a list of hashes.
 */
interface Node {
    id: string;
    type: string;
    predecessors: { role: string, id: string }[];
}

const node = (id: string, type: string, ...predecessors: { role: string, id: string }[]): Node =>
    ({ id, type, predecessors });

const role = (name: string, id: string) => ({ role: name, id });

function reference(graph: Node[], id: string): FactReference {
    const found = graph.find(n => n.id === id);
    if (!found) {
        throw new Error(`The graph has no fact ${id}.`);
    }
    return { type: found.type, hash: id };
}

function record(graph: Node[], fact: Node): FactRecord {
    const predecessors: FactRecord["predecessors"] = {};
    for (const predecessor of fact.predecessors) {
        const existing = predecessors[predecessor.role];
        const value = reference(graph, predecessor.id);
        predecessors[predecessor.role] = Array.isArray(existing) ? [...existing, value] : [value];
    }
    return { type: fact.type, hash: fact.id, predecessors, fields: {} };
}

async function save(store: MemoryStore, graph: Node[], facts: Node[]): Promise<void> {
    await store.save(facts.map(fact => ({ fact: record(graph, fact), signatures: [] })));
}

/** A row's identity: the subscription's givens and the specification's own unknowns. */
function rowOf(specification: Specification, tuple: { [name: string]: FactReference }): string {
    const labels = [
        ...specification.given.map(g => g.label.name),
        ...specification.matches.map(m => m.unknown.name)
    ];
    return labels.map(label => tuple[label] ? tuple[label].hash : "-").join(",");
}

async function readRows(store: MemoryStore, specification: Specification, start: FactReference[]): Promise<string[]> {
    const results = await store.read(start, specification);
    return results.map(result => rowOf(specification, result.tuple));
}

/**
 * Save `fresh` on a store holding `graph`, and assert that every row the
 * specification gains or loses is among the candidates. Also asserts that the
 * shape does change, so a test cannot pass by the fresh fact doing nothing.
 */
async function expectCandidatesCoverTheChange(
    specification: Specification,
    graph: Node[],
    givens: string[],
    fresh: Node
): Promise<void> {
    const whole = [...graph, fresh];
    const store = new MemoryStore();
    await save(store, whole, graph);

    const start = givens.map(id => reference(whole, id));
    const before = await readRows(store, specification, start);

    await save(store, whole, [fresh]);
    const after = await readRows(store, specification, start);

    const gained = after.filter(row => !before.includes(row));
    const lost = before.filter(row => !after.includes(row));
    expect([...gained, ...lost]).not.toEqual([]);

    const freshReference = reference(whole, fresh.id);
    const candidates: string[] = [];
    for (const inverse of candidateInverses(specification)) {
        const pinned = inverse.given.find(g => g.label.name === pinLabel);
        if (!pinned || pinned.label.type !== fresh.type) {
            continue;
        }
        const results = await store.read(withGivens(inverse, start, freshReference), inverse);
        for (const result of results) {
            candidates.push(rowOf(specification, result.tuple));
        }
    }

    for (const row of [...gained, ...lost]) {
        expect(candidates.sort()).toContain(row);
    }
}

/** An inverse is read from the subscription's givens, in order, and the fresh fact. */
function withGivens(inverse: Specification, start: FactReference[], fresh: FactReference): FactReference[] {
    const references: FactReference[] = [];
    let index = 0;
    for (const given of inverse.given) {
        references.push(given.label.name === pinLabel ? fresh : start[index++]);
    }
    return references;
}

/** The reduction, printed, so a shape test reads as the specification it expects. */
const reducedDescription = (specification: Specification): string =>
    describeSpecification(reduceGivenConditions(specification), 0);

describe("inverse candidates", () => {
    it("covers the account that loses its only current mirror", async () => {
        // exists { notExists }: accounts of a root that have a mirror that is
        // not retired. Retiring the only current mirror loses the account, and
        // the lost level's `notExists` is false on the new graph.
        const specification: Specification = {
            given: [{ label: { name: "p1", type: "Root" }, conditions: [] }],
            matches: [
                match("u1", "Account", [
                    path("root", "Root", "p1"),
                    exists([
                        match("e1", "Mirror", [
                            path("account", "Account", "u1"),
                            notExists([
                                match("e2", "Retired", [path("mirror", "Mirror", "e1")])
                            ])
                        ])
                    ])
                ])
            ],
            projection: { type: "fact", label: "u1" }
        };
        const graph = [
            node("root", "Root"),
            node("account", "Account", role("root", "root")),
            node("mirror", "Mirror", role("account", "account"))
        ];

        await expectCandidatesCoverTheChange(specification, graph, ["root"],
            node("retired", "Retired", role("mirror", "mirror")));
    });

    it("covers the task whose two sibling conditions one fact falsifies together", async () => {
        // One `Done` points at the task through both roles, so it falsifies both
        // conditions at once. Each of today's inverses keeps the sibling the
        // same fact has just falsified, so neither reports the removal.
        const specification: Specification = {
            given: [{ label: { name: "p1", type: "Root" }, conditions: [] }],
            matches: [
                match("u1", "Task", [
                    path("root", "Root", "p1"),
                    notExists([match("e1", "Done", [path("task", "Task", "u1")])]),
                    notExists([match("e2", "Done", [path("other", "Task", "u1")])])
                ])
            ],
            projection: { type: "fact", label: "u1" }
        };
        const graph = [
            node("root", "Root"),
            node("task", "Task", role("root", "root"))
        ];

        await expectCandidatesCoverTheChange(specification, graph, ["root"],
            node("done", "Done", role("task", "task"), role("other", "task")));
    });

    it("covers the row that three levels of negation add", async () => {
        // notExists { notExists { exists } }: the new fact makes the innermost
        // `exists` true, which loses the middle solution, which gains the row.
        // The row is gained, so its level's conditions hold, but the middle
        // level lost its solution and its `notExists` is false on the new graph.
        const specification: Specification = {
            given: [{ label: { name: "p1", type: "Root" }, conditions: [] }],
            matches: [
                match("a", "A", [
                    path("root", "Root", "p1"),
                    notExists([
                        match("b", "B", [
                            path("a", "A", "a"),
                            notExists([
                                match("c", "C", [
                                    path("b", "B", "b"),
                                    exists([match("d", "D", [path("c", "C", "c")])])
                                ])
                            ])
                        ])
                    ])
                ])
            ],
            projection: { type: "fact", label: "a" }
        };
        const graph = [
            node("root", "Root"),
            node("a", "A", role("root", "root")),
            node("b", "B", role("a", "a")),
            node("c", "C", role("b", "b"))
        ];

        await expectCandidatesCoverTheChange(specification, graph, ["root"],
            node("d", "D", role("c", "c")));
    });

    it("covers the row of a specification that reuses a label after an existential condition", async () => {
        // Issue #343. `x` names a `Done` inside the condition and a `Note`
        // after it. Today's inverse concatenates outer and inner matches and
        // looks labels up by name, so the inner `x` captures the lookup.
        const specification: Specification = {
            given: [{ label: { name: "r", type: "Root" }, conditions: [] }],
            matches: [
                match("t", "Task", [
                    path("root", "Root", "r"),
                    notExists([match("x", "Done", [path("task", "Task", "t")])])
                ]),
                match("x", "Note", [path("root", "Root", "r")])
            ],
            projection: {
                type: "composite",
                components: [
                    { type: "fact", name: "t", label: "t" },
                    { type: "fact", name: "x", label: "x" }
                ]
            }
        };
        const graph = [
            node("root", "Root"),
            node("task", "Task", role("root", "root")),
            node("note", "Note", role("root", "root"))
        ];

        await expectCandidatesCoverTheChange(specification, graph, ["root"],
            node("done", "Done", role("task", "task")));
    });

    it("covers the message a read removes from this user's unread messages", async () => {
        // Issue #141. The `notExists` is correlated on two predecessors, one of
        // them a given, so today's inverse must reach a given through an
        // existential condition and `shakeTree` refuses the specification. An
        // inverse that is handed the subscription's givens never has to.
        const specification: Specification = {
            given: [
                { label: { name: "p1", type: "User" }, conditions: [] },
                { label: { name: "p2", type: "Channel" }, conditions: [] }
            ],
            matches: [
                match("m", "Message", [
                    path("channel", "Channel", "p2"),
                    notExists([
                        match("rd", "Read", [
                            path("message", "Message", "m"),
                            path("user", "User", "p1")
                        ])
                    ])
                ])
            ],
            projection: { type: "fact", label: "m" }
        };
        const graph = [
            node("user", "User"),
            node("channel", "Channel"),
            node("message", "Message", role("channel", "channel"))
        ];

        await expectCandidatesCoverTheChange(specification, graph, ["user", "channel"],
            node("read", "Read", role("message", "message"), role("user", "user")));
    });

    it("covers the row that a condition on a given loses", async () => {
        // The proof's language has no conditions on a given, so
        // `candidateInverses` moves them onto a match of their own before it
        // builds the inverses. A fact that falsifies the condition empties the
        // result, and every row it held is a candidate.
        const specification: Specification = {
            given: [{
                label: { name: "p1", type: "Root" },
                conditions: [notExists([match("ar", "Archived", [path("root", "Root", "p1")])])]
            }],
            matches: [
                match("t", "Task", [path("root", "Root", "p1")])
            ],
            projection: { type: "fact", label: "t" }
        };
        const graph = [
            node("root", "Root"),
            node("task", "Task", role("root", "root"))
        ];

        await expectCandidatesCoverTheChange(specification, graph, ["root"],
            node("archived", "Archived", role("root", "root")));
    });

    describe("reduceGivenConditions", () => {
        // Issue #371. The proof's language has no conditions on a given, so
        // `candidateInverses` reduces them away first. jinaga-spec now proves
        // that reduction (`read_reduceGivenConditions`, `stream_correct_given`,
        // jinaga/jinaga-spec#16), and the proven shape is one match carrying
        // every given's conditions, bound to the first given that has one, under
        // the first of `given`, `given2`, ... the specification does not already
        // name. An ordinary label matters: the proofs reserve `__` for the
        // split's own labels, so a reduction that emitted `__g0` produced a
        // specification the theorem does not cover. Shapes 1 and 2 are
        // jinaga-spec's two given-condition vectors, whose `expected.reduced`
        // these are.

        it("puts the only given's condition onto a match labelled given", () => {
            const specification: Specification = {
                given: [{
                    label: { name: "p1", type: "Root" },
                    conditions: [notExists([match("ar", "Archived", [path("root", "Root", "p1")])])]
                }],
                matches: [match("t", "Task", [path("root", "Root", "p1")])],
                projection: { type: "fact", label: "t" }
            };

            expect(reducedDescription(specification)).toEqual(
`(p1: Root) {
    given: Root [
        given = p1
        !E {
            ar: Archived [
                ar->root: Root = p1
            ]
        }
    ]
    t: Task [
        t->root: Root = p1
    ]
} => t
`);
        });

        it("puts an exists condition on the first of two givens onto one match", () => {
            const specification: Specification = {
                given: [
                    {
                        label: { name: "p1", type: "Root" },
                        conditions: [exists([match("op", "Opened", [path("root", "Root", "p1")])])]
                    },
                    { label: { name: "p2", type: "Channel" }, conditions: [] }
                ],
                matches: [match("t", "Task", [path("channel", "Channel", "p2")])],
                projection: { type: "fact", label: "t" }
            };

            expect(reducedDescription(specification)).toEqual(
`(p1: Root, p2: Channel) {
    given: Root [
        given = p1
        E {
            op: Opened [
                op->root: Root = p1
            ]
        }
    ]
    t: Task [
        t->channel: Channel = p2
    ]
} => t
`);
        });

        it("labels the match given2 when the specification already names given", () => {
            const specification: Specification = {
                given: [{
                    label: { name: "given", type: "Root" },
                    conditions: [notExists([match("ar", "Archived", [path("root", "Root", "given")])])]
                }],
                matches: [match("t", "Task", [path("root", "Root", "given")])],
                projection: { type: "fact", label: "t" }
            };

            expect(reducedDescription(specification)).toEqual(
`(given: Root) {
    given2: Root [
        given2 = given
        !E {
            ar: Archived [
                ar->root: Root = given
            ]
        }
    ]
    t: Task [
        t->root: Root = given
    ]
} => t
`);
        });

        it("puts the conditions of two givens onto one match bound to the first", () => {
            const specification: Specification = {
                given: [
                    {
                        label: { name: "p1", type: "Root" },
                        conditions: [notExists([match("ar", "Archived", [path("root", "Root", "p1")])])]
                    },
                    {
                        label: { name: "p2", type: "User" },
                        conditions: [exists([match("ac", "Active", [path("user", "User", "p2")])])]
                    }
                ],
                matches: [match("t", "Task", [path("root", "Root", "p1")])],
                projection: { type: "fact", label: "t" }
            };

            expect(reducedDescription(specification)).toEqual(
`(p1: Root, p2: User) {
    given: Root [
        given = p1
        !E {
            ar: Archived [
                ar->root: Root = p1
            ]
        }
        E {
            ac: Active [
                ac->user: User = p2
            ]
        }
    ]
    t: Task [
        t->root: Root = p1
    ]
} => t
`);
        });

        it("binds the match to the first given that has a condition, not to the first given", () => {
            const specification: Specification = {
                given: [
                    { label: { name: "p1", type: "User" }, conditions: [] },
                    {
                        label: { name: "p2", type: "Message" },
                        conditions: [notExists([match("r", "Read", [
                            path("message", "Message", "p2"),
                            path("user", "User", "p1")
                        ])])]
                    }
                ],
                matches: [match("t", "Reply", [path("message", "Message", "p2")])],
                projection: { type: "fact", label: "t" }
            };

            expect(reducedDescription(specification)).toEqual(
`(p1: User, p2: Message) {
    given: Message [
        given = p2
        !E {
            r: Read [
                r->message: Message = p2
                r->user: User = p1
            ]
        }
    ]
    t: Reply [
        t->message: Message = p2
    ]
} => t
`);
        });

        it("labels the match given2 when a nested specification projection names given", () => {
            // Nested specification projections are outside jinaga-spec's model.
            // Avoiding their labels too can only skip a name, never choose one
            // the vectors reject, and it keeps the per-collection specifications
            // `observer.ts` flattens clear of a child collection's unknowns.
            const specification: Specification = {
                given: [{
                    label: { name: "p1", type: "Root" },
                    conditions: [notExists([match("ar", "Archived", [path("root", "Root", "p1")])])]
                }],
                matches: [match("t", "Task", [path("root", "Root", "p1")])],
                projection: {
                    type: "composite",
                    components: [{
                        type: "specification",
                        name: "subs",
                        matches: [match("given", "Sub", [path("task", "Task", "t")])],
                        projection: { type: "fact", label: "given" }
                    }]
                }
            };

            expect(reducedDescription(specification)).toEqual(
`(p1: Root) {
    given2: Root [
        given2 = p1
        !E {
            ar: Archived [
                ar->root: Root = p1
            ]
        }
    ]
    t: Task [
        t->root: Root = p1
    ]
} => {
    subs = {
        given: Sub [
            given->task: Task = t
        ]
    } => given
}
`);
        });

        it("carries a condition nested three levels deep onto the match unchanged", () => {
            const specification: Specification = {
                given: [{
                    label: { name: "p1", type: "Root" },
                    conditions: [notExists([match("ar", "Archived", [
                        path("root", "Root", "p1"),
                        exists([match("ap", "Approval", [
                            path("archived", "Archived", "ar"),
                            notExists([match("rv", "Revoke", [path("approval", "Approval", "ap")])])
                        ])])
                    ])])]
                }],
                matches: [match("t", "Task", [path("root", "Root", "p1")])],
                projection: { type: "fact", label: "t" }
            };

            expect(reducedDescription(specification)).toEqual(
`(p1: Root) {
    given: Root [
        given = p1
        !E {
            ar: Archived [
                ar->root: Root = p1
                E {
                    ap: Approval [
                        ap->archived: Archived = ar
                        !E {
                            rv: Revoke [
                                rv->approval: Approval = ap
                            ]
                        }
                    ]
                }
            ]
        }
    ]
    t: Task [
        t->root: Root = p1
    ]
} => t
`);
        });

        it("carries a condition that names a second given onto the match unchanged", () => {
            const specification: Specification = {
                given: [
                    {
                        label: { name: "p1", type: "Message" },
                        conditions: [notExists([match("r", "Read", [
                            path("message", "Message", "p1"),
                            path("user", "User", "p2"),
                            notExists([match("ur", "Unread", [path("read", "Read", "r")])])
                        ])])]
                    },
                    { label: { name: "p2", type: "User" }, conditions: [] }
                ],
                matches: [match("t", "Reply", [path("message", "Message", "p1")])],
                projection: { type: "fact", label: "t" }
            };

            expect(reducedDescription(specification)).toEqual(
`(p1: Message, p2: User) {
    given: Message [
        given = p1
        !E {
            r: Read [
                r->message: Message = p1
                r->user: User = p2
                !E {
                    ur: Unread [
                        ur->read: Read = r
                    ]
                }
            ]
        }
    ]
    t: Reply [
        t->message: Message = p1
    ]
} => t
`);
        });

        it("returns a specification with no conditions on its givens unchanged", () => {
            // The same object, so every inverse of such a specification is built
            // from exactly what the caller passed.
            const specification: Specification = {
                given: [{ label: { name: "p1", type: "Root" }, conditions: [] }],
                matches: [match("t", "Task", [path("root", "Root", "p1")])],
                projection: { type: "fact", label: "t" }
            };

            expect(reduceGivenConditions(specification)).toBe(specification);
        });
    });

    describe("candidates for a condition on a given", () => {
        // What the shape tests cannot show: that the candidates of the reduced
        // specification's inverses still cover every change, whatever shape the
        // reduction takes. Folded in from #360, these are the shapes the
        // restructure could break — a negation inside a negation, an `exists`
        // that holds one, conditions on two givens, a condition three levels
        // deep, and a condition correlated on another given — each driven in both
        // directions where a fact can drive it both ways.

        const notExistsInNotExists: Specification = {
            given: [{
                label: { name: "p1", type: "Root" },
                conditions: [notExists([match("ar", "Archived", [
                    path("root", "Root", "p1"),
                    notExists([match("rs", "Restore", [path("archived", "Archived", "ar")])])
                ])])]
            }],
            matches: [match("t", "Task", [path("root", "Root", "p1")])],
            projection: { type: "fact", label: "t" }
        };

        it("covers the row an archived fact loses under a notExists holding a notExists", async () => {
            const graph = [
                node("root", "Root"),
                node("task", "Task", role("root", "root"))
            ];

            await expectCandidatesCoverTheChange(notExistsInNotExists, graph, ["root"],
                node("archived", "Archived", role("root", "root")));
        });

        it("covers the row a restore fact gains by making the condition true again", async () => {
            const graph = [
                node("root", "Root"),
                node("task", "Task", role("root", "root")),
                node("archived", "Archived", role("root", "root"))
            ];

            await expectCandidatesCoverTheChange(notExistsInNotExists, graph, ["root"],
                node("restore", "Restore", role("archived", "archived")));
        });

        const notExistsInExists: Specification = {
            given: [{
                label: { name: "p1", type: "Root" },
                conditions: [exists([match("op", "Opened", [
                    path("root", "Root", "p1"),
                    notExists([match("cl", "Closed", [path("opened", "Opened", "op")])])
                ])])]
            }],
            matches: [match("t", "Task", [path("root", "Root", "p1")])],
            projection: { type: "fact", label: "t" }
        };

        it("covers the row an opened fact gains under an exists holding a notExists", async () => {
            const graph = [
                node("root", "Root"),
                node("task", "Task", role("root", "root"))
            ];

            await expectCandidatesCoverTheChange(notExistsInExists, graph, ["root"],
                node("opened", "Opened", role("root", "root")));
        });

        it("covers the row a closed fact loses by emptying the exists", async () => {
            const graph = [
                node("root", "Root"),
                node("task", "Task", role("root", "root")),
                node("opened", "Opened", role("root", "root"))
            ];

            await expectCandidatesCoverTheChange(notExistsInExists, graph, ["root"],
                node("closed", "Closed", role("opened", "opened")));
        });

        const conditionsOnTwoGivens: Specification = {
            given: [
                {
                    label: { name: "p1", type: "Root" },
                    conditions: [notExists([match("ar", "Archived", [path("root", "Root", "p1")])])]
                },
                {
                    label: { name: "p2", type: "User" },
                    conditions: [exists([match("ac", "Active", [path("user", "User", "p2")])])]
                }
            ],
            matches: [match("t", "Task", [path("root", "Root", "p1")])],
            projection: { type: "fact", label: "t" }
        };

        it("covers the row the second given's exists gains, with both conditions on one match", async () => {
            const graph = [
                node("root", "Root"),
                node("user", "User"),
                node("task", "Task", role("root", "root"))
            ];

            await expectCandidatesCoverTheChange(conditionsOnTwoGivens, graph, ["root", "user"],
                node("active", "Active", role("user", "user")));
        });

        it("covers the row the first given's notExists loses, with both conditions on one match", async () => {
            const graph = [
                node("root", "Root"),
                node("user", "User"),
                node("task", "Task", role("root", "root")),
                node("active", "Active", role("user", "user"))
            ];

            await expectCandidatesCoverTheChange(conditionsOnTwoGivens, graph, ["root", "user"],
                node("archived", "Archived", role("root", "root")));
        });

        const conditionThreeDeep: Specification = {
            given: [{
                label: { name: "p1", type: "Root" },
                conditions: [notExists([match("ar", "Archived", [
                    path("root", "Root", "p1"),
                    exists([match("ap", "Approval", [
                        path("archived", "Archived", "ar"),
                        notExists([match("rv", "Revoke", [path("approval", "Approval", "ap")])])
                    ])])
                ])])]
            }],
            matches: [match("t", "Task", [path("root", "Root", "p1")])],
            projection: { type: "fact", label: "t" }
        };

        it("covers the row an approval loses three levels inside the given's condition", async () => {
            const graph = [
                node("root", "Root"),
                node("task", "Task", role("root", "root")),
                node("archived", "Archived", role("root", "root"))
            ];

            await expectCandidatesCoverTheChange(conditionThreeDeep, graph, ["root"],
                node("approval", "Approval", role("archived", "archived")));
        });

        it("covers the row a revoke gains three levels inside the given's condition", async () => {
            const graph = [
                node("root", "Root"),
                node("task", "Task", role("root", "root")),
                node("archived", "Archived", role("root", "root")),
                node("approval", "Approval", role("archived", "archived"))
            ];

            await expectCandidatesCoverTheChange(conditionThreeDeep, graph, ["root"],
                node("revoke", "Revoke", role("approval", "approval")));
        });

        const conditionNamingASecondGiven: Specification = {
            given: [
                {
                    label: { name: "p1", type: "Message" },
                    conditions: [notExists([match("r", "Read", [
                        path("message", "Message", "p1"),
                        path("user", "User", "p2"),
                        notExists([match("ur", "Unread", [path("read", "Read", "r")])])
                    ])])]
                },
                { label: { name: "p2", type: "User" }, conditions: [] }
            ],
            matches: [match("t", "Reply", [path("message", "Message", "p1")])],
            projection: { type: "fact", label: "t" }
        };

        it("covers the row a read loses through a condition correlated on a second given", async () => {
            const graph = [
                node("message", "Message"),
                node("user", "User"),
                node("reply", "Reply", role("message", "message"))
            ];

            await expectCandidatesCoverTheChange(conditionNamingASecondGiven, graph, ["message", "user"],
                node("read", "Read", role("message", "message"), role("user", "user")));
        });

        it("covers the row an unread gains through a condition correlated on a second given", async () => {
            const graph = [
                node("message", "Message"),
                node("user", "User"),
                node("reply", "Reply", role("message", "message")),
                node("read", "Read", role("message", "message"), role("user", "user"))
            ];

            await expectCandidatesCoverTheChange(conditionNamingASecondGiven, graph, ["message", "user"],
                node("unread", "Unread", role("read", "read")));
        });

        it("covers the row lost through a condition on the second given naming the first", async () => {
            // The new match is bound to `p2`, the first given that has a
            // condition, while the condition itself still reads `p1`.
            const specification: Specification = {
                given: [
                    { label: { name: "p1", type: "User" }, conditions: [] },
                    {
                        label: { name: "p2", type: "Message" },
                        conditions: [notExists([match("r", "Read", [
                            path("message", "Message", "p2"),
                            path("user", "User", "p1")
                        ])])]
                    }
                ],
                matches: [match("t", "Reply", [path("message", "Message", "p2")])],
                projection: { type: "fact", label: "t" }
            };
            const graph = [
                node("user", "User"),
                node("message", "Message"),
                node("reply", "Reply", role("message", "message"))
            ];

            await expectCandidatesCoverTheChange(specification, graph, ["user", "message"],
                node("read", "Read", role("message", "message"), role("user", "user")));
        });
    });
});
