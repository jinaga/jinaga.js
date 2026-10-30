import {
    FactReference, Jinaga, JinagaTest, MemoryStore, ProjectedResult, Specification, User, buildModel
} from "@src";
import { describeSpecification } from "../../src/specification/description";
import { pinLabel } from "../../src/specification/inverse-candidates";

// Issue #359: a re-check decided each candidate by re-reading the whole result,
// so absorbing one save cost as much as the watch held. These are counts of the
// rows the store's `read` returns, not timings: the same watch over ten rows
// and over a thousand must spend the same reads absorbing the same save.
//
// Issue #376 then removed the observer's second read altogether. The exact
// inverses report the direction as well as the row, so there is nothing left to
// decide by reading: a save that is not one of the observer's givens costs the
// inverses' own reads and nothing else. The last two cases here are the row
// stream's, which still decides by a membership read until #377.

class Project {
    static Type = "Cost.Project" as const;
    type = Project.Type;
    constructor(public owner: User, public name: string) { }
}

class Task {
    static Type = "Cost.Task" as const;
    type = Task.Type;
    constructor(public project: Project, public description: string) { }
}

class Done {
    static Type = "Cost.Done" as const;
    type = Done.Type;
    constructor(public task: Task) { }
}

const model = buildModel(b => b
    .type(User)
    .type(Project, x => x
        .predecessor("owner", User)
    )
    .type(Task, x => x
        .predecessor("project", Project)
    )
    .type(Done, x => x
        .predecessor("task", Task)
    )
);

const openTasks = model.given(Project).match(project =>
    project.successors(Task, task => task.project)
        .notExists(task => task.successors(Done, done => done.task))
);

// One root row per project, carrying the project's open tasks as a nested
// collection. The nested level's specification is the root's matches followed
// by the component's, which is the shape that re-read the whole flattened
// result for one child.
const projectsWithOpenTasks = model.given(User).match(user =>
    user.successors(Project, project => project.owner)
        .select(project => ({
            name: project.name,
            openTasks: project.successors(Task, task => task.project)
                .notExists(task => task.successors(Done, done => done.task))
                .select(task => task.description)
        }))
);

/**
 * A store that counts what its reads return, modelled on `RoundTripStore` in
 * `subscriberNotifiesAddedSpec.ts`. Every read absorbing a save makes goes
 * through `Storage.read` -- the inverse listeners' reads, a membership read,
 * and a read of a whole level alike -- so one counter here measures the whole
 * cost of absorbing a save.
 *
 * It also separates the inverses' reads from every other read. An inverse
 * declares the pin as its last given and is read with
 * `[...subscriptionGivenRefs, newFactRef]`, so the last given's NAME is what
 * tells it apart: a whole-level read starts from the subscription's own givens,
 * and a membership read from those followed by the pinned labels. `otherReads`
 * holds each such read described, so a failure names what was read rather than
 * only how many.
 */
class CountingStore extends MemoryStore {
    public reads = 0;
    public rowsRead = 0;
    public inverseReads = 0;
    public otherReads: string[] = [];

    async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        const results = await super.read(start, specification);
        this.reads++;
        this.rowsRead += results.length;
        const given = specification.given;
        if (given.length > 0 && given[given.length - 1].label.name === pinLabel) {
            this.inverseReads++;
        }
        else {
            this.otherReads.push(describeSpecification(specification, 0));
        }
        return results;
    }

    reset(): void {
        this.reads = 0;
        this.rowsRead = 0;
        this.inverseReads = 0;
        this.otherReads = [];
    }
}

interface Fixture {
    j: Jinaga;
    store: CountingStore;
    owner: User;
    project: Project;
    tasks: Task[];
}

async function withOpenTasks(count: number): Promise<Fixture> {
    const store = new CountingStore();
    const j = JinagaTest.create({ store: () => store });
    const owner = await j.fact(new User("--- COST OWNER ---"));
    const project = await j.fact(new Project(owner, "one"));
    const tasks: Task[] = [];
    for (let index = 0; index < count; index++) {
        tasks.push(await j.fact(new Task(project, `task ${index}`)));
    }
    return { j, store, owner, project, tasks };
}

