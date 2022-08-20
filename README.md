# Jinaga

Application-agnostic back end for web applications.

Add Jinaga.JS to a React app to manage application state.
Point it to a Jinaga back end and it will persist that state to the server.

## Install

Install Jinaga.JS from the NPM package.

```bash
npm i jinaga
```

This installs both the client side and server side components.
See [jinaga.com](https://jinaga.com) for details on how to use them.

## Build

To build Jinaga.JS, you will need Node 16.

```bash
npm ci
npm run build
npm test
```

## Changes in version 3

In version 3 of Jinaga.JS, the `has` function takes two parameters.
The second is the name of the predecessor type.
In version 2, the function took only one parameter: the field name.

To upgrade, change this:

```javascript
function assignmentUser(assignment) {
  ensure(assignment).has("user");
  return j.match(assignment.user);
}
```

To this:

```javascript
function assignmentUser(assignment) {
  ensure(assignment).has("user", "Jinaga.User");
  return j.match(assignment.user);
}
```

## Running a Replicator

A Jinaga front end connects to a device called a Replicator.
The Jinaga Replicator is a single machine in a network.
It stores and shares facts.
To get started, create a Replicator of your very own using [Docker](https://www.docker.com/products/docker-desktop/).

```
docker pull jinaga/jinaga-replicator
docker run --name my-replicator -p8080:8080 jinaga/jinaga-replicator
```

This creates and starts a new container called `my-replicator`.
The container is listening at port 8080 for commands.
Configure Jinaga to use the replicator:

```typescript
import { JinagaBrowser } from "jinaga";

export const j = JinagaBrowser.create({
  httpEndpoint: "http://localhost:8080/jinaga"
});
```