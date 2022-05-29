# Projections

To send a query to the server, send a projection, inputs, and a bookmark.
The server will respond with all tuples that satisfy that projection where one of the members was learned after the bookmark.

To subscribe to a projection, send the same information.
The server will push tuples as they arrive.
The client will update its own bookmark.
It will reconnect after the connection is broken and send the last bookmark that it received.

## Inputs

An input is a named fact reference.
At least one input must be given.

```
[user: Jinaga.User 7sBapqyHpC+fbF1yeARDNSV0kLNwPt2J1+O9bpybYuw=]
```

## Unknowns

An unknown defines position within a graph.
It has a name and a type.
A projection has a collection of at least one labels.

```
(assignment: ToDo.Assignment, task: ToDo.Task) => {

}
```

Both unknowns and inputs define labels.

## Paths

A path is a pair of labels, and the sequence of roles leading to a common ancestor.
A role is the name of a predecessor, and the expected type.
The path joins the two labels.

The graph of paths must be connected.
Every label must be represented in at least one path.
Multiple paths between labels are permitted; all paths will be simultaneously satisfied.

```
assignment.user:Jinaga.User = user;
task.project:ToDo.Project = assignment.project:ToDo.Project;
```

## Conditions

A condition is a sub-query that must be satisfied by a label.
It can either require that a tuple exist, or that one not exist.
The paths of a condition may use labels from the outer projection.
At least one outer label must be used.

```
not exists (revoked: ToDo.Assignment.Revocation) => {
    revoked.assignment:ToDo.Assignment = assignment
}
```

## Child Projections

A child projection continues a graph with more unknowns and paths.
It represents additional data to be fetched for members of matching tuples.
The paths of a child projection may use labels from the outer projection.
At least one outer label must be used.

```
(description: ToDo.Task.Description) => {
    description.task:ToDo.Task = task;
    not exists (next: ToDo.Task.Description) => {
        next.prior:ToDo.Task.Description = description
    }
}
```

## Tuples

The result of a projection is a set of tuples that are consistent with the paths.
Members of each tuple are fact references of the unknowns.
The inputs are not repeated in the results.

A tuple consisting only of outer unknowns will be produced for each consistent group, regardless of whether any inner tuples exist.
Inner tuples will include all unknowns from the outer projection.

If a tuple causes a not-exists existential condition to be false, the tuple will be produced.
However, children produced by child projections will not be produced.
Only the paths up to the point of the condition are represented in the tuple.

For example, a user will learn that they their project assignment has been revoked.
However, they will not learn of tasks added to that project, nor the child tuples of descriptions of those tasks.

```
[assignment: ToDo.Assignment WukToRQ/jJbgyvHOoJ5pUVKmBOwCvGKEdnj6kc2ORaQ=, revoked: ToDo.Assignment.Revocation Uj1WclYk/1FTg2aUgxn1kL4XCgZMTlgzWRRtX/ICJc0=]
[assignment: ToDo.Assignment v8V01d06GsTk5xVJ9BOYcndz0iDEzqIOXkdriOVvHA4=, task: ToDo.Task p/v3RzHG2Vf7GdiQwKdhfchkfLQgc+BmsJeXVdBKHeg=]
[assignment: ToDo.Assignment v8V01d06GsTk5xVJ9BOYcndz0iDEzqIOXkdriOVvHA4=, task: ToDo.Task p/v3RzHG2Vf7GdiQwKdhfchkfLQgc+BmsJeXVdBKHeg=, description: ToDo.Task.Description GjZTL42ZMW3UBLkWQ3jkx3BEv8S+K/kymwtVantHrG0=]
```

The server will return distinct members of tuples to the client.
It will not return the entire tuple, as that would contain a large amount of redundancy.
The client will ask the server to load the full description of facts that it does not yet know about.

## Example

```
[user: Jinaga.User 7sBapqyHpC+fbF1yeARDNSV0kLNwPt2J1+O9bpybYuw=]
(assignment: ToDo.Assignment, task: ToDo.Task) => {
    assignment.user:Jinaga.User = user;
    not exists (revoked: ToDo.Assignment.Revocation) => {
        revoked.assignment:ToDo.Assignment = assignment
    }
    task.project:ToDo.Project = assignment.project:ToDo.Project;
    (description: ToDo.Task.Description) => {
        description.task:ToDo.Task = task;
        not exists (next: ToDo.Task.Description) => {
            next.prior:ToDo.Task.Description = description
        }
    }
}
```