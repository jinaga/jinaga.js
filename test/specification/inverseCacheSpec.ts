import {
    DEFAULT_INVERSE_CACHE_CAPACITY,
    Specification,
    SpecificationParser,
    User,
    buildModel,
    clearInverseCache,
    describeSpecification,
    inverseCacheStatistics,
    invertSpecification,
    setInverseCacheCapacity
} from "@src";

// Issue #266: invertSpecification is pure but was recomputed by every caller.
// A production session logged 32,528 inversions for ~33 distinct specifications
// because the server inverts once per streaming subscription.
//
// These tests pin the two things a cache must not break — the same answer, and
// a different answer for a different specification — and the bound that keeps a
// caller generating many distinct specifications from growing it forever.

class Project {
    static Type = "Cache.Project" as const;
    type = Project.Type;
    constructor(public creator: User, public identifier: string) { }
}

class Task {
    static Type = "Cache.Task" as const;
    type = Task.Type;
    constructor(public project: Project, public description: string) { }
}

class TaskCompleted {
    static Type = "Cache.TaskCompleted" as const;
    type = TaskCompleted.Type;
    constructor(public task: Task) { }
}

const model = buildModel(b => b
    .type(User)
    .type(Project, x => x.predecessor("creator", User))
    .type(Task, x => x.predecessor("project", Project))
    .type(TaskCompleted, x => x.predecessor("task", Task))
);

const allTasks = model.given(Project).match(project =>
    project.successors(Task, task => task.project)
);

const outstandingTasks = model.given(Project).match(project =>
    project.successors(Task, task => task.project)
        .notExists(task => task.successors(TaskCompleted, completed => completed.task))
);

const projectsForUser = model.given(User).match(user =>
    user.successors(Project, project => project.creator)
);

/**
 * Re-parse a specification's own description into a structurally identical but
 * distinct object graph. This is the situation the issue describes: each
 * subscription arrives with its own specification instance, and only about 33
 * of them are actually distinct.
 */
function reparse(specification: Specification): Specification {
    const parser = new SpecificationParser(describeSpecification(specification, 0));
    parser.skipWhitespace();
    return parser.parseSpecification();
}

