import { NoOpTracer, Trace, Tracer, User, buildModel, clearInverseCache, invertSpecification } from "@src";

/**
 * Records messages by the level they were traced at, so a count can be taken
 * per level rather than by matching message text (issue #264).
 */
class RecordingTracer extends NoOpTracer implements Tracer {
    public readonly infos: string[] = [];
    public readonly debugs: string[] = [];
    info(message: string): void {
        this.infos.push(message);
    }
    debug(message: string): void {
        this.debugs.push(message);
    }
}

class Project {
    static Type = "Volume.Project" as const;
    type = Project.Type;
    constructor(public creator: User, public identifier: string) { }
}

class Task {
    static Type = "Volume.Task" as const;
    type = Task.Type;
    constructor(public project: Project, public description: string) { }
}

class TaskCompleted {
    static Type = "Volume.TaskCompleted" as const;
    type = TaskCompleted.Type;
    constructor(public task: Task) { }
}

class Member {
    static Type = "Volume.Member" as const;
    type = Member.Type;
    constructor(public project: Project, public user: User) { }
}

const model = buildModel(b => b
    .type(User)
    .type(Project, x => x.predecessor("creator", User))
    .type(Task, x => x.predecessor("project", Project))
    .type(TaskCompleted, x => x.predecessor("task", Task))
    .type(Member, x => x.predecessor("project", Project))
);

// One match, no nested projection: the smallest specification that inverts.
const tasks = model.given(Project).match(project =>
    project.successors(Task, task => task.project)
).specification;

// Several matches and two nested specifications in a composite projection:
// every per-item loop in the inverter runs more times for this one.
const projectDetail = model.given(Project).match((project, facts) =>
    facts.ofType(Task)
        .join(task => task.project, project)
        .notExists(task => facts.ofType(TaskCompleted)
            .join(completed => completed.task, task)
        )
        .select(task => ({
            description: task.description,
            completions: facts.ofType(TaskCompleted)
                .join(completed => completed.task, task),
            members: facts.ofType(Member)
                .join(member => member.project, project)
        }))
).specification;

describe("inversion log volume (issue #264)", () => {
    let tracer: RecordingTracer;

    beforeEach(() => {
        // Trace is global static state, so it must be restored in afterEach.
        tracer = new RecordingTracer();
        Trace.configure(tracer);
        // The inverse cache would skip the logging on a second run.
        clearInverseCache();
    });

    afterEach(() => {
        Trace.setLevel("info");
        Trace.off();
        clearInverseCache();
    });

    function countLevels(specification: typeof tasks) {
        tracer.infos.length = 0;
        tracer.debugs.length = 0;
        invertSpecification(specification);
        return { infos: tracer.infos.length, debugs: tracer.debugs.length };
    }

    it("does not grow info output with the size of the specification", () => {
        const small = countLevels(tasks);
        const large = countLevels(projectDetail);

        // Only the aggregate summary belongs at info, and one inversion
        // produces one of those whatever the specification contains.
        expect(large.infos).toBe(small.infos);
        expect(small.debugs).toBe(0);
        expect(large.debugs).toBe(0);
    });

    it("keeps the per-item detail reachable at debug level", () => {
        Trace.setLevel("debug");

        const small = countLevels(tasks);
        const large = countLevels(projectDetail);

        // Demoting the detail must not delete it, and the larger
        // specification still accounts for more of it.
        expect(large.debugs).toBeGreaterThan(small.debugs);
        expect(large.infos).toBe(small.infos);
    });
});
