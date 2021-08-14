# Jinaga

Resilient, reliable, and connected web applications.

Make a change in the browser and it is automatically sent to the server, saved to the database, and shared with other users. Jinaga is journaled isolated nodes approaching global agreement.

Documentation at [Jinaga.com](https://jinaga.com).

[Contributing](contributing.md)

## Universal Back End

Install the Jinaga NPM package.

```
npm install jinaga
```

Create a server.js.

``` JavaScript
var JinagaDistributor = require("jinaga/jinaga.distributor.server");
var MongoProvider = require("jinaga/jinaga.mongo");
var url = 'mongodb://localhost:27017/dev';
var port = 8888;

var mongo = new MongoProvider(url);
JinagaDistributor.listen(mongo, mongo, port);
```

Start Mongo.

```
mongod.exe
```

Run the application.

```
node server
```

Your back end is now running. Spend the rest of your time on the front end.

## Front End

Your front end application saves facts whenever the user does something. These facts are persisted to your back end, and shared in real-time with other browsers.

Install the client-side library.

```
bower install jinaga
```

Include the script in your page.

```
<script src="bower_components/jinaga/jinaga.js"></script>
<script src="main.js"></script>
```

Create facts inside of main.js.

```JavaScript
var j = new Jinaga();
j.sync(new JinagaDistributor("ws://localhost:8888/"));

j.fact({
  type: "Task",
  list: {
    type: "TodoList",
    name: "Chores"
  },
  description: "Take out the trash"
});
```

This code actually represents two facts. The first is:

```JavaScript
var chores = {
  type: "TodoList",
  name: "Chores"
};
```

The second is:

```JavaScript
var trash = {
  type: "Task",
  list: chores,
  description: "Take out the trash"
};
```

The second fact knows about the first. That makes the first fact (**chores**) a predecessor to the second (**trash**). The order between these two is known. **Chores** will always come before **trash**. But facts with no such relationship can occur in any order.

## Watches

Now that you can express that **chores** is a predecessor of **trash**, you might want to watch for all facts with that same predecessor. These are called successors. For example, you might want to find all of the tasks on the **chores** list. Provide a template that all desired facts will fit. For example, for a given list, this template will match all tasks on that list:

```JavaScript
function tasksInList(l) {
  return {
    type: "Task",
    list: l
  };
}
```

When a fact matching the template is found, we want to call a function. We'll watch the template, and call a function when the results change.

```JavaScript
function taskAdded(task) {
  // Render the task in the UI
}

j.watch(chores, [tasksInList], taskAdded);
```

Now if I add a new task to the list, the **taskAdded** function will be called.

```JavaScript
var dishes = {
  type: "Task",
  list: chores,
  description: "Empty the dishwasher"
};

j.fact(dishes);

// taskAdded is called with the dishes fact.
```

A callback is only executed once per fact. If you happen to add the same fact again, the callback will not be invoked.

The watch is in effect for the current session. It is destroyed implicitly with the Jinaga instance when no longer in use. If you wish to explicitly stop watching, capture the return value.

```JavaScript
var watch = j.watch(chores, [tasksInList], taskAdded);

// Some time later...

watch.stop();
``` 

## Conditions

Now I want to mark a task completed. Let's capture that as another fact.

```JavaScript
j.fact({
  type: "TaskCompleted",
  task: trash,
  completed: true
});
```

Let's write a template that matches this fact for a given task.

```JavaScript
function taskIsNotCompleted(t) {
  return j.not({
    type: "TaskCompleted",
    task: t,
    completed: true
  });
}
```

Now we can write a query so that only the uncompleted tasks match the template.

```JavaScript
function uncompletedTasksInList(l) {
  return j.where({
    type: "Task",
    list: l
  }, [taskIsNotCompleted]);
}

j.watch(chores, [uncompletedTasksInList], taskAdded);
```

When this query is created, only the existing tasks that have not been completed will be added to the UI. So you will see "Empty the dishwasher", but not "Take out the trash". But what about when a task changes? We want to remove tasks from the UI once they are marked completed. So let's add another callback to the query.

```JavaScript
function taskRemoved(t) {
  // Remove the task from the UI
}

j.watch(chores, [uncompletedTasksInList], taskAdded, taskRemoved);
```

Now when you complete a task, the taskRemoved function will be called to remove it from the UI.

```JavaScript
j.fact({
  type: "TaskCompleted",
  task: dishes,
  completed: true
});

// taskRemoved is called with the dishes fact.
```

Facts are immutable, so there is no callback for updating a result. They can only be added or removed. To handle updates, please see [Mutablity](https://github.com/michaellperry/jinaga/blob/master/mutability.md).
