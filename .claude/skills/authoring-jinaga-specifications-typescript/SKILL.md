---
name: authoring-jinaga-specifications-typescript
description: >
  Use when writing or editing a Jinaga specification in TypeScript —
  querying facts, projecting fields, filtering to the current value of a
  mutable property, or wiring a specification to `j.query()` / `j.watch()`.
---

# Authoring Jinaga specifications in TypeScript

Specifications are declarative queries over the fact graph, built with
`model.given(T).match(...)` and run with `j.query()` (one-shot) or
`j.watch()`/`j.subscribe()` (live).

## Basic shape

```typescript
export const currentTitle = model.given(Task).match(task =>
    task.successors(TaskTitle, title => title.task)
        .notExists(title => title.successors(TaskTitle, next => next.prior))
        .select(title => title.value)
);
```

Inside `match`, the given fact (`task`) arrives typed as `LabelOf<Task>`,
not a plain `Task` — a proxy that knows how to walk the graph, not the
fact's own field values directly. `.successors(FactClass, selector)` walks
forward from a label to everything that points back at it; the selector
tells the query which predecessor role to walk, since a fact type can have
more than one predecessor of the same class.

## Reading the current value of a mutable property

`.notExists(title => title.successors(TaskTitle, next => next.prior))` is
the existential filter that excludes any fact something else lists in its
`prior` array — this is how "the current title" is expressed, and it's the
filter `reviewing-model-idioms` calls out as the one most often missing.
Apply it at every point a mutable-property fact type is read, not just once
somewhere in the file — a second read site that omits it will return every
historical value, not just the current one. The matching positive form is
`.exists(...)`, for "at least one must be present" conditions.

## Delete/restore as a nested existential

```typescript
export const liveTasks = model.given(Project).match((project, facts) =>
    facts.ofType(Task)
        .join(task => task.project, project)
        .notExists(task => facts.ofType(TaskDeletion)
            .join(deletion => deletion.task, task)
            .notExists(deletion => facts.ofType(TaskRestoration)
                .join(restoration => restoration.taskDeletion, deletion)))
);
```

Read this from the inside out: a `TaskDeletion` doesn't count against a
task if it has itself been restored. `match`'s second parameter,
`facts: FactRepository`, is available whenever the query needs to start
from a type other than the given (`facts.ofType(X).join(...)` instead of
walking `.successors()` off the given directly) — the static-helper idiom
in `authoring-jinaga-facts-typescript` uses `.successors()` for the common
case; reach for `facts.ofType(...).join(...)` when a query needs to compose
multiple independent walks like this one does.

## Predecessors must be reached through `.predecessor()`, never projected directly

Projecting a predecessor field straight off a label — `task.project` inside
a `.select(...)` or as a bare match result — throws at the point the
specification is built, not later at query time. Reach the predecessor
explicitly first:

```typescript
export const projectOf = model.given(Task).match(task =>
    task.project.predecessor().select(project => project.createdAt)
);
```

For a to-many relationship reached this way, `.selectMany(...)` flattens
instead of nesting — use it when a selector itself returns a `Traversal`
(another walk), not a plain value.

## Projections combine multiple relations in one round trip

```typescript
export const projectSummary = model.given(Project).match(project =>
    Task.in(project).select(task => ({
        task,
        currentTitle: TaskTitle.current(task).select(t => t.value),
    }))
);
```

Prefer one specification that projects everything a view needs over several
separate queries — each `j.query()`/`j.watch()` call is its own round trip.
Select the fact itself (`task`, not a computed field) when the caller needs
its identity — `Jinaga.hash(...)` only makes sense against a real,
materialized fact returned from a query, never against the `LabelOf<T>`
proxy a selector callback receives while the specification is being built;
the type system won't let a proxy through to `Jinaga.hash` by accident, but
it's worth knowing why, since the error it gives at that point isn't an
obviously-relevant one.

## Operate on the set, not the first element

Specifications describe relationships and shape; they don't sort, count, or
pick a single element by position. Once a query result is materialized in
TypeScript (`await j.query(spec, given)`), that's where sorting, taking the
first of a set, or comparing by identity (`Jinaga.hash(a) === Jinaga.hash(b)`,
never `a === b` — a query always returns a fresh object) belongs — not
inside `match`.
