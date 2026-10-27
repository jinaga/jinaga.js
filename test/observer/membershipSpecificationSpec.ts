import { Dehydration, FactEnvelope, FactReference, HashMap, MemoryStore, ReferencesByName, Specification } from "@src";
import { membershipStart } from "../../src/observer/recheck";
import { extractResult } from "../../src/specification/results";
import { membershipSpecification } from "../../src/specification/inverse-candidates";
import { SpecificationParser } from "../../src/specification/specification-parser";

// Issue #359: a re-check decides each candidate by reading the candidate's own
// membership rather than the whole result. The reduction follows from
// jinaga-spec's definitions but is not proven there, so these tests are the
// gate: for every shape, and for every fully bound tuple that could be a
// candidate, the membership read and the whole read must decide the same way.
//
// The tuples are enumerated from the facts the store holds, so each case
// exercises the real runner against the real graph. Neither side of the
// comparison is written down in the test: the expectation comes from a read of
// the specification itself.

function parse(text: string): Specification {
    const parser = new SpecificationParser(text);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

const userOne: HashMap = { type: "Jinaga.User", publicKey: "--- ONE ---" };
const userTwo: HashMap = { type: "Jinaga.User", publicKey: "--- TWO ---" };
const company: HashMap = { type: "Equiv.Company", creator: userOne, identifier: "Co" };
const otherCompany: HashMap = { type: "Equiv.Company", creator: userTwo, identifier: "Other" };
const projectA: HashMap = { type: "Equiv.Project", company, name: "A" };
const projectB: HashMap = { type: "Equiv.Project", company, name: "B" };
const projectC: HashMap = { type: "Equiv.Project", company: otherCompany, name: "C" };
const taskOne: HashMap = { type: "Equiv.Task", project: projectA, description: "one" };
const taskTwo: HashMap = { type: "Equiv.Task", project: projectA, description: "two" };
const taskThree: HashMap = { type: "Equiv.Task", project: projectB, description: "three" };
const taskFour: HashMap = { type: "Equiv.Task", project: projectC, description: "four" };
const taskFive: HashMap = { type: "Equiv.Task", project: projectA, description: "five" };
const taskSix: HashMap = { type: "Equiv.Task", project: projectB, description: "six" };
const doneOne: HashMap = { type: "Equiv.Done", task: taskOne };
const doneTwo: HashMap = { type: "Equiv.Done", task: taskTwo };
const doneSix: HashMap = { type: "Equiv.Done", task: taskSix };
const undoneTwo: HashMap = { type: "Equiv.Undone", done: doneTwo };
const assignmentOne: HashMap = { type: "Equiv.Assignment", task: taskOne, user: userOne };
const assignmentTwo: HashMap = { type: "Equiv.Assignment", task: taskTwo, user: userOne };
const assignmentThree: HashMap = { type: "Equiv.Assignment", task: taskThree, user: userTwo };

// Named but never saved, so every shape is also asked about a tuple whose fact
// the graph does not hold. Both reads must answer "not a row" for it.
const unsavedTask: HashMap = { type: "Equiv.Task", project: projectA, description: "unsaved" };

const named: { [name: string]: HashMap } = {
    userOne, userTwo, company, otherCompany, projectA, projectB, projectC,
    taskOne, taskTwo, taskThree, taskFour, taskFive, taskSix,
    doneOne, doneTwo, doneSix, undoneTwo,
    assignmentOne, assignmentTwo, assignmentThree, unsavedTask
};

/** Every fact the enumeration may bind to a label of each type. */
const universe: { [type: string]: string[] } = {
    "Jinaga.User": ["userOne", "userTwo"],
    "Equiv.Company": ["company", "otherCompany"],
    "Equiv.Project": ["projectA", "projectB", "projectC"],
    "Equiv.Task": ["taskOne", "taskTwo", "taskThree", "taskFour", "taskFive", "taskSix", "unsavedTask"],
    "Equiv.Done": ["doneOne", "doneTwo", "doneSix"],
    "Equiv.Assignment": ["assignmentOne", "assignmentTwo", "assignmentThree"]
};

interface Shape {
    name: string;
    text: string;
    /** The labels a membership read pins, which is what a candidate binds. */
    pinned: string[];
    /** Each set of given facts to run the shape with, by fixture name. */
    givens: string[][];
}

const shapes: Shape[] = [
    {
        name: "a path chain of two matches",
        text: `
            (company: Equiv.Company) {
                project: Equiv.Project [
                    project->company: Equiv.Company = company
                ]
                task: Equiv.Task [
                    task->project: Equiv.Project = project
                ]
            } => task`,
        pinned: ["project", "task"],
        givens: [["company"], ["otherCompany"]]
    },
    {
        name: "a path of two roles in one condition",
        text: `
            (company: Equiv.Company) {
                task: Equiv.Task [
                    task->project: Equiv.Project->company: Equiv.Company = company
                ]
            } => task`,
        pinned: ["task"],
        givens: [["company"], ["otherCompany"]]
    },
    {
        name: "a predecessor walk and an identity join",
        text: `
            (task: Equiv.Task) {
                project: Equiv.Project [
                    project = task->project: Equiv.Project
                ]
                same: Equiv.Project [
                    same = project
                ]
            } => same`,
        pinned: ["project", "same"],
        givens: [["taskOne"], ["taskThree"]]
    },
    {
        name: "notExists",
        text: `
            (project: Equiv.Project) {
                task: Equiv.Task [
                    task->project: Equiv.Project = project
                    !E {
                        done: Equiv.Done [
                            done->task: Equiv.Task = task
                        ]
                    }
                ]
            } => task`,
        pinned: ["task"],
        givens: [["projectA"], ["projectB"]]
    },
    {
        name: "exists containing notExists",
        text: `
            (project: Equiv.Project) {
                task: Equiv.Task [
                    task->project: Equiv.Project = project
                    E {
                        done: Equiv.Done [
                            done->task: Equiv.Task = task
                            !E {
                                undone: Equiv.Undone [
                                    undone->done: Equiv.Done = done
                                ]
                            }
                        ]
                    }
                ]
            } => task`,
        pinned: ["task"],
        givens: [["projectA"], ["projectB"]]
    },
    {
        name: "notExists containing notExists containing exists",
        text: `
            (project: Equiv.Project) {
                task: Equiv.Task [
                    task->project: Equiv.Project = project
                    !E {
                        done: Equiv.Done [
                            done->task: Equiv.Task = task
                            !E {
                                undone: Equiv.Undone [
                                    undone->done: Equiv.Done = done
                                    E {
                                        assignment: Equiv.Assignment [
                                            assignment->task: Equiv.Task = undone->done: Equiv.Done->task: Equiv.Task
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            } => task`,
        pinned: ["task"],
        givens: [["projectA"], ["projectB"]]
    },
    {
        name: "two givens",
        text: `
            (company: Equiv.Company, user: Jinaga.User) {
                task: Equiv.Task [
                    task->project: Equiv.Project->company: Equiv.Company = company
                ]
                assignment: Equiv.Assignment [
                    assignment->task: Equiv.Task = task
                    assignment->user: Jinaga.User = user
                ]
            } => assignment`,
        pinned: ["task", "assignment"],
        givens: [["company", "userOne"], ["company", "userTwo"]]
    },
    {
        name: "a nested collection level, flattened",
        text: `
            (company: Equiv.Company) {
                project: Equiv.Project [
                    project->company: Equiv.Company = company
                ]
                task: Equiv.Task [
                    task->project: Equiv.Project = project
                    !E {
                        done: Equiv.Done [
                            done->task: Equiv.Task = task
                        ]
                    }
                ]
            } => task.description`,
        pinned: ["project", "task"],
        givens: [["company"]]
    },
    {
        name: "a projected nested collection",
        text: `
            (company: Equiv.Company) {
                project: Equiv.Project [
                    project->company: Equiv.Company = company
                ]
            } => {
                name = project.name
                openTasks = {
                    task: Equiv.Task [
                        task->project: Equiv.Project = project
                        !E {
                            done: Equiv.Done [
                                done->task: Equiv.Task = task
                            ]
                        }
                    ]
                } => task.description
            }`,
        pinned: ["project"],
        givens: [["company"], ["otherCompany"]]
    },
    {
        name: "two intersected branches: a trailing match left unpinned",
        text: `
            (company: Equiv.Company, distributionUser: Jinaga.User) {
                project: Equiv.Project [
                    project->company: Equiv.Company = company
                ]
                task: Equiv.Task [
                    task->project: Equiv.Project = project
                ]
                dist: Equiv.Assignment [
                    dist->task: Equiv.Task = task
                    dist->user: Jinaga.User = distributionUser
                ]
            } => task`,
        pinned: ["project", "task"],
        givens: [["company", "userOne"], ["company", "userTwo"]]
    },
    {
        name: "two intersected branches: a leading match left unpinned",
        text: `
            (company: Equiv.Company, distributionUser: Jinaga.User) {
                dist: Equiv.Assignment [
                    dist->user: Jinaga.User = distributionUser
                    dist->task: Equiv.Task->project: Equiv.Project->company: Equiv.Company = company
                ]
                task: Equiv.Task [
                    task->project: Equiv.Project->company: Equiv.Company = company
                ]
            } => task`,
        pinned: ["task"],
        givens: [["company", "userOne"], ["company", "userTwo"]]
    }
];

/** Every assignment of a fact of the right type to each pinned label. */
function enumerateTuples(labels: { name: string, type: string }[]): ReferencesByName[] {
    let tuples: ReferencesByName[] = [{}];
    for (const label of labels) {
        const candidates = universe[label.type];
        if (candidates === undefined) {
            throw new Error(`The fixture has no facts of type ${label.type}.`);
        }
        tuples = tuples.flatMap(tuple => candidates.map(name => ({
            ...tuple,
            [label.name]: references[name]
        })));
    }
    return tuples;
}

let store: MemoryStore;
let references: { [name: string]: FactReference };

beforeAll(async () => {
    const dehydration = new Dehydration();
    references = {};
    for (const [name, fact] of Object.entries(named)) {
        references[name] = dehydration.dehydrate(fact);
    }
    // Everything but `unsavedTask`, whose reference the enumeration needs and
    // whose record the store must not hold.
    const unsaved = references["unsavedTask"];
    const envelopes = dehydration.factRecords()
        .filter(fact => fact.type !== unsaved.type || fact.hash !== unsaved.hash)
        .map(fact => <FactEnvelope>({ fact, signatures: [] }));
    store = new MemoryStore();
    await store.save(envelopes);
});

describe("Membership of one fully bound tuple (issue #359)", () => {
    for (const shape of shapes) {
        for (const givenNames of shape.givens) {
            it(`decides every candidate as the whole read does, for ${shape.name} given ${givenNames.join(", ")}`, async () => {
                const specification = parse(shape.text);
                const membership = membershipSpecification(specification, shape.pinned);
                const givenReferences = givenNames.map(name => references[name]);
                const keyLabels = [
                    ...specification.given.map(g => g.label.name),
                    ...shape.pinned
                ];
                const keyOf = (tuple: ReferencesByName) => keyLabels
                    .map(label => {
                        const reference = tuple[label];
                        return reference ? `${reference.type}:${reference.hash}` : "";
                    })
                    .join("|");

                const whole = await store.read(givenReferences, specification);
                const present = new Set(whole.map(result => keyOf(result.tuple)));

                const givenTuple: ReferencesByName = {};
                specification.given.forEach((given, index) => {
                    givenTuple[given.label.name] = givenReferences[index];
                });

                let agreedPresent = 0;
                let agreedAbsent = 0;
                for (const pinnedTuple of enumerateTuples(membership.pinned)) {
                    const start = membershipStart(givenReferences, membership.pinned, pinnedTuple);
                    expect(start).not.toBeNull();
                    const results = await store.read(start!, membership.specification);
                    const expected = present.has(keyOf({ ...givenTuple, ...pinnedTuple }));
                    expect(results.length > 0).toBe(expected);
                    if (expected) {
                        agreedPresent++;
                    }
                    else {
                        agreedAbsent++;
                    }
                }

                // A shape that enumerated only absences would agree vacuously.
                expect(agreedPresent).toBeGreaterThan(0);
                expect(agreedAbsent).toBeGreaterThan(0);
            });
        }
    }

    it("keeps the specification's projection, so a present row carries its result", async () => {
        // The membership read is not only a yes or no: the row it returns is
        // what the delivery path hands the consumer, so its projection has to
        // be the one the specification asked for -- a nested collection
        // included, computed for that row alone.
        const specification = parse(shapes.find(s => s.name === "a projected nested collection")!.text);
        const membership = membershipSpecification(specification, ["project"]);
        const start = membershipStart([references["company"]], membership.pinned, {
            project: references["projectB"]
        });

        const results = await store.read(start!, membership.specification);

        expect(results).toHaveLength(1);
        // What a consumer is handed: the projection, shaped the way a read of
        // the specification itself would shape it.
        expect(extractResult(results[0].result, membership.specification.projection).result)
            .toEqual({ name: "B", openTasks: ["three"] });
    });

    it("answers for a tuple whose fact the graph does not hold", async () => {
        const specification = parse(shapes.find(s => s.name === "a path of two roles in one condition")!.text);
        const membership = membershipSpecification(specification, ["task"]);
        const start = membershipStart([references["company"]], membership.pinned, {
            task: references["unsavedTask"]
        });

        const results = await store.read(start!, membership.specification);

        expect(results).toEqual([]);
    });

    it("refuses a candidate that binds a label to a fact of another type", () => {
        const specification = parse(shapes.find(s => s.name === "a path of two roles in one condition")!.text);
        const membership = membershipSpecification(specification, ["task"]);

        const start = membershipStart([references["company"]], membership.pinned, {
            task: references["projectA"]
        });

        expect(start).toBeNull();
    });

    it("refuses a candidate that does not bind a pinned label", () => {
        const specification = parse(shapes.find(s => s.name === "a path chain of two matches")!.text);
        const membership = membershipSpecification(specification, ["project", "task"]);

        const start = membershipStart([references["company"]], membership.pinned, {
            project: references["projectA"]
        });

        expect(start).toBeNull();
    });
});
