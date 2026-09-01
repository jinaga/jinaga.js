import { Jinaga, JinagaTest, NoOpTracer, SpecificationRow, Trace, Tracer, User, buildModel } from "@src";

// Issue #250: a durable consumer needs to learn that a specification's result
// set changed without taking on the projection tree, nested onAdded closures,
// pendingAddsByKey buffering, or processed(). These tests pin the seam's
// contract: which rows arrive, which do not, and what identifies them.
//
// No timeouts anywhere. ObservableSource.notify awaits every listener to a
// CONCLUSION before save() resolves, and a conclusion is not the same as
// completion: a listener that exceeds listenerTimeoutMs is abandoned (#246,
// #249). So `await j.fact(...)` is a reliable synchronization point here
// because these handlers only push onto an array, not as a general guarantee.
// A test whose handler could take real time would need to await it directly.

class Project {
    static Type = "Test.Project" as const;
    type = Project.Type;
    constructor(public creator: User, public identifier: string) { }
}

class Task {
    static Type = "Test.Task" as const;
    type = Task.Type;
    constructor(public project: Project, public description: string) { }
}

class TaskCompleted {
    static Type = "Test.TaskCompleted" as const;
    type = TaskCompleted.Type;
    constructor(public task: Task) { }
}

class TaskNote {
    static Type = "Test.TaskNote" as const;
    type = TaskNote.Type;
    constructor(public task: Task, public text: string) { }
}

const model = buildModel(b => b
    .type(User)
    .type(Project, x => x
        .predecessor("creator", User)
    )
    .type(Task, x => x
        .predecessor("project", Project)
    )
    .type(TaskCompleted, x => x
        .predecessor("task", Task)
    )
    .type(TaskNote, x => x
        .predecessor("task", Task)
    )
);

// The shape the issue names: outstanding work, expressed as notExists(Completion).
const outstandingTasks = model.given(Project).match(project =>
    project.successors(Task, task => task.project)
        .notExists(task => task.successors(TaskCompleted, completed => completed.task))
);

const allTasks = model.given(Project).match(project =>
    project.successors(Task, task => task.project)
);

// A projection carrying a nested collection, to prove nested rows stay out.
const tasksWithNotes = model.given(Project).match(project =>
    project.successors(Task, task => task.project)
        .select(task => ({
            task: task,
            notes: task.successors(TaskNote, note => note.task)
                .select(note => note.text)
        }))
);

// What a durable consumer actually writes: outstanding work, projected into
// the shape its handler needs, including a hash it asked for.
const outstandingProjected = model.given(Project).match(project =>
    project.successors(Task, task => task.project)
        .notExists(task => task.successors(TaskCompleted, completed => completed.task))
        .select(task => ({
            hash: Jinaga.hash(task),
            description: task.description,
            task: task
        }))
);

// A nested collection that is already populated when the notification fires,
// so the payload's extraction is observable rather than an empty array.
const tasksWithSiblings = model.given(Project).match(project =>
    project.successors(Task, task => task.project)
        .select(task => ({
            description: task.description,
            all: project.successors(Task, sibling => sibling.project)
                .select(sibling => sibling.description)
        }))
);

function collector<U = any>() {
    const added: SpecificationRow<U>[] = [];
    const removed: SpecificationRow<U>[] = [];
    return {
        added,
        removed,
        handlers: {
            onAdded: async (rows: SpecificationRow<U>[]) => { added.push(...rows); },
            onRemoved: async (rows: SpecificationRow<U>[]) => { removed.push(...rows); }
        }
    };
}

