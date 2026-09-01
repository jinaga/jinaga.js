import { Jinaga, JinagaTest, SpecificationChange, User, buildModel } from "@src";

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

function collector() {
    const added: SpecificationChange[] = [];
    const removed: SpecificationChange[] = [];
    return {
        added,
        removed,
        handlers: {
            onAdded: async (changes: SpecificationChange[]) => { added.push(...changes); },
            onRemoved: async (changes: SpecificationChange[]) => { removed.push(...changes); }
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
        const c = collector();
        const subscription = j.observeChanges(allTasks, project, c.handlers);

        const task = await j.fact(new Task(project, "write it down"));

        expect(c.added).toHaveLength(1);
        expect(c.removed).toHaveLength(0);
        const row = c.added[0].row;
        expect(Object.values(row).some(r => r.hash === Jinaga.hash(task))).toBe(true);
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
        const removed: SpecificationChange[] = [];
        const subscription = j.observeChanges(outstandingTasks, project, {
            onRemoved: async changes => { removed.push(...changes); }
        });

        const task = await j.fact(new Task(project, "outstanding"));
        expect(removed).toHaveLength(0);

        await j.fact(new TaskCompleted(task));
        expect(removed).toHaveLength(1);

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
