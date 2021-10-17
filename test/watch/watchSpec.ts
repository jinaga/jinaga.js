import { expect } from "chai";
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

describe("Watch", function () {
  var j: Jinaga;
  beforeEach(function() {
    const memory = new MemoryStore();
    j = new Jinaga(new MockAuthentication(memory), memory, null);
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

  it("should tolerate null start", async function () {
    const watch = j.watch(null, j.for(tasksInList), taskAdded);
    await watch.load();
    watch.watch(j.for(taskCompletions), (parent, result) => {});
    watch.stop();
  });

  it("should return a matching message", async function () {
    await j.watch(chores, j.for(tasksInList), taskAdded).load();
    await j.fact(trash);

    tasks.length.should.equal(1);
    expect(_isEqual(tasks[0], trash)).to.be.true;
  });

  it("should not return a match twice", async function () {
    await j.watch(chores, j.for(tasksInList), taskAdded).load();
    await j.fact(trash);
    await j.fact(trash);

    tasks.length.should.equal(1);
  });

  it("should not return if not a match", async function () {
    await j.watch(chores, j.for(tasksInList), taskAdded).load();
    await j.fact(new Task(new TaskList('Fun'), 'Play XBox'));

    tasks.length.should.equal(0);
  });

  it("should return existing message", async function () {
    await j.fact(trash);
    await j.watch(chores, j.for(tasksInList), taskAdded).load();

    tasks.length.should.equal(1);
    expect(_isEqual(tasks[0], trash)).to.be.true;
  });

  it("should match a predecessor", async function () {
    await j.watch(chores, j.for(tasksInList), taskAdded).load();
    await j.fact(new Completed(trash, new Date()));

    tasks.length.should.equal(1);
    expect(_isEqual(tasks[0], trash)).to.be.true;
  })

  it("should stop watching", async function () {
    var watch = j.watch(chores, j.for(tasksInList), taskAdded);
    await watch.load();
    watch.stop();
    await j.fact(trash);

    tasks.length.should.equal(0);
  });

  it("should query existing message", async function () {
    await j.fact(trash);
    const results = await j.query(chores, j.for(tasksInList));
    results.length.should.equal(1);
    expect(_isEqual(results[0], trash)).to.be.true;
  });

  it ("should remove a fact when a successor is added", async function () {
    var watch = j.watch(chores, j.for(tasksInList), taskAdded, taskRemoved);
    await watch.load();
    await j.fact(trash);
    await j.fact(new Completed(trash, new Date()));
    expect(tasks.length).to.equal(0);
    watch.stop();
  });

  it ("should remove an existing fact when a successor is added", async function () {
    await j.fact(trash);
    var watch = j.watch(chores, j.for(tasksInList), taskAdded, taskRemoved);
    await watch.load();
    await j.fact(new Completed(trash, new Date()));
    expect(tasks.length).to.equal(0);
    watch.stop();
  });

  it ("should remove a fact when a successor is added via array", async function () {
    var watch = j.watch(chores, j.for(tasksInList), taskAdded, taskRemoved);
    await watch.load();
    await j.fact(trash);
    await j.fact({ type: "Completed", task: [trash] });
    expect(tasks.length).to.equal(0);
    watch.stop();
  });

  it ("should remove an existing fact when a successor is added via array", async function () {
    await j.fact(trash);
    var watch = j.watch(chores, j.for(tasksInList), taskAdded, taskRemoved);
    await watch.load();
    await j.fact({ type: "Completed", task: [trash] });
    expect(tasks.length).to.equal(0);
    watch.stop();
  });
});
