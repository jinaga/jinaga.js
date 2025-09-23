# Jinaga

[![npm version](https://badge.fury.io/js/jinaga.svg)](https://badge.fury.io/js/jinaga)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](http://www.typescriptlang.org/)

End-to-end application state management framework for web and mobile applications.

Jinaga provides a distributed, immutable data model where facts are connected in a directed acyclic graph (DAG). Add Jinaga.JS to a client app and point it at a Replicator. Updates are sent to the Replicator as the user works with the app. Any changes that the app needs are pulled from the Replicator.

## Version Information

- **Current Version**: 6.7.9
- **Node.js Support**: ^12.13.0 || ^14.15.0 || ^16.10.0 || >=17.0.0
- **TypeScript**: Full TypeScript support with type definitions included
- **License**: MIT

## Key Features

- **Immutable Facts**: All data is represented as immutable facts with cryptographic hashes
- **Distributed Architecture**: Works offline and syncs when connected
- **Type-Safe Queries**: Declarative specifications with full TypeScript support
- **Real-time Updates**: Reactive data watching with automatic updates
- **Cryptographic Integrity**: Digital signatures ensure data authenticity

## Quick Start

### Installation

Install Jinaga.JS from the NPM package.

```bash
npm i jinaga
```

This installs just the client side components. See [jinaga.com](https://jinaga.com) for details on how to use them.

### Basic Usage

```typescript
import { JinagaBrowser } from "jinaga";

// Create a Jinaga instance
const j = JinagaBrowser.create({
  httpEndpoint: "http://localhost:8080/jinaga"
});

// Define your data model
interface User {
  type: "User";
  publicKey: string;
}

interface Post {
  type: "Post";
  author: User;
  site: Site;
  createdAt: string;
}

interface Site {
  type: "Site";
  creator: User;
  domain: string;
}

// Create facts
const user = await j.fact({
  type: "User",
  publicKey: "user-public-key"
});

const site = await j.fact({
  type: "Site",
  creator: user,
  domain: "example.com"
});

const post = await j.fact({
  type: "Post",
  author: user,
  site: site,
  createdAt: new Date().toISOString()
});

// Query for data
const posts = await j.query(specification, user);
```

### Querying with Specifications

```typescript
// Define a specification to find all posts by a user
const userPosts = j.for(User).match(user =>
  user.successors(Post, post => post.author)
);

// Execute the query
const posts = await j.query(userPosts, user);
```

### Real-time Updates

```typescript
// Watch for changes
j.watch(userPosts, user, (posts) => {
  console.log("Posts updated:", posts);
});
```

## Advanced Examples

### Complex Queries with Projections

```typescript
// Find all posts with their authors and comments
const postsWithDetails = j.for(User).match(user =>
  user.successors(Post, post => post.author)
    .select(post => ({
      post: post,
      author: post.author,
      comments: post.successors(Comment, comment => comment.post)
        .select(comment => ({
          comment: comment,
          author: comment.author
        }))
    }))
);
```

### Authorization Rules

```typescript
// Define who can create posts
const postAuthorization = j.for(Post).match(post =>
  post.site.creator
);

// Define who can create comments
const commentAuthorization = j.for(Comment).match(comment =>
  comment.author
);
```

### Offline Support

```typescript
// Jinaga automatically handles offline scenarios
const j = JinagaBrowser.create({
  httpEndpoint: "http://localhost:8080/jinaga",
  offline: true  // Enable offline mode
});

// Facts created offline will sync when connection is restored
const offlinePost = await j.fact({
  type: "Post",
  author: user,
  site: site,
  createdAt: new Date().toISOString()
});
```

## Running a Replicator

A Jinaga front end connects to a device called a Replicator. The Jinaga Replicator is a single machine in a network that stores and shares facts. To get started, create a Replicator of your very own using [Docker](https://www.docker.com/products/docker-desktop/).

### Quick Setup

```bash
# Pull the replicator image
docker pull jinaga/jinaga-replicator

# Run the replicator
docker run --name my-replicator -p8080:8080 jinaga/jinaga-replicator
```

This creates and starts a new container called `my-replicator` listening at port 8080 for commands.

### Configure Your App

```typescript
import { JinagaBrowser } from "jinaga";

export const j = JinagaBrowser.create({
  httpEndpoint: "http://localhost:8080/jinaga"
});
```

### Production Setup

For production deployments, you'll need to configure authentication and persistence. See the [Jinaga documentation](https://jinaga.com) for detailed setup instructions.

## API Reference

### Core Classes

#### `JinagaBrowser`
The main entry point for browser applications.

```typescript
const j = JinagaBrowser.create({
  httpEndpoint: string;
  offline?: boolean;
  authenticationProvider?: AuthenticationProvider;
});
```

#### `JinagaServer`
Server-side Jinaga instance for Node.js applications.

```typescript
const j = JinagaServer.create({
  store: FactStore;
  authorizationRules: AuthorizationRule[];
});
```

### Key Methods

#### `j.fact(fact)`
Create a new immutable fact.

```typescript
const user = await j.fact({
  type: "User",
  publicKey: "key"
});
```

#### `j.query(specification, inputs)`
Execute a query specification.

```typescript
const posts = await j.query(userPosts, user);
```

#### `j.watch(specification, inputs, callback)`
Watch for changes to a query.

```typescript
j.watch(userPosts, user, (posts) => {
  console.log("Updated posts:", posts);
});
```

### Specification API

#### `j.for(Type).match(callback)`
Create a specification for a given fact type.

```typescript
const userPosts = j.for(User).match(user =>
  user.successors(Post, post => post.author)
);
```

#### `successors(Type, relationship)`
Find facts that are successors of the current fact.

```typescript
user.successors(Post, post => post.author)
```

#### `predecessor()`
Navigate to the predecessor of the current fact.

```typescript
post.author.predecessor()
```

## Documentation

- [API Reference](docs/api-reference.md) - Complete API documentation
- [Getting Started Guide](examples/getting-started.md) - Step-by-step tutorial
- [Specification Guide](documentation/specification.md) - Learn how to write queries
- [Authorization](documentation/authorization.md) - Set up access control
- [Feeds Architecture](documentation/feeds.md) - Understand the data synchronization system
- [Graph Protocol](documentation/graph-protocol.md) - Learn about the wire format

## Examples

Check out the [examples directory](examples/) for complete working examples.

## Breaking Changes

If you are upgrading from an older version, you may need to update your code.

### Changes in version 4.0.0

In version 4.0.0, the server side code has been moved to a separate package.
This allows you to build a client using Create React App and connect it to a Replicator.

When upgrading, take the following steps:
- Install the `jinaga-server` package.
- Remove the 'jinaga' alias from 'webpack.config.js'.
- Import `JinagaServer` from 'jinaga-server'.
- Rename any references of `Specification<T>` to `SpecificationOf<T>`, and `Condition<T>` to `ConditionOf<T>`. These are used as return types of specification functions. It is uncommon to be explicit about them.

### Changes in version 3.1.0

The name of the client-side script changed from `jinaga.js` to `jinaga-client.js`.
In `webpack.config.js`, update the `jinaga` alias from `jinaga/dist/jinaga` to `jinaga/dist/jinaga-client`.

### Changes in version 3.0.0

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

## Build

To build Jinaga.JS, you will need Node 16.

```bash
npm ci
npm run build
npm test
```

## Release

To release a new version of Jinaga.JS, bump the version number, create and push a tag,
and create a release. The GitHub Actions workflow will build and publish the package.

```bash
git c main
git pull
npm version patch
git push --follow-tags
gh release create v$(node -p "require('./package.json').version") --generate-notes --verify-tag
```