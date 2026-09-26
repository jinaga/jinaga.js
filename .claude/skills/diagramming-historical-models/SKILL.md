---
name: diagramming-historical-models
description: >
  Use when asked to diagram, sketch, or visualize a Jinaga fact model — the
  fact-type graph, a specification overlaid on it, or an instance graph of
  actual fact data. Produces Graphviz `dot` diagrams.
---

# Diagramming historical models

A fact-type graph is small enough to hold in your head only up to a point.
Drawing it — before or after writing the code — surfaces missing
predecessors, accidental cycles, and mutable properties that never got a
"current value" filter written for them. This skill produces Graphviz `dot`
source; render it with `dot -Tsvg` (or any Graphviz-compatible viewer) to
check it before sharing.

## Fact-type graph

Each fact type is a node; each predecessor relationship is an edge pointing
from the fact *up* to the predecessor it depends on (the direction a fact
"points back in time", not the direction data flows in a query):

```dot
digraph FactTypes {
  rankdir=BT;
  node [shape=ellipse, fontname="Helvetica"];

  User; Project; Task; TaskTitle; TaskAssignment; TaskDeletion; TaskRestoration;

  Project -> User [label="creator"];
  Task -> Project [label="project"];
  TaskTitle -> Task [label="task"];
  TaskTitle -> TaskTitle [label="prior", style=dashed];
  TaskAssignment -> Task [label="task"];
  TaskAssignment -> User [label="assignee"];
  TaskDeletion -> Task [label="task"];
  TaskRestoration -> TaskDeletion [label="taskDeletion"];
}
```

Conventions:

- **Ellipses** for fact types. No other shape is needed at this level.
- **Edges point from a fact to its predecessor**, matching the direction a
  `prior` or role reference actually points — never the direction a UI would
  read the data.
- **A self-loop with a dashed edge** (`TaskTitle -> TaskTitle`) marks a
  mutable-property pattern — the fact type that stands in for a value that
  changes over time. Spotting this shape at a glance is the point: if a
  self-loop is missing where you'd expect one, the property is probably
  still (wrongly) a mutable field.
- **Cardinality**, when it matters, goes on the edge label as a suffix:
  `assignee *` for "a task can have many assignments over time",
  `creator` alone for exactly one. Don't annotate obvious single-predecessor
  edges.

## Specification overlay

To show what a specification reads, overlay it on the same graph with dashed
edges for the walk and existential markers for filters:

```dot
digraph CurrentTitle {
  rankdir=BT;
  node [shape=ellipse, fontname="Helvetica"];

  Task; TaskTitle [label="TaskTitle\n(current: ∄ successor)"];

  TaskTitle -> Task [label="task"];
  Task -> TaskTitle [label="reads", style=dashed, color=blue];
}
```

Use `∃` in a node label for "at least one must exist" and `∄` for "must not
exist" (the current-value / not-deleted filter). Writing the symbol directly
into the label of the fact type being filtered — as above — keeps the
existential attached to the thing it constrains, rather than floating in a
caption.

## Fact instance graph

To show actual data rather than the shape of the type graph, use a
borderless HTML table per fact so field values are visible alongside the
identity:

```dot
digraph Instances {
  rankdir=BT;
  node [shape=plain, fontname="Helvetica"];

  task1 [label=<
    <table border="0" cellborder="1" cellspacing="0">
      <tr><td bgcolor="lightgray"><b>Task</b></td></tr>
      <tr><td>project: Project#a1</td></tr>
    </table>
  >];
  title1 [label=<
    <table border="0" cellborder="1" cellspacing="0">
      <tr><td bgcolor="lightgray"><b>TaskTitle</b></td></tr>
      <tr><td>value: "Draft outline"</td></tr>
      <tr><td>prior: []</td></tr>
    </table>
  >];

  title1 -> task1 [label="task"];
}
```

Reserve this form for walking through a specific example with someone — it's
too dense to use as the primary diagram for an entire model.

## When to reach for this

Diagram a model when it's non-obvious from the fact-class code alone whether
a mutable-property or delete/restore pattern is complete — the visual makes
a missing existential filter or a missing `prior` self-loop obvious in a way
scanning code often doesn't.
