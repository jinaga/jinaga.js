import { Jinaga } from "../../src/jinaga";
import { MemoryStore } from "../../src/memory/memory-store";
import { MockAuthentication } from "./mock-authentication";
import { factReferenceEquals } from "../../src/storage";
import { dehydrateFact } from "../../src/fact/hydrate";

class TaskList {
  static Type = "TaskList" as const;
  type = TaskList.Type;

  constructor(
    public name: string
  ) { }
}

class Task {
  static Type = "Task" as const;
  type = Task.Type;

  constructor(
    public list: TaskList,
    public description: string
  ) { }
}

class Completed {
  static Type = "Completed" as const;
  type = Completed.Type;

  constructor(
    public task: Task,
    public completedAt: Date | string
  ) { }
}

function _isEqual(a: {}, b: {}): boolean {
  const aRef = dehydrateFact(a);
  const bRef = dehydrateFact(b);
  return aRef.every(aRec => bRef.some(factReferenceEquals(aRec)));
}

function completionsInList(list: TaskList) {
  return Jinaga.match<Completed>({
    type: Completed.Type,
    task: {
      type: Task.Type,
      list
    }
  })
}

describe("Watch", () => {
  var j: Jinaga;
  beforeEach(() => {
    const memory = new MemoryStore();
    j = new Jinaga(new MockAuthentication(memory), null);
    tasks = [];
  });

  const chores = new TaskList("Chores");

  const trash = new Task(chores, "Take out the trash");

  function tasksInList(l: TaskList) {
    return j.match<Task>({
      type: Task.Type,
      list: l
    }).suchThat(j.not(isCompleted));
  }

  function taskCompletions(task: Task) {
    return j.match<Completed>( {
      type: Completed.Type,
      task
    });
  }

  function isCompleted(t: Task) {
    return j.exists<Completed>({
      type: Completed.Type,
      task: t
    });
  }

  var tasks: Task[];
  function taskAdded(task: Task) {
    tasks.push(task);
    return {
      task: task
    }
  }

  function taskRemoved(mapping: { task: Task }) {
    const index = tasks.indexOf(mapping.task);
    if (index >= 0)
      tasks.splice(index, 1);
  }

  it("should tolerate null start", async () => {
    const watch = j.watch(null, j.for(tasksInList), taskAdded);
    await watch.load();
    watch.watch(j.for(taskCompletions), (parent, result) => {});
    watch.stop();
  });

  it("should return a matching message", async () => {
    await j.watch(chores, j.for(tasksInList), taskAdded).load();
    await j.fact(trash);

    expect(tasks.length).toBe(1);
  });

  it("should not return a match twice", async () => {
    await j.watch(chores, j.for(tasksInList), taskAdded).load();
    await j.fact(trash);
    await j.fact(trash);

    expect(tasks.length).toBe(1);
  });

  it("should not return if not a match", async () => {
    await j.watch(chores, j.for(tasksInList), taskAdded).load();
    await j.fact(new Task(new TaskList('Fun'), 'Play XBox'));

    expect(tasks.length).toBe(0);
  });

  it("should return existing message", async () => {
    await j.fact(trash);
    await j.watch(chores, j.for(tasksInList), taskAdded).load();

    expect(tasks.length).toBe(1);
  });

  it("should match a predecessor", async () => {
    await j.watch(chores, j.for(tasksInList), taskAdded).load();
    await j.fact(new Completed(trash, new Date()));

    expect(tasks.length).toBe(1);
  })

  it("should stop watching", async () => {
    var watch = j.watch(chores, j.for(tasksInList), taskAdded);
    await watch.load();
    watch.stop();
    await j.fact(trash);

    expect(tasks.length).toBe(0);
  });

  it("should query existing message", async () => {
    await j.fact(trash);
    const results = await j.query(chores, j.for(tasksInList));

    expect(results.length).toBe(1);
  });

  it("should remove a fact when a successor is added", async () => {
    var watch = j.watch(chores, j.for(tasksInList), taskAdded, taskRemoved);
    await watch.load();
    await j.fact(trash);
    await j.fact(new Completed(trash, new Date()));

    expect(tasks.length).toBe(0);
    watch.stop();
  });

  it ("should remove an existing fact when a successor is added", async () => {
    await j.fact(trash);
    var watch = j.watch(chores, j.for(tasksInList), taskAdded, taskRemoved);
    await watch.load();
    await j.fact(new Completed(trash, new Date()));

    expect(tasks.length).toBe(0);
    watch.stop();
  });

  it ("should remove a fact when a successor is added via array", async () => {
    var watch = j.watch(chores, j.for(tasksInList), taskAdded, taskRemoved);
    await watch.load();
    await j.fact(trash);
    await j.fact({ type: "Completed", task: [trash] });

    expect(tasks.length).toBe(0);
    watch.stop();
  });

  it ("should remove an existing fact when a successor is added via array", async () => {
    await j.fact(trash);
    var watch = j.watch(chores, j.for(tasksInList), taskAdded, taskRemoved);
    await watch.load();
    await j.fact({ type: "Completed", task: [trash] });

    expect(tasks.length).toBe(0);
    watch.stop();
  });
});