describe("observeChanges", () => {
    let j: Jinaga;
    let project: Project;

    beforeEach(async () => {
        j = JinagaTest.create({ model });
        const creator = await j.fact(new User("--- CREATOR ---"));
        project = await j.fact(new Project(creator, "one"));
    });

    it("delivers a row that enters the set", async () => {
        const c = collector<Task>();
        const subscription = j.observeChanges(allTasks, project, c.handlers);

        const task = await j.fact(new Task(project, "write it down"));

        expect(c.added).toHaveLength(1);
        expect(c.removed).toHaveLength(0);
        // The payload carries the specification's projection, hydrated: a
        // consumer acts on the fact without a second load.
        expect(Jinaga.hash(c.added[0].result)).toEqual(Jinaga.hash(task));
        expect(c.added[0].result.description).toEqual("write it down");
        expect(typeof c.added[0].rowHash).toBe("string");
        expect(c.added[0].rowHash.length).toBeGreaterThan(0);

        subscription.stop();
    });

    it("delivers changes only, not the rows that already match", async () => {
        // A task saved BEFORE the observation starts is already in the set.
        await j.fact(new Task(project, "already here"));

        const c = collector();
        const subscription = j.observeChanges(allTasks, project, c.handlers);

        expect(c.added).toHaveLength(0);

        // A later one still arrives, so the seam is live rather than inert.
        await j.fact(new Task(project, "arrived later"));
        expect(c.added).toHaveLength(1);

        subscription.stop();
    });

    it("delivers a removal when the completion fact retracts the row", async () => {
        const c = collector();
        const subscription = j.observeChanges(outstandingTasks, project, c.handlers);

        const task = await j.fact(new Task(project, "outstanding"));
        expect(c.added).toHaveLength(1);
        expect(c.removed).toHaveLength(0);

        await j.fact(new TaskCompleted(task));

        expect(c.removed).toHaveLength(1);
        subscription.stop();
    });

    it("gives the add and the remove of one row the same rowHash", async () => {
        // This is the pairing guarantee a durable consumer acknowledges on.
        // The remove inverse's tuple carries the completion fact, which the add
        // tuple has no label for, so only restricting both sides to the row
        // identity labels makes the two hashes agree.
        const c = collector();
        const subscription = j.observeChanges(outstandingTasks, project, c.handlers);

        const task = await j.fact(new Task(project, "outstanding"));
        await j.fact(new TaskCompleted(task));

        expect(c.added).toHaveLength(1);
        expect(c.removed).toHaveLength(1);
        expect(c.removed[0].rowHash).toEqual(c.added[0].rowHash);

        subscription.stop();
    });

    it("gives different rows different rowHashes", async () => {
        const c = collector();
        const subscription = j.observeChanges(allTasks, project, c.handlers);

        await j.fact(new Task(project, "first"));
        await j.fact(new Task(project, "second"));

        expect(c.added).toHaveLength(2);
        expect(c.added[0].rowHash).not.toEqual(c.added[1].rowHash);

        subscription.stop();
    });

    it("does not deliver rows belonging to a different given", async () => {
        const creator = await j.fact(new User("--- CREATOR ---"));
        const other = await j.fact(new Project(creator, "two"));

        const c = collector();
        const subscription = j.observeChanges(allTasks, project, c.handlers);

        await j.fact(new Task(other, "not mine"));
        expect(c.added).toHaveLength(0);

        await j.fact(new Task(project, "mine"));
        expect(c.added).toHaveLength(1);

        subscription.stop();
    });

    it("does not deliver a row when a nested projection changes", async () => {
        // A note entering a task's nested collection is not a task entering the
        // set. Registering non-root inverses would deliver a row here.
        const c = collector();
        const subscription = j.observeChanges(tasksWithNotes, project, c.handlers);

        const task = await j.fact(new Task(project, "has notes"));
        expect(c.added).toHaveLength(1);

        await j.fact(new TaskNote(task, "a note"));

        expect(c.added).toHaveLength(1);
        expect(c.removed).toHaveLength(0);

        subscription.stop();
    });

    it("stops delivering after stop()", async () => {
        const c = collector();
        const subscription = j.observeChanges(allTasks, project, c.handlers);

        await j.fact(new Task(project, "before stop"));
        expect(c.added).toHaveLength(1);

        subscription.stop();

        await j.fact(new Task(project, "after stop"));
        expect(c.added).toHaveLength(1);
    });

    it("tolerates stop() called twice", async () => {
        const c = collector();
        const subscription = j.observeChanges(allTasks, project, c.handlers);
        subscription.stop();
        expect(() => subscription.stop()).not.toThrow();
    });

    it("delivers to onRemoved alone when onAdded is omitted", async () => {
        const removed: SpecificationRow<Task>[] = [];
        const subscription = j.observeChanges(outstandingTasks, project, {
            onRemoved: async rows => { removed.push(...rows); }
        });

        const task = await j.fact(new Task(project, "outstanding"));
        expect(removed).toHaveLength(0);

        await j.fact(new TaskCompleted(task));
        expect(removed).toHaveLength(1);

        subscription.stop();
    });

    it("delivers the same projection on the add and on the remove", async () => {
        // The row's facts are still there when it leaves the set; only the
        // notExists condition changed. A consumer that acts on a removal sees
        // the same value it saw on the add, without a second load.
        const c = collector<Task>();
        const subscription = j.observeChanges(outstandingTasks, project, c.handlers);

        const task = await j.fact(new Task(project, "outstanding"));
        await j.fact(new TaskCompleted(task));

        expect(c.added).toHaveLength(1);
        expect(c.removed).toHaveLength(1);
        expect(c.removed[0].result).toEqual(c.added[0].result);
        expect(Jinaga.hash(c.removed[0].result)).toEqual(Jinaga.hash(task));

        subscription.stop();
    });

    it("delivers a projected shape, including a hash the specification asks for", async () => {
        const c = collector<{ hash: string, description: string, task: Task }>();
        const subscription = j.observeChanges(outstandingProjected, project, c.handlers);

        const task = await j.fact(new Task(project, "projected"));

        expect(c.added).toHaveLength(1);
        expect(c.added[0].result.hash).toEqual(Jinaga.hash(task));
        expect(c.added[0].result.description).toEqual("projected");
        expect(Jinaga.hash(c.added[0].result.task)).toEqual(Jinaga.hash(task));

        subscription.stop();
    });

    it("extracts a nested collection the way query does", async () => {
        // Nested specification components arrive from the store as internal
        // projected results. Delivering them raw would leak that shape into
        // the payload and disagree with query over the same specification.
        await j.fact(new Task(project, "first"));

        const c = collector<{ description: string, all: string[] }>();
        const subscription = j.observeChanges(tasksWithSiblings, project, c.handlers);

        await j.fact(new Task(project, "second"));

        expect(c.added).toHaveLength(1);
        expect(c.added[0].result.description).toEqual("second");
        expect(c.added[0].result.all.slice().sort()).toEqual(["first", "second"]);

        const queried = await j.query(tasksWithSiblings, project);
        const secondFromQuery = queried.find(r => r.description === "second");
        expect(c.added[0].result).toEqual(secondFromQuery);

        subscription.stop();
    });

    it("rejects a specification with more than one given", () => {
        const twoGivens = model.given(User, Project).match((user, project) =>
            project.successors(Task, task => task.project)
                .selectMany(task => user.predecessor().select(u => ({ task, u })))
        );

        expect(() => j.observeChanges(
            // The single-given restriction is also a compile-time error, so this
            // cast is what a JavaScript caller would reach the runtime check by.
            twoGivens as any,
            project,
            { onAdded: async () => { } }
        )).toThrow(/exactly one given fact/);
    });

    it("rejects handlers with neither callback", () => {
        expect(() => j.observeChanges(allTasks, project, {}))
            .toThrow(/at least one of onAdded or onRemoved/);
    });

    it("rejects a null given", () => {
        expect(() => j.observeChanges(allTasks, null as any, { onAdded: async () => { } }))
            .toThrow(/No given fact provided/);
    });
});

