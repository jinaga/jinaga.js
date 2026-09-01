import {
    AuthenticationNoOp, FactEnvelope, FactManager, FactReference, FeedResponse, FeedsResponse,
    Jinaga, JinagaTest, MemoryStore, NoOpTracer, ObservableSource, PassThroughFork, Specification,
    SyncStatusNotifier, Trace, Tracer, User, buildModel
} from "@src";
import { Network } from "@src";

// Issue #250: a durable consumer needs to learn which rows enter and leave a
// specification's result set without taking on the projection tree, nested
// onAdded closures, pendingAddsByKey buffering, or processed(). These tests pin
// the contract: which rows arrive, in what order the machinery starts, and what
// identifies a row.
//
// No timeouts anywhere. Every assertion either pulls the next change, which
// resolves as soon as one is queued, or reads `pending`, which is exact.

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

// Two givens, connected: the outstanding tasks of a project, restricted to
// projects this user created. The stream machinery never required one given;
// only the inverse specifications do, and invertSpecification always builds
// those with exactly one.
const outstandingForCreator = model.given(User, Project).match((user, project, facts) =>
    facts.ofType(Task)
        .join(task => task.project, project)
        .join(task => task.project.creator, user)
        .notExists(task => facts.ofType(TaskCompleted).join(completed => completed.task, task))
);

