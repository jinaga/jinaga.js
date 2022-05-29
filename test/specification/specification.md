# Specification

To receive information from a server, send a specification, inputs, and a bookmark.
The server will respond with all distinct members of tuples satisfying the specification and containing at least one fact learned after the bookmark.

To subscribe to a specification, send the same information.
The server will push fact references as they arrive.
The client will update its own bookmark.
It will reconnect after the connection is broken and send the last bookmark that it received.

## Given

The given section of a specification lists the labels that must be provided.
At least one label must be given.
The block immediately following the given contains a sequence of match clauses.
The block after the arrow contains a sequence of projections.

```
(user: Jinaga.User) {
    ...
} => {
    ...
}
```

## Match

A match clause adds one unknown label, and constrains it relative to prior labels.
The new label must be distinct from all prior labels in the specification.
At least one match must appear within the specification.
The block following the label contains conditions, either paths or existential.

```
assignment: ToDo.Assignment [
    ...
]
```

Both given and match define labels.

## Path Conditions

A path is a pair of labels, and the sequence of roles leading to a common ancestor.
A role is the name of a predecessor, and the expected type.
The path joins the two labels.

A path must join the unknown just introduced in the match to a label appearing earlier in the specification, whether a given or an unknown.
Multiple paths may appear in the same match.

```
assignment->user:Jinaga.User = user
```

## Existential Conditions

An existential condition is an inner specification.
It can either require that a satisfying tuple exist, or that one not exist.
The paths of a condition must use the label introduced by the containing match.
They may also use additional labels of the outer specification.

```
!E {
    revoked: ToDo.Assignment.Revocation [
        revoked->assignment:ToDo.Assignment = assignment
    ]
}
```

## Connectedness

The graph of paths must be connected.
Every label must be connected to every other label by at least one chain of paths.
Multiple chains of paths between labels are permitted; all chains will be simultaneously satisfied.

Consider each label in the given clause as defining a new cluster of labels.
Initially, each cluster contains only the one given label.
As the projection is defined, each match clause adds a new unknown label.
Each path within that clause joins the new label to a prior label.
It merges that new label into the cluster containing that prior label.

As additional paths are introduced within the match, the new label is already a member of a cluster.
If the path joins the label with one already in that cluster, then no further merging takes place.
However, if it joins the label with one in a different cluster, then the two clusters are merged.

By the end of the block of matches, there must be only one cluster.

## Projections

The block after the arrow `=>` contains a sequence of projections.
A projection finds more tuples related to a parent tuple.
It represents additional data to be fetched for members of those tuples.
The paths of a child projection may use labels defined in the earlier block.
At least one such label must be used.

```
descriptions {
    description: ToDo.Task.Description [
        description->task:ToDo.Task = task
        !E {
            next: ToDo.Task.Description [
                next->prior:ToDo.Task.Description = description
            ]
        }
    ]
}
```

## Tuples

The result of a specification is a set of tuples.
Each member of a tuple is a labeled fact.
The group of facts in the tuple are consistent with the paths and existential conditions.

A tuple consisting only of outer unknowns will be produced for each consistent group, regardless of whether any inner tuples exist.
Inner tuples will include all unknowns from the outer projection.

If a tuple causes a not-exists existential condition to be false, the tuple will nevertheless be produced.
However, children produced by projections will not be produced.
Only the paths up to the point of the condition are represented in the tuple.

For example, a user will learn that they their project assignment has been revoked.
However, they will not learn of tasks added to that project, nor the child tuples of descriptions of those tasks.

```
(
    user: Jinaga.User 7sBapqyHpC+fbF1yeARDNSV0kLNwPt2J1+O9bpybYuw=,
    assignment: ToDo.Assignment WukToRQ/jJbgyvHOoJ5pUVKmBOwCvGKEdnj6kc2ORaQ=,
    revoked: ToDo.Assignment.Revocation Uj1WclYk/1FTg2aUgxn1kL4XCgZMTlgzWRRtX/ICJc0=
)
(
    user: Jinaga.User 7sBapqyHpC+fbF1yeARDNSV0kLNwPt2J1+O9bpybYuw=,
    assignment: ToDo.Assignment v8V01d06GsTk5xVJ9BOYcndz0iDEzqIOXkdriOVvHA4=,
    task: ToDo.Task p/v3RzHG2Vf7GdiQwKdhfchkfLQgc+BmsJeXVdBKHeg=
)
(
    user: Jinaga.User 7sBapqyHpC+fbF1yeARDNSV0kLNwPt2J1+O9bpybYuw=,
    assignment: ToDo.Assignment v8V01d06GsTk5xVJ9BOYcndz0iDEzqIOXkdriOVvHA4=,
    task: ToDo.Task p/v3RzHG2Vf7GdiQwKdhfchkfLQgc+BmsJeXVdBKHeg=,
    description: ToDo.Task.Description GjZTL42ZMW3UBLkWQ3jkx3BEv8S+K/kymwtVantHrG0=
)
```

The server will return distinct members of tuples to the client.
It will not return the entire tuple, as that would contain a large amount of redundancy.
The client will ask the server to load the full description of facts that it does not yet know about.

## Example

```
(user: Jinaga.User) {
    assignment: ToDo.Assignment [
        assignment->user:Jinaga.User = user
        !E {
            revoked: ToDo.Assignment.Revocation [
                revoked->assignment:ToDo.Assignment = assignment
            ]
        }
    ]
    task: ToDo.Task [
        task->project:ToDo.Project = assignment->project:ToDo.Project
    ]
} => {
    descriptions {
        description: ToDo.Task.Description [
            description->task:ToDo.Task = task
            !E {
                next: ToDo.Task.Description [
                    next->prior:ToDo.Task.Description = description
                ]
            }
        ]
    }
}
```