describe("queryRows", () => {
    let j: Jinaga;
    let project: Project;

    beforeEach(async () => {
        j = JinagaTest.create({ model });
        const creator = await j.fact(new User("--- CREATOR ---"));
        project = await j.fact(new Project(creator, "one"));
    });

    it("returns the rows that already match, which observeChanges does not", async () => {
        const task = await j.fact(new Task(project, "already here"));

        const c = collector<Task>();
        const subscription = j.observeChanges(outstandingTasks, project, c.handlers);

        // The seam is silent about a row that predates it.
        expect(c.added).toHaveLength(0);

        const rows = await j.queryRows(outstandingTasks, project);
        expect(rows).toHaveLength(1);
        expect(Jinaga.hash(rows[0].result)).toEqual(Jinaga.hash(task));

        subscription.stop();
    });

    it("gives a row the same rowHash that observeChanges gives it", async () => {
        // This is the whole point of the pair. A consumer registers first and
        // reads second; a row that lands in the gap is discovered twice, and
        // only one key makes that a duplicate rather than double work.
        const c = collector<Task>();
        const subscription = j.observeChanges(outstandingTasks, project, c.handlers);

        await j.fact(new Task(project, "in the gap"));
        const rows = await j.queryRows(outstandingTasks, project);

        expect(c.added).toHaveLength(1);
        expect(rows).toHaveLength(1);
        expect(rows[0].rowHash).toEqual(c.added[0].rowHash);

        // And the same key still identifies the row when it leaves the set.
        await j.fact(new TaskCompleted(rows[0].result));
        expect(c.removed).toHaveLength(1);
        expect(c.removed[0].rowHash).toEqual(rows[0].rowHash);
        expect(await j.queryRows(outstandingTasks, project)).toHaveLength(0);

        subscription.stop();
    });

    it("returns the same results as query, nested collections included", async () => {
        const task = await j.fact(new Task(project, "has notes"));
        await j.fact(new TaskNote(task, "a note"));

        const rows = await j.queryRows(tasksWithNotes, project);
        const results = await j.query(tasksWithNotes, project);

        expect(rows.map(r => r.result)).toEqual(results);
        expect(rows[0].result.notes).toEqual(["a note"]);
    });

    it("gives different rows different rowHashes", async () => {
        await j.fact(new Task(project, "first"));
        await j.fact(new Task(project, "second"));

        const rows = await j.queryRows(allTasks, project);

        expect(rows).toHaveLength(2);
        expect(rows[0].rowHash).not.toEqual(rows[1].rowHash);
    });

    it("counts loaded facts the way query does", async () => {
        // The counter is over facts, not rows, so a nested collection has to
        // count. Reporting rows.length here would make one read look smaller
        // through queryRows than through query.
        const task = await j.fact(new Task(project, "has notes"));
        await j.fact(new TaskNote(task, "one"));
        await j.fact(new TaskNote(task, "two"));

        const counted: number[] = [];
        Trace.configure(new class extends NoOpTracer implements Tracer {
            counter(name: string, value: number): void {
                if (name === "facts_loaded") {
                    counted.push(value);
                }
            }
        }());
        try {
            await j.query(tasksWithNotes, project);
            await j.queryRows(tasksWithNotes, project);
        }
        finally {
            Trace.configure(new NoOpTracer());
        }

        expect(counted).toHaveLength(2);
        expect(counted[1]).toEqual(counted[0]);
        // One task row plus its two notes.
        expect(counted[0]).toEqual(3);
    });

    it("rejects a specification with more than one given", async () => {
        const twoGivens = model.given(User, Project).match((user, project) =>
            project.successors(Task, task => task.project)
                .selectMany(task => user.predecessor().select(u => ({ task, u })))
        );

        await expect(j.queryRows(twoGivens as any, project))
            .rejects.toThrow(/exactly one given fact/);
    });

    it("returns nothing for a null given", async () => {
        expect(await j.queryRows(allTasks, null as any)).toEqual([]);
    });
});