describe("watchRows", () => {
    let j: Jinaga;
    let project: Project;

    beforeEach(async () => {
        j = JinagaTest.create({ model });
        const creator = await j.fact(new User("--- CREATOR ---"));
        project = await j.fact(new Project(creator, "one"));
    });

    it("installs its listeners before it reads", async () => {
        // The invariant this method exists to own. A consumer that read first
        // would lose every row saved between the read and the registration,
        // silently and only under load. There is no longer a second call to
        // put in the wrong order, and this pins the order inside.
        await j.fact(new Task(project, "anything"));

        const lines: string[] = [];
        Trace.configure(new class extends NoOpTracer implements Tracer {
            info(message: string): void {
                if (message.includes("LISTENER ADDED") || message.includes("READING CURRENT ROWS")) {
                    lines.push(message);
                }
            }
        }());
        let stream;
        try {
            stream = await j.watchRows(outstandingTasks, project);
        }
        finally {
            Trace.configure(new NoOpTracer());
        }

        const registered = lines.findIndex(line => line.includes("LISTENER ADDED"));
        const read = lines.findIndex(line => line.includes("READING CURRENT ROWS"));
        expect(registered).toBeGreaterThanOrEqual(0);
        expect(read).toBeGreaterThanOrEqual(0);
        expect(registered).toBeLessThan(read);

        stream.stop();
    });

    it("delivers the rows that already match", async () => {
        const existing = await j.fact(new Task(project, "already here"));

        const stream = await j.watchRows(outstandingTasks, project);
        const changes = stream[Symbol.asyncIterator]();

        const first = await changes.next();
        expect(first.value.operation).toEqual("added");
        expect(Jinaga.hash(first.value.result)).toEqual(Jinaga.hash(existing));
        expect(stream.pending).toEqual(0);

        stream.stop();
    });

    it("delivers a row saved during startup exactly once", async () => {
        // The window this closes. Listeners are installed before the read, so
        // the row cannot be lost; the read's rows are suppressed against what
        // the window already queued, so it cannot arrive twice.
        await j.fact(new Task(project, "backlog"));

        const starting = j.watchRows(outstandingTasks, project);
        await j.fact(new Task(project, "during startup"));
        const stream = await starting;

        const changes = stream[Symbol.asyncIterator]();
        const descriptions = [
            (await changes.next()).value.result.description,
            (await changes.next()).value.result.description
        ].sort();
        expect(descriptions).toEqual(["backlog", "during startup"]);
        expect(stream.pending).toEqual(0);

        stream.stop();
    });

    it("delivers a row that enters the set", async () => {
        const stream = await j.watchRows(outstandingTasks, project);
        const changes = stream[Symbol.asyncIterator]();

        const task = await j.fact(new Task(project, "write it down"));

        const added = await changes.next();
        expect(added.value.operation).toEqual("added");
        // The payload carries the specification's projection, hydrated: a
        // consumer acts on the fact without a second load.
        expect(Jinaga.hash(added.value.result)).toEqual(Jinaga.hash(task));
        expect(added.value.result.description).toEqual("write it down");
        expect(typeof added.value.rowHash).toBe("string");

        stream.stop();
    });

    it("delivers a removal when the completion fact retracts the row, under the same rowHash", async () => {
        // The pairing guarantee a durable consumer acknowledges on. The remove
        // inverse's tuple carries the completion fact, which the add tuple has
        // no label for, so only restricting both sides to the row identity
        // labels makes the two hashes agree.
        const stream = await j.watchRows(outstandingTasks, project);
        const changes = stream[Symbol.asyncIterator]();

        const task = await j.fact(new Task(project, "outstanding"));
        const added = await changes.next();

        await j.fact(new TaskCompleted(task));
        const removed = await changes.next();

        expect(removed.value.operation).toEqual("removed");
        expect(removed.value.rowHash).toEqual(added.value.rowHash);
        // The row's facts are all still there when a notExists retracts it, so
        // the same projection is delivered and no second load is needed.
        expect(removed.value.result).toEqual(added.value.result);

        stream.stop();
    });

    it("gives different rows different rowHashes", async () => {
        const stream = await j.watchRows(allTasks, project);
        const changes = stream[Symbol.asyncIterator]();

        await j.fact(new Task(project, "first"));
        await j.fact(new Task(project, "second"));

        const first = await changes.next();
        const second = await changes.next();
        expect(first.value.rowHash).not.toEqual(second.value.rowHash);

        stream.stop();
    });

    it("does not deliver rows belonging to a different given", async () => {
        const creator = await j.fact(new User("--- CREATOR ---"));
        const other = await j.fact(new Project(creator, "two"));

        const stream = await j.watchRows(allTasks, project);

        await j.fact(new Task(other, "not mine"));
        expect(stream.pending).toEqual(0);

        await j.fact(new Task(project, "mine"));
        expect(stream.pending).toEqual(1);

        stream.stop();
    });

    it("does not deliver a row when a nested projection changes", async () => {
        // A note entering a task's nested collection is not a task entering the
        // set. Registering non-root inverses would deliver a row here.
        const stream = await j.watchRows(tasksWithNotes, project);

        const task = await j.fact(new Task(project, "has notes"));
        expect(stream.pending).toEqual(1);

        await j.fact(new TaskNote(task, "a note"));
        expect(stream.pending).toEqual(1);

        stream.stop();
    });

    it("delivers a projected shape, including a hash the specification asks for", async () => {
        const stream = await j.watchRows(outstandingProjected, project);
        const changes = stream[Symbol.asyncIterator]();

        const task = await j.fact(new Task(project, "projected"));

        const added = await changes.next();
        expect(added.value.result.hash).toEqual(Jinaga.hash(task));
        expect(added.value.result.description).toEqual("projected");
        expect(Jinaga.hash(added.value.result.task)).toEqual(Jinaga.hash(task));

        stream.stop();
    });

    it("extracts a nested collection the way query does", async () => {
        // Nested specification components arrive from the store as internal
        // projected results. Delivering them raw would leak that shape into the
        // payload and disagree with query over the same specification.
        await j.fact(new Task(project, "first"));

        const stream = await j.watchChanges(tasksWithSiblings, project);
        const changes = stream[Symbol.asyncIterator]();

        await j.fact(new Task(project, "second"));

        const added = await changes.next();
        expect(added.value.result.description).toEqual("second");
        expect(added.value.result.all.slice().sort()).toEqual(["first", "second"]);

        const queried = await j.query(tasksWithSiblings, project);
        expect(added.value.result).toEqual(queried.find(r => r.description === "second"));

        stream.stop();
    });

    it("stops delivering after stop()", async () => {
        const stream = await j.watchRows(allTasks, project);

        await j.fact(new Task(project, "before stop"));
        expect(stream.pending).toEqual(1);

        stream.stop();

        await j.fact(new Task(project, "after stop"));
        expect(stream.pending).toEqual(1);
    });

    it("tolerates stop() called twice", async () => {
        const stream = await j.watchRows(allTasks, project);
        stream.stop();
        expect(() => stream.stop()).not.toThrow();
    });

    it("rejects the wrong number of givens", async () => {
        // Arity is a compile-time error for a typed caller, so this is the
        // route a JavaScript caller reaches the runtime guard by.
        await expect((j.watchRows as any)(outstandingForCreator, project))
            .rejects.toThrow(/expected 2 given facts, but received 1/);
    });

    it("rejects a null given", async () => {
        await expect(j.watchRows(allTasks, null as any))
            .rejects.toThrow(/One or more given facts are null/);
    });
});

