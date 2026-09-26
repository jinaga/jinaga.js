---
name: designing-historical-models
description: >
  Use when modeling a domain as facts before writing any code — deciding what
  the fact types are, how they relate, and how something that changes over
  time (a title, a status, a membership) should be represented. Language- and
  framework-agnostic; applies equally before Jinaga.NET or Jinaga JS code
  exists.
---

# Designing historical models

A Jinaga application stores a graph of immutable facts — never rows that get
updated in place. Modeling well here is what makes everything downstream
(specifications, tests, UI) simple; modeling badly here is what makes all of
it fight you. This skill is the first thing to reach for, before any
fact-class or record syntax is written.

## Model decisions, not state

A fact records that something happened, not what something currently *is*.
"The task was assigned to Alex" is a decision worth a fact. "The task's
`assignee` field is `Alex`" is state — and state is exactly what Jinaga
facts can't hold, because nothing can ever mutate one.

Ask "what decision does this represent, and who made it?" before naming a
fact type. If the honest answer is "nothing decided this, it's just a
snapshot of a field," that's a sign that a mutable-state design has crept in
— see [Mutable properties](#mutable-properties) below.

## Predecessors express causality, not just structure

Every fact (except a root) points backward at the fact(s) that had to exist
before it could be created — its predecessors. `TaskAssignment` points at the
`Task` it assigns and the `User` it assigns to, because an assignment can't
exist before either does. Draw the arrow for every predecessor and ask "could
this fact really have been created before that one?" A predecessor arrow
that isn't a real causal dependency is usually a sign the fact type is
modeling two decisions as one.

## Mutable properties

Something that changes over time — a title, a due date, a priority — is
still never mutated. It's modeled as its own fact type, and a change is a
*new* fact pointing at the fact(s) it replaces:

```
TaskTitle(task: Task, value: string, prior: TaskTitle[])
```

The first title for a task has `prior: []`. Renaming creates a new
`TaskTitle` with `prior: [previousTitle]`. Reading "the current title" means
finding every `TaskTitle` for the task that nothing else lists in its
`prior` — see `reviewing-model-idioms` for why forgetting this filter is the
single most common defect in a historical model, and the per-language
`authoring-jinaga-specifications-*` skill for how to write that filter.

`prior` is an array, not a single reference, because two people can edit
concurrently — both new titles point at the same prior one, and a later fact
can merge the fork by listing both as `prior`. Never design a mutable
property as a single scalar field on the owning fact; it can't represent
concurrent edits and it can't be filtered to "current" the same way.

## Workflow and lifecycle

Resist a `status` or `state` field entirely — "in progress", "done",
"archived" are decisions, not state, and each deserves its own fact type
(`TaskCompletion(task: Task, completedAt: DateTime)`). The *current* status
of a task is then a question you answer by querying which decision facts
exist for it, not a field you read. This also means new lifecycle states can
be added later without migrating existing facts — a fact type is additive,
never a change to an enum.

## Delete and restore

Deletion is a fact too, not a removal:

```
TaskDeletion(task: Task, deletedAt: DateTime)
TaskRestoration(taskDeletion: TaskDeletion, restoredAt: DateTime)
```

A task is "live" if it has no `TaskDeletion` — or has one, but that deletion
itself has a `TaskRestoration`. This nested existential (a filter inside a
filter) is the shape every delete/restore pair takes; see
`diagramming-historical-models` for how to draw it and
`reviewing-model-idioms` for the half-implemented version of this pattern to
watch for.

## Naming

Name a fact type for the decision it records, not the table it resembles:
`TaskAssignment`, not `TaskAssignee`. Avoid generic names that hide what a
collection actually represents — `items`, `results`, `data` on a projection,
or a plural of a *property* (`statuses`) where the plural of the *entity*
(`taskCompletions`) is what's actually being grouped. A reviewer reading the
name alone should be able to guess the shape without opening the definition.

## A data-first loop

Before writing specifications or code: pick two or three real examples of
the data this model needs to hold, and check that a fact graph exists that
represents them, by hand, before generalizing. A model derived from real
examples surfaces missing predecessors and ambiguous cardinality early; a
model designed abstractly first tends to hide those problems until real data
arrives.
