# Jinaga.js API Reference

This document provides a comprehensive reference for the Jinaga.js API, including all classes, methods, and types.

## Table of Contents

- [Core Classes](#core-classes)
- [Main Methods](#main-methods)
- [Specification API](#specification-api)
- [Data Types](#data-types)
- [Configuration](#configuration)
- [Examples](#examples)

## Core Classes

### JinagaBrowser

The main entry point for browser applications.

```typescript
class JinagaBrowser {
  static create(config: JinagaBrowserConfig): JinagaBrowser;
  
  fact<T>(fact: T): Promise<T>;
  query<T>(specification: Specification<T>, inputs: any[]): Promise<T[]>;
  watch<T>(specification: Specification<T>, inputs: any[], callback: (results: T[]) => void): () => void;
  stop(): void;
}
```

#### Configuration

```typescript
interface JinagaBrowserConfig {
  httpEndpoint: string;
  offline?: boolean;
  authenticationProvider?: AuthenticationProvider;
  timeoutSeconds?: number;
}
```

#### Example

```typescript
import { JinagaBrowser } from "jinaga";

const j = JinagaBrowser.create({
  httpEndpoint: "http://localhost:8080/jinaga",
  offline: true,
  timeoutSeconds: 30
});
```

### JinagaServer

Server-side Jinaga instance for Node.js applications.

```typescript
class JinagaServer {
  static create(config: JinagaServerConfig): JinagaServer;
  
  fact<T>(fact: T): Promise<T>;
  query<T>(specification: Specification<T>, inputs: any[]): Promise<T[]>;
  watch<T>(specification: Specification<T>, inputs: any[], callback: (results: T[]) => void): () => void;
}
```

#### Configuration

```typescript
interface JinagaServerConfig {
  store: FactStore;
  authorizationRules: AuthorizationRule[];
}
```

#### Example

```typescript
import { JinagaServer } from "jinaga";

const j = JinagaServer.create({
  store: myFactStore,
  authorizationRules: [postAuthorization, commentAuthorization]
});
```

## Main Methods

### j.fact(fact)

Create a new immutable fact.

```typescript
const user = await j.fact({
  type: "User",
  publicKey: "user-key"
});
```

**Parameters:**
- `fact: T` - The fact object to create

**Returns:** `Promise<T>` - The created fact with computed hash

**Example:**
```typescript
interface User {
  type: "User";
  publicKey: string;
}

const user = await j.fact({
  type: "User",
  publicKey: "user-public-key-123"
});
```

### j.query(specification, inputs)

Execute a query specification.

```typescript
const posts = await j.query(userPosts, user);
```

**Parameters:**
- `specification: Specification<T>` - The query specification
- `inputs: any[]` - Input facts for the specification

**Returns:** `Promise<T[]>` - Array of matching results

**Example:**
```typescript
const userPosts = j.for(User).match(user =>
  user.successors(Post, post => post.author)
);

const posts = await j.query(userPosts, user);
```

### j.watch(specification, inputs, callback)

Watch for changes to a query specification.

```typescript
const stopWatching = j.watch(userPosts, user, (posts) => {
  console.log("Posts updated:", posts);
});
```

**Parameters:**
- `specification: Specification<T>` - The query specification
- `inputs: any[]` - Input facts for the specification
- `callback: (results: T[]) => void` - Callback function for updates

**Returns:** `() => void` - Function to stop watching

**Example:**
```typescript
const stopWatching = j.watch(userPosts, user, (posts) => {
  updateUI(posts);
});

// Later, stop watching
stopWatching();
```

## Specification API

### j.for(Type).match(callback)

Create a specification for a given fact type.

```typescript
const specification = j.for(User).match(user => {
  // match clauses
});
```

**Parameters:**
- `Type` - The fact type to match
- `callback` - Function defining the match logic

**Returns:** `Specification<T>` - The specification object

**Example:**
```typescript
const userPosts = j.for(User).match(user =>
  user.successors(Post, post => post.author)
);
```

### successors(Type, relationship)

Find facts that are successors of the current fact.

```typescript
user.successors(Post, post => post.author)
```

**Parameters:**
- `Type` - The successor fact type
- `relationship` - Function defining the relationship

**Returns:** `Specification<T>` - Specification for successors

**Example:**
```typescript
const posts = user.successors(Post, post => post.author);
```

### predecessor()

Navigate to the predecessor of the current fact.

```typescript
post.author.predecessor()
```

**Returns:** `Specification<T>` - Specification for predecessor

**Example:**
```typescript
const author = post.author.predecessor();
```

### select(projection)

Transform the results of a specification.

```typescript
user.successors(Post, post => post.author)
  .select(post => ({
    title: post.title,
    createdAt: post.createdAt
  }))
```

**Parameters:**
- `projection` - Function to transform results

**Returns:** `Specification<T>` - Specification with projection

**Example:**
```typescript
const postTitles = user.successors(Post, post => post.author)
  .select(post => post.title);
```

### selectMany(projection)

Flatten collections in results.

```typescript
company.successors(Office, office => office.company)
  .selectMany(office => 
    office.successors(Employee, employee => employee.office)
      .select(employee => employee.name)
  )
```

**Parameters:**
- `projection` - Function returning a collection

**Returns:** `Specification<T>` - Specification with flattened results

**Example:**
```typescript
const allEmployeeNames = company.successors(Office, office => office.company)
  .selectMany(office => 
    office.successors(Employee, employee => employee.office)
      .select(employee => employee.name)
  );
```

### exists(condition)

Add an existential condition to a specification.

```typescript
user.successors(Post, post => post.author)
  .exists(post => post.successors(Comment, comment => comment.post))
```

**Parameters:**
- `condition` - Function defining the existential condition

**Returns:** `Specification<T>` - Specification with condition

**Example:**
```typescript
const postsWithComments = user.successors(Post, post => post.author)
  .exists(post => post.successors(Comment, comment => comment.post));
```

## Data Types

### Fact

All facts must have a `type` property and can reference other facts.

```typescript
interface Fact {
  type: string;
  [key: string]: any;
}
```

**Example:**
```typescript
interface User extends Fact {
  type: "User";
  publicKey: string;
}

interface Post extends Fact {
  type: "Post";
  author: User;
  title: string;
  content: string;
  createdAt: string;
}
```

### FactReference

A reference to a fact by type and hash.

```typescript
interface FactReference {
  type: string;
  hash: string;
}
```

### Specification

A query specification that can be executed or watched.

```typescript
interface Specification<T> {
  // Internal specification structure
}
```

## Configuration

### JinagaBrowserConfig

Configuration options for browser applications.

```typescript
interface JinagaBrowserConfig {
  httpEndpoint: string;                    // Required: Replicator endpoint
  offline?: boolean;                       // Optional: Enable offline mode
  authenticationProvider?: AuthenticationProvider; // Optional: Auth provider
  timeoutSeconds?: number;                 // Optional: Request timeout
}
```

### JinagaServerConfig

Configuration options for server applications.

```typescript
interface JinagaServerConfig {
  store: FactStore;                        // Required: Fact storage
  authorizationRules: AuthorizationRule[]; // Required: Authorization rules
}
```

## Examples

### Basic Usage

```typescript
import { JinagaBrowser } from "jinaga";

// Create instance
const j = JinagaBrowser.create({
  httpEndpoint: "http://localhost:8080/jinaga"
});

// Define data model
interface User {
  type: "User";
  publicKey: string;
}

interface Post {
  type: "Post";
  author: User;
  title: string;
  content: string;
  createdAt: string;
}

// Create facts
const user = await j.fact({
  type: "User",
  publicKey: "user-key"
});

const post = await j.fact({
  type: "Post",
  author: user,
  title: "My Post",
  content: "Post content",
  createdAt: new Date().toISOString()
});

// Query facts
const userPosts = j.for(User).match(user =>
  user.successors(Post, post => post.author)
);

const posts = await j.query(userPosts, user);

// Watch for changes
j.watch(userPosts, user, (posts) => {
  console.log("Posts updated:", posts);
});
```

### Complex Queries

```typescript
// Find posts with their comments
const postsWithComments = j.for(User).match(user =>
  user.successors(Post, post => post.author)
    .select(post => ({
      post: post,
      comments: post.successors(Comment, comment => comment.post)
        .select(comment => ({
          comment: comment,
          author: comment.author
        }))
    }))
);

// Find posts that have comments
const postsWithComments = j.for(User).match(user =>
  user.successors(Post, post => post.author)
    .exists(post => post.successors(Comment, comment => comment.post))
);
```

### Authorization

```typescript
// Define authorization rules
const postAuthorization = j.for(Post).match(post =>
  post.site.creator
);

const commentAuthorization = j.for(Comment).match(comment =>
  comment.author
);
```

## Error Handling

Jinaga methods can throw errors in various scenarios:

```typescript
try {
  const user = await j.fact({
    type: "User",
    publicKey: "user-key"
  });
} catch (error) {
  if (error instanceof NetworkError) {
    console.error("Network error:", error.message);
  } else if (error instanceof AuthorizationError) {
    console.error("Authorization error:", error.message);
  } else {
    console.error("Unexpected error:", error);
  }
}
```

## Performance Considerations

- Use `select()` to limit returned data
- Use `selectMany()` for flattened collections
- Consider pagination for large result sets
- Use `exists()` conditions to filter results early
- Cache specifications when possible

## TypeScript Support

Jinaga.js is written in TypeScript and provides full type safety:

```typescript
// Type-safe fact creation
const user: User = await j.fact({
  type: "User",
  publicKey: "user-key"
});

// Type-safe queries
const posts: Post[] = await j.query(userPosts, user);

// Type-safe watching
j.watch(userPosts, user, (posts: Post[]) => {
  // posts is properly typed
});
```