describe("watchChanges", () => {
    let j: Jinaga;
    let project: Project;

    beforeEach(async () => {
        j = JinagaTest.create({ model });
        const creator = await j.fact(new User("--- CREATOR ---"));
        project = await j.fact(new Project(creator, "one"));
    });

    it("delivers changes only, not the rows that already match", async () => {
        // The difference between this method and watchRows is the whole reason
        // they are two methods: a consumer that must process every row and a
        // consumer that only reacts to change want opposite things here, and
        // the wrong one is silent until a backlog exists.
        await j.fact(new Task(project, "already here"));

        const stream = await j.watchChanges(outstandingTasks, project);
        expect(stream.pending).toEqual(0);

        await j.fact(new Task(project, "arrived later"));

        const first = await stream[Symbol.asyncIterator]().next();
        expect(first.value.result.description).toEqual("arrived later");

        stream.stop();
    });
});

describe("row streams", () => {
    let j: Jinaga;
    let project: Project;

    beforeEach(async () => {
        j = JinagaTest.create({ model });
        const creator = await j.fact(new User("--- CREATOR ---"));
        project = await j.fact(new Project(creator, "one"));
    });

    it("does not make the save wait for the consumer", async () => {
        // This is what pull delivery buys. The library owns the callback, so it
        // only enqueues; the consumer's work cannot sit inside the notification,
        // and cannot be abandoned for exceeding the listener bound, because it
        // is not running there at all.
        const stream = await j.watchChanges(outstandingTasks, project);

        await j.fact(new Task(project, "nobody is reading yet"));

        expect(stream.pending).toEqual(1);
        expect(stream.dropped).toEqual(0);

        const first = await stream[Symbol.asyncIterator]().next();
        expect(first.value.result.description).toEqual("nobody is reading yet");

        stream.stop();
    });

    it("drops the oldest change beyond capacity and counts it", async () => {
        // Back pressure is not an option: it would block the listener, and a
        // blocked listener blocks the save behind it. Dropping is safe because
        // the consumer's queryRows sweep is the source of truth.
        const stream = await j.watchChanges(outstandingTasks, project, { capacity: 2 });

        await j.fact(new Task(project, "first"));
        await j.fact(new Task(project, "second"));
        await j.fact(new Task(project, "third"));

        expect(stream.dropped).toEqual(1);

        const changes = stream[Symbol.asyncIterator]();
        const descriptions = [
            (await changes.next()).value.result.description,
            (await changes.next()).value.result.description
        ];
        expect(descriptions).toEqual(["second", "third"]);

        stream.stop();
    });

    it("never drops the rows it started with", async () => {
        // The read is the reliable path and the notification is the hint. A
        // consumer that silently lost part of its backlog would have no way to
        // notice, so capacity bounds the hints only.
        await j.fact(new Task(project, "first"));
        await j.fact(new Task(project, "second"));
        await j.fact(new Task(project, "third"));

        const stream = await j.watchRows(outstandingTasks, project, { capacity: 1 });

        expect(stream.pending).toEqual(3);
        expect(stream.dropped).toEqual(0);

        stream.stop();
    });

    it("ends the iteration when stopped", async () => {
        const stream = await j.watchChanges(outstandingTasks, project);
        const seen: string[] = [];
        const consumer = (async () => {
            for await (const change of stream) {
                seen.push(change.result.description);
            }
        })();

        await j.fact(new Task(project, "before stop"));
        stream.stop();
        await consumer;

        expect(seen).toEqual(["before stop"]);
    });

    it("serves concurrent next() calls in order", async () => {
        // The async iteration protocol allows next() again before the previous
        // call settles. A single parked resolver would be overwritten and the
        // earlier consumer would hang forever, with no error to notice.
        const stream = await j.watchChanges(outstandingTasks, project);
        const changes = stream[Symbol.asyncIterator]();

        const first = changes.next();
        const second = changes.next();

        await j.fact(new Task(project, "first"));
        await j.fact(new Task(project, "second"));

        expect((await first).value.result.description).toEqual("first");
        expect((await second).value.result.description).toEqual("second");

        stream.stop();
    });

    it("ends every parked next() when stopped", async () => {
        const stream = await j.watchChanges(outstandingTasks, project);
        const changes = stream[Symbol.asyncIterator]();

        const first = changes.next();
        const second = changes.next();
        stream.stop();

        expect((await first).done).toBe(true);
        expect((await second).done).toBe(true);
    });

    it("refuses a second consumer", async () => {
        const stream = await j.watchChanges(outstandingTasks, project);
        stream[Symbol.asyncIterator]();
        expect(() => stream[Symbol.asyncIterator]()).toThrow(/one consumer/);
        stream.stop();
    });
});