describe("the worker recipe", () => {
    // The shape issue #251 prescribes, end to end: register the seam, read the
    // outstanding set, process each row once, and record completion as a fact.
    it("processes the backlog and the new arrivals exactly once", async () => {
        const j = JinagaTest.create({ model });
        const creator = await j.fact(new User("--- CREATOR ---"));
        const project = await j.fact(new Project(creator, "one"));

        // Work that predates the worker.
        await j.fact(new Task(project, "backlog one"));
        await j.fact(new Task(project, "backlog two"));

        const queue: SpecificationRow<Task>[] = [];
        const cancelled = new Set<string>();
        const handled: string[] = [];

        // 1. Listen first. The callback only enqueues: the work happens on the
        //    worker's own turn, never inside the notification.
        const subscription = j.observeChanges(outstandingTasks, project, {
            onAdded: async rows => { queue.push(...rows); },
            onRemoved: async rows => { for (const row of rows) cancelled.add(row.rowHash); }
        });

        // 2. Read the current set second. Everything that already matched is
        //    here; anything that arrives from now on is notified.
        queue.push(...await j.queryRows(outstandingTasks, project));

        // A row that lands while the worker is starting up is discovered by
        // both paths, and the row hash is what makes that harmless.
        await j.fact(new Task(project, "arrived during startup"));
        queue.push(...await j.queryRows(outstandingTasks, project));

        const drain = async () => {
            const seen = new Set<string>();
            while (queue.length > 0) {
                const row = queue.shift()!;
                if (seen.has(row.rowHash) || cancelled.has(row.rowHash)) {
                    continue;
                }
                seen.add(row.rowHash);
                handled.push(row.result.description);
                // The completion fact is the record of processing, and writing
                // it is what takes the row out of the set.
                await j.fact(new TaskCompleted(row.result));
            }
        };
        await drain();

        expect(handled.slice().sort()).toEqual([
            "arrived during startup",
            "backlog one",
            "backlog two"
        ]);
        expect(await j.queryRows(outstandingTasks, project)).toHaveLength(0);

        // 3. Steady state: a later arrival is discovered by notification alone.
        await j.fact(new Task(project, "steady state"));
        await drain();

        expect(handled).toContain("steady state");
        expect(await j.queryRows(outstandingTasks, project)).toHaveLength(0);

        subscription.stop();
    });
});
