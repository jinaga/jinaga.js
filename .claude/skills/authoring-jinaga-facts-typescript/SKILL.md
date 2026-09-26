---
name: authoring-jinaga-facts-typescript
description: >
  Use when defining or editing a Jinaga fact type in TypeScript — creating a
  new fact class, registering it with a ModelBuilder, adding a predecessor
  or field to an existing one, or modeling something that changes over time.
---

# Authoring Jinaga facts in TypeScript

Translating a fact model (see `designing-historical-models`) into Jinaga
TypeScript. If you haven't modeled the fact types yet, do that first — this
skill covers the syntax and idioms once you know what you're declaring.

## Declare facts as classes with a static `Type`

Every fact is a plain class with a `static Type` string constant and a
mirrored instance `type` field:

```typescript
export class Project {
    static Type = "TaskTracker.Project" as const;
    type = Project.Type;

    constructor(
        public creator: User,
        public createdAt: Date | string
    ) { }
}
```

`Type` strings use a dotted, hierarchical naming convention
(`TaskTracker.Task.Title`, not `TaskTitle`) mirroring the entity's
conceptual nesting.

## Predecessors are constructor parameters

A predecessor is just another fact class used as a constructor parameter
type — Jinaga infers the role from the parameter, but it still needs
registering explicitly in the model (below):

```typescript
export class Task {
    static Type = "TaskTracker.Task" as const;
    type = Task.Type;

    constructor(
        public project: Project,
        public createdAt: Date | string
    ) { }
}
```

## Register every fact type with a `ModelBuilder`

The class declaration alone isn't enough — every fact type, and every one
of its predecessor roles, must be registered:

```typescript
import { buildModel, User } from "jinaga";

export const model = buildModel(b => b
    .type(Project, m => m.predecessor("creator", User))
    .type(Task, m => m.predecessor("project", Project))
);
```

A fact type with no predecessors (a root) is registered with no second
argument: `.type(User)`. Compose sub-models with `.with(...)`:
`buildModel(b => b.with(taskModel).with(otherModel))`.

## Static query helpers live on the fact class

The common idiom is a static method per query need, colocated with the
class it queries from — the model classes double as the specification
library rather than repeating the same walk everywhere:

```typescript
export class Project {
    // ...
    static by(user: LabelOf<User>) {
        return user.successors(Project, project => project.creator);
    }
}

export class Task {
    // ...
    static in(project: LabelOf<Project>) {
        return project.successors(Task, task => task.project);
    }
}
```

See `authoring-jinaga-specifications-typescript` for what `LabelOf`,
`successors`, and the selector lambda are actually doing.

## Mutable properties: the `prior` chain

A value that changes over time — a task's title, its due date — is its own
fact type with a `prior` array of the same type, pointing at whatever it
supersedes:

```typescript
export class TaskTitle {
    static Type = "TaskTracker.Task.Title" as const;
    type = TaskTitle.Type;

    constructor(
        public task: Task,
        public value: string,
        public prior: TaskTitle[]
    ) { }

    static current(task: LabelOf<Task>) {
        return task.successors(TaskTitle, title => title.task)
            .notExists(title => title.successors(TaskTitle, next => next.prior));
    }
}
```

Register `prior` as a predecessor role too: `.type(TaskTitle, m => m
.predecessor("task", Task).predecessor("prior", TaskTitle))`. The first
title for a task is created with `prior: []`. Renaming creates a new
`TaskTitle` with `prior: [previousTitle]`. Two concurrent edits both point
at the same prior title — creating a fork — and a later merge fact lists
*both* forked titles in `prior`, never just the one that "won". See
`authoring-jinaga-specifications-typescript` for the `.notExists(...)` query
that reads only the un-superseded value(s), and `reviewing-model-idioms`
for what goes wrong when that filter is skipped.

## Delete and restore

```typescript
export class TaskDeletion {
    static Type = "TaskTracker.Task.Deletion" as const;
    type = TaskDeletion.Type;
    constructor(public task: Task, public deletedAt: Date | string) { }
}

export class TaskRestoration {
    static Type = "TaskTracker.Task.Restoration" as const;
    type = TaskRestoration.Type;
    constructor(public taskDeletion: TaskDeletion, public restoredAt: Date | string) { }
}
```

A task is live if it has no `TaskDeletion`, or has one that itself has a
`TaskRestoration` — a nested existential, covered in
`authoring-jinaga-specifications-typescript`.

## Reconstructable key facts

A fact meant to represent an externally-presented identifier (an activation
code, a deployment-constant identifier) can be modeled so any party holding
the same inputs can rebuild the *identical* fact via `new`, with no lookup
needed — because Jinaga identifies a fact by the hash of its fields and
predecessors, not by a separate generated ID. Keep such a fact type narrow
(just the identifying fields) and hang payload data off it as a successor,
so the identifying part never needs to change.

The corollary trap: if a field is added later to a fact type that's
reconstructed this way, every reconstruction site must pass that field
identically (including `undefined` where nothing applies), or two call
sites will independently produce facts with different hashes for what was
meant to be the same fact.

## Schema evolution

Jinaga skips `undefined` fields when computing a fact's hash, so adding a
new *optional* field to an existing fact type doesn't change the hash of
facts that don't set it — `new T(a, b, undefined)` hashes identically to a
pre-existing `T`. A new required field, or a new predecessor, defines a
new, distinct fact type in every way that matters, even if the `Type`
string is unchanged, and needs an explicit decision about whether existing
facts should still match.