describe("subscribeRows", () => {
    // subscribe has meant "hold the feed open" here since long before rows had
    // names. These tests hold the library to it: the stream opens the feed on
    // start and releases it on stop.
    class RecordingNetwork implements Network {
        public opened: string[] = [];
        public closed: string[] = [];

        feeds(start: FactReference[], specification: Specification): Promise<FeedsResponse> {
            return Promise.resolve({ feeds: ["feed-one"] });
        }

        fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
            return Promise.resolve({ references: [], bookmark });
        }

        streamFeed(feed: string, bookmark: string, onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>, onError: (err: Error) => void): () => void {
            this.opened.push(feed);
            // A subscription is not started until its feed has answered once:
            // Subscriber.start awaits the first response. Answer as the real
            // replicator does when it has nothing new.
            void onResponse([], bookmark);
            return () => { this.closed.push(feed); };
        }

        load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
            return Promise.resolve([]);
        }

        async intersectForSubscribe(start: FactReference[], specification: Specification) {
            return [{ start, specification }];
        }
    }

    function createWithNetwork(network: Network) {
        const store = new MemoryStore();
        const observableSource = new ObservableSource(store);
        const factManager = new FactManager(new PassThroughFork(store), observableSource, store, network, []);
        return new Jinaga(new AuthenticationNoOp(), factManager, new SyncStatusNotifier());
    }

    it("holds the feed open, and releases it on stop", async () => {
        const network = new RecordingNetwork();
        const j = createWithNetwork(network);
        const creator = await j.fact(new User("--- CREATOR ---"));
        const project = await j.fact(new Project(creator, "one"));

        const stream = await j.subscribeRows(outstandingTasks, project);
        expect(network.opened).toEqual(["feed-one"]);
        expect(network.closed).toEqual([]);

        stream.stop();
        expect(network.closed).toEqual(["feed-one"]);
    });

    it("delivers the current rows and the later ones, like watchRows", async () => {
        const network = new RecordingNetwork();
        const j = createWithNetwork(network);
        const creator = await j.fact(new User("--- CREATOR ---"));
        const project = await j.fact(new Project(creator, "one"));
        await j.fact(new Task(project, "backlog"));

        const stream = await j.subscribeRows(outstandingTasks, project);
        const changes = stream[Symbol.asyncIterator]();

        expect((await changes.next()).value.result.description).toEqual("backlog");

        await j.fact(new Task(project, "later"));
        expect((await changes.next()).value.result.description).toEqual("later");

        stream.stop();
    });

    it("subscribeChanges holds the feed open without the current rows", async () => {
        const network = new RecordingNetwork();
        const j = createWithNetwork(network);
        const creator = await j.fact(new User("--- CREATOR ---"));
        const project = await j.fact(new Project(creator, "one"));
        await j.fact(new Task(project, "backlog"));

        const stream = await j.subscribeChanges(outstandingTasks, project);
        expect(network.opened).toEqual(["feed-one"]);
        expect(stream.pending).toEqual(0);

        stream.stop();
        expect(network.closed).toEqual(["feed-one"]);
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

    it("returns the rows that already match", async () => {
        const task = await j.fact(new Task(project, "already here"));

        const rows = await j.queryRows(outstandingTasks, project);
        expect(rows).toHaveLength(1);
        expect(Jinaga.hash(rows[0].result)).toEqual(Jinaga.hash(task));
    });

    it("gives a row the same rowHash that a stream gives it", async () => {
        // One key across both discovery paths is what lets a periodic sweep
        // deduplicate against the stream it backs up.
        const stream = await j.watchChanges(outstandingTasks, project);
        const changes = stream[Symbol.asyncIterator]();

        await j.fact(new Task(project, "in the gap"));
        const added = await changes.next();
        const rows = await j.queryRows(outstandingTasks, project);

        expect(rows).toHaveLength(1);
        expect(rows[0].rowHash).toEqual(added.value.rowHash);

        await j.fact(new TaskCompleted(rows[0].result));
        const removed = await changes.next();
        expect(removed.value.rowHash).toEqual(rows[0].rowHash);
        expect(await j.queryRows(outstandingTasks, project)).toHaveLength(0);

        stream.stop();
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

    it("rejects the wrong number of givens", async () => {
        await expect((j.queryRows as any)(outstandingForCreator, project))
            .rejects.toThrow(/Expected 2 given facts, but received 1/);
    });

    it("returns nothing for a null given", async () => {
        expect(await j.queryRows(allTasks, null as any)).toEqual([]);
    });
});

describe("the worker recipe", () => {
    // What issue #251 prescribes, once the ordering and the feed belong to the
    // library: one call, one loop, and a completion fact.
    it("processes the backlog and the new arrivals exactly once", async () => {
        const j = JinagaTest.create({ model });
        const creator = await j.fact(new User("--- CREATOR ---"));
        const project = await j.fact(new Project(creator, "one"));

        // Work that predates the worker.
        await j.fact(new Task(project, "backlog one"));
        await j.fact(new Task(project, "backlog two"));

        const stream = await j.watchRows<[Project], Task>(outstandingTasks, project);

        const handled: string[] = [];
        const cancelled = new Set<string>();
        const seen = new Set<string>();
        const worker = (async () => {
            for await (const change of stream) {
                if (change.operation === "removed") {
                    cancelled.add(change.rowHash);
                    continue;
                }
                if (seen.has(change.rowHash) || cancelled.has(change.rowHash)) {
                    continue;
                }
                seen.add(change.rowHash);
                handled.push(change.result.description);
                // The completion fact is the record of processing, and writing
                // it is what takes the row out of the set.
                await j.fact(new TaskCompleted(change.result));
                if (handled.length === 3) {
                    break;
                }
            }
        })();

        await j.fact(new Task(project, "arrived later"));
        await worker;

        expect(handled.slice().sort()).toEqual([
            "arrived later",
            "backlog one",
            "backlog two"
        ]);
        expect(await j.queryRows(outstandingTasks, project)).toHaveLength(0);

        stream.stop();
    });
});

describe("several givens", () => {
    let j: Jinaga;
    let creator: User;
    let project: Project;

    beforeEach(async () => {
        j = JinagaTest.create({ model });
        creator = await j.fact(new User("--- CREATOR ---"));
        project = await j.fact(new Project(creator, "one"));
    });

    it("delivers the current rows, the later ones, and their removals", async () => {
        const backlog = await j.fact(new Task(project, "backlog"));

        const stream = await j.watchRows(outstandingForCreator, creator, project);
        const changes = stream[Symbol.asyncIterator]();

        const first = await changes.next();
        expect(first.value.operation).toEqual("added");
        expect(Jinaga.hash(first.value.result)).toEqual(Jinaga.hash(backlog));

        const later = await j.fact(new Task(project, "later"));
        const second = await changes.next();
        expect(second.value.result.description).toEqual("later");

        await j.fact(new TaskCompleted(later));
        const third = await changes.next();
        expect(third.value.operation).toEqual("removed");
        expect(third.value.rowHash).toEqual(second.value.rowHash);

        stream.stop();
    });

    it("does not deliver rows belonging to a different pair of givens", async () => {
        const other = await j.fact(new User("--- OTHER ---"));
        const otherProject = await j.fact(new Project(other, "two"));

        const stream = await j.watchChanges(outstandingForCreator, creator, project);
        const otherStream = await j.watchChanges(outstandingForCreator, other, otherProject);

        await j.fact(new Task(project, "mine"));

        expect(stream.pending).toEqual(1);
        expect(otherStream.pending).toEqual(0);

        stream.stop();
        otherStream.stop();
    });

    it("gives queryRows and the stream the same rowHash", async () => {
        const stream = await j.watchChanges(outstandingForCreator, creator, project);
        const changes = stream[Symbol.asyncIterator]();

        await j.fact(new Task(project, "outstanding"));
        const added = await changes.next();
        const rows = await j.queryRows(outstandingForCreator, creator, project);

        expect(rows).toHaveLength(1);
        expect(rows[0].rowHash).toEqual(added.value.rowHash);

        stream.stop();
    });

    it("still takes options after the givens", async () => {
        // The options object trails the givens and is told apart by count, so
        // adding a given does not cost the caller its capacity.
        const stream = await j.watchChanges(outstandingForCreator, creator, project, { capacity: 1 });

        await j.fact(new Task(project, "first"));
        await j.fact(new Task(project, "second"));

        expect(stream.dropped).toEqual(1);
        expect(stream.pending).toEqual(1);

        stream.stop();
    });
});