describe("The cost of a re-check (issue #359)", () => {
    it("reads the same rows absorbing a Task into a watch of ten rows and of a thousand", async () => {
        const measure = async (count: number) => {
            const { j, store, project } = await withOpenTasks(count);
            const observer = j.watch(openTasks, project, async () => { });
            await observer.loaded();
            store.reset();
            await j.fact(new Task(project, "arriving"));
            await observer.processed();
            observer.stop();
            return store.rowsRead;
        };

        const small = await measure(10);
        const large = await measure(1000);

        expect(large).toBe(small);
    });

    it("reads the same rows absorbing a Done into a watch of ten rows and of a thousand", async () => {
        const measure = async (count: number) => {
            const { j, store, project, tasks } = await withOpenTasks(count);
            const observer = j.watch(openTasks, project, async () => { });
            await observer.loaded();
            store.reset();
            await j.fact(new Done(tasks[0]));
            await observer.processed();
            observer.stop();
            return store.rowsRead;
        };

        const small = await measure(10);
        const large = await measure(1000);

        expect(large).toBe(small);
    });

    it("reads the same rows absorbing a Task into a nested collection of ten rows and of a thousand", async () => {
        const measure = async (count: number) => {
            const { j, store, owner, project } = await withOpenTasks(count);
            const observer = j.watch(projectsWithOpenTasks, owner, async p => {
                p.openTasks.onAdded(async () => { });
            });
            await observer.loaded();
            store.reset();
            await j.fact(new Task(project, "arriving"));
            await observer.processed();
            observer.stop();
            return store.rowsRead;
        };

        const small = await measure(10);
        const large = await measure(1000);

        expect(large).toBe(small);
    });

    it("reads the same rows absorbing a Task into a row stream of ten rows and of a thousand", async () => {
        const measure = async (count: number) => {
            const { j, store, project } = await withOpenTasks(count);
            const stream = await j.watchRows(openTasks, project);
            store.reset();
            await j.fact(new Task(project, "arriving"));
            stream.stop();
            return store.rowsRead;
        };

        const small = await measure(10);
        const large = await measure(1000);

        expect(large).toBe(small);
    });

    it("reads the same rows absorbing a Done into a row stream of ten rows and of a thousand", async () => {
        const measure = async (count: number) => {
            const { j, store, tasks } = await withOpenTasks(count);
            const stream = await j.watchRows(openTasks, tasks[0].project);
            store.reset();
            await j.fact(new Done(tasks[0]));
            stream.stop();
            return store.rowsRead;
        };

        const small = await measure(10);
        const large = await measure(1000);

        expect(large).toBe(small);
    });
});

describe("absorbing a save into a watch (issue #376)", () => {
    it("issues only the exact inverses' reads for a fact that is not a given", async () => {
        const { j, store, project, tasks } = await withOpenTasks(10);
        const observer = j.watch(openTasks, project, async () => { });
        await observer.loaded();

        // A fact that adds a row, then one that removes a row: both directions
        // are reported by an inverse, so neither needs a read to decide it.
        store.reset();
        await j.fact(new Task(project, "arriving"));
        await observer.processed();
        expect(store.otherReads).toEqual([]);
        expect(store.inverseReads).toBeGreaterThan(0);

        store.reset();
        await j.fact(new Done(tasks[0]));
        await observer.processed();
        expect(store.otherReads).toEqual([]);
        expect(store.inverseReads).toBeGreaterThan(0);

        observer.stop();
    });

    it("issues only the exact inverses' reads for a fact that lands in a nested collection", async () => {
        const { j, store, owner, project } = await withOpenTasks(10);
        const observer = j.watch(projectsWithOpenTasks, owner, async p => {
            p.openTasks.onAdded(async () => { });
        });
        await observer.loaded();

        store.reset();
        await j.fact(new Task(project, "arriving"));
        await observer.processed();

        expect(store.otherReads).toEqual([]);
        expect(store.inverseReads).toBeGreaterThan(0);

        observer.stop();
    });
});