describe("invertSpecification memoization", () => {
    beforeEach(() => {
        setInverseCacheCapacity(DEFAULT_INVERSE_CACHE_CAPACITY);
        clearInverseCache();
    });

    afterAll(() => {
        setInverseCacheCapacity(DEFAULT_INVERSE_CACHE_CAPACITY);
        clearInverseCache();
    });

    it("serves a repeated call from the cache", () => {
        invertSpecification(allTasks.specification);
        expect(inverseCacheStatistics()).toMatchObject({ hits: 0, misses: 1, size: 1 });

        invertSpecification(allTasks.specification);
        expect(inverseCacheStatistics()).toMatchObject({ hits: 1, misses: 1, size: 1 });
    });

    it("shares one entry across structurally identical, distinct instances", () => {
        // The whole point of the issue: 33 distinct specifications, 32,528 calls.
        const instances = [
            allTasks.specification,
            reparse(allTasks.specification),
            reparse(allTasks.specification)
        ];
        expect(instances[0]).not.toBe(instances[1]);

        const results = instances.map(invertSpecification);

        expect(inverseCacheStatistics()).toMatchObject({ hits: 2, misses: 1, size: 1 });
        expect(results[1]).toEqual(results[0]);
        expect(results[2]).toEqual(results[0]);
    });

    it("returns what an uncached inversion returns", () => {
        for (const specification of [allTasks, outstandingTasks, projectsForUser]) {
            setInverseCacheCapacity(0);
            const uncached = invertSpecification(specification.specification);

            setInverseCacheCapacity(DEFAULT_INVERSE_CACHE_CAPACITY);
            clearInverseCache();
            const firstCall = invertSpecification(specification.specification);
            const secondCall = invertSpecification(specification.specification);

            expect(firstCall).toEqual(uncached);
            expect(secondCall).toEqual(uncached);
        }
    });

    it("does not confuse two different specifications", () => {
        const tasks = invertSpecification(allTasks.specification);
        const outstanding = invertSpecification(outstandingTasks.specification);

        expect(inverseCacheStatistics()).toMatchObject({ hits: 0, misses: 2, size: 2 });
        // The notExists shape produces a remove inverse; the plain one does not.
        expect(tasks.some(i => i.operation === "remove")).toBe(false);
        expect(outstanding.some(i => i.operation === "remove")).toBe(true);
        expect(outstanding).not.toEqual(tasks);
    });

    it("evicts the least recently used entry at capacity", () => {
        setInverseCacheCapacity(2);

        invertSpecification(allTasks.specification);
        invertSpecification(outstandingTasks.specification);
        expect(inverseCacheStatistics().size).toBe(2);

        // Touch the first so the second becomes least recently used.
        invertSpecification(allTasks.specification);
        invertSpecification(projectsForUser.specification);

        expect(inverseCacheStatistics().size).toBe(2);

        // allTasks survived, so it is still a hit.
        const hitsBefore = inverseCacheStatistics().hits;
        invertSpecification(allTasks.specification);
        expect(inverseCacheStatistics().hits).toBe(hitsBefore + 1);

        // outstandingTasks was evicted, so it must be recomputed.
        const missesBefore = inverseCacheStatistics().misses;
        invertSpecification(outstandingTasks.specification);
        expect(inverseCacheStatistics().misses).toBe(missesBefore + 1);
    });

    it("evicts immediately when the capacity is lowered", () => {
        invertSpecification(allTasks.specification);
        invertSpecification(outstandingTasks.specification);
        invertSpecification(projectsForUser.specification);
        expect(inverseCacheStatistics().size).toBe(3);

        setInverseCacheCapacity(1);
        expect(inverseCacheStatistics().size).toBe(1);
    });

    it("computes every time when caching is disabled", () => {
        setInverseCacheCapacity(0);

        const first = invertSpecification(allTasks.specification);
        const second = invertSpecification(allTasks.specification);

        expect(inverseCacheStatistics()).toMatchObject({ hits: 0, misses: 0, size: 0 });
        expect(second).toEqual(first);
        expect(second).not.toBe(first);
    });

    it("rejects a negative or fractional capacity", () => {
        expect(() => setInverseCacheCapacity(-1)).toThrow(/non-negative integer/);
        expect(() => setInverseCacheCapacity(1.5)).toThrow(/non-negative integer/);
    });

    it("hands each caller its own array", () => {
        const first = invertSpecification(allTasks.specification);
        const length = first.length;
        expect(length).toBeGreaterThan(0);

        // A caller that mutates its result must not reorder or truncate what
        // the next caller sees.
        first.length = 0;

        const second = invertSpecification(allTasks.specification);
        expect(second).toHaveLength(length);
        expect(second).not.toBe(first);
    });

    it("does not cache a rejected specification", () => {
        // Two isolated clusters: u1 connects to p1, t1 connects to p2, and
        // nothing joins them. Rejected before any inversion runs.
        const disconnected = new SpecificationParser(`
            (u1: Jinaga.User, p2: Cache.Project) {
                p1: Cache.Project [
                    p1->creator: Jinaga.User = u1
                ]
                t1: Cache.Task [
                    t1->project: Cache.Project = p2
                ]
            }
        `);
        disconnected.skipWhitespace();
        const specification = disconnected.parseSpecification();

        expect(() => invertSpecification(specification)).toThrow();
        expect(inverseCacheStatistics().size).toBe(0);

        // The rejection is stable rather than turning into a stale success.
        expect(() => invertSpecification(specification)).toThrow();
        expect(inverseCacheStatistics().size).toBe(0);
    });
});
