# Getting Started with Jinaga.js

This guide will walk you through setting up Jinaga.js in your application and creating your first distributed, immutable data model.

## Prerequisites

- Node.js 12.13.0 or higher
- npm or yarn package manager
- Basic understanding of TypeScript/JavaScript
- Docker (for running a replicator)

## Installation

```bash
npm install jinaga
```

## Quick Start

### 1. Set up a Replicator

First, you'll need a Jinaga Replicator to store and sync your data:

```bash
# Pull the replicator image
docker pull jinaga/jinaga-replicator

# Run the replicator
docker run --name my-replicator -p8080:8080 jinaga/jinaga-replicator
```

### 2. Create Your First App

Create a new file `app.ts`:

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
  title: string;
  content: string;
  createdAt: string;
}

// Create a user
async function createUser() {
  const user = await j.fact({
    type: "User",
    publicKey: "user-public-key-123"
  });
  
  console.log("Created user:", user);
  return user;
}

// Create a post
async function createPost(author: User) {
  const post = await j.fact({
    type: "Post",
    author: author,
    title: "My First Post",
    content: "This is my first post using Jinaga!",
    createdAt: new Date().toISOString()
  });
  
  console.log("Created post:", post);
  return post;
}

// Query for posts
async function queryPosts(author: User) {
  const userPosts = j.for(User).match(user =>
    user.successors(Post, post => post.author)
  );
  
  const posts = await j.query(userPosts, author);
  console.log("User posts:", posts);
  return posts;
}

// Watch for changes
async function watchPosts(author: User) {
  const userPosts = j.for(User).match(user =>
    user.successors(Post, post => post.author)
  );
  
  j.watch(userPosts, author, (posts) => {
    console.log("Posts updated:", posts);
  });
}

// Run the example
async function main() {
  try {
    const user = await createUser();
    await createPost(user);
    await queryPosts(user);
    await watchPosts(user);
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
```

### 3. Run Your App

```bash
npx ts-node app.ts
```

## Core Concepts

### Facts

Facts are immutable data records that form the foundation of your data model:

```typescript
interface User {
  type: "User";           // Required: fact type
  publicKey: string;      // Your data fields
}

const user = await j.fact({
  type: "User",
  publicKey: "user-key"
});
```

### Relationships

Facts can reference other facts through predecessor relationships:

```typescript
interface Post {
  type: "Post";
  author: User;           // Reference to User fact
  title: string;
  content: string;
  createdAt: string;
}

const post = await j.fact({
  type: "Post",
  author: user,           // Reference the user fact
  title: "My Post",
  content: "Post content",
  createdAt: new Date().toISOString()
});
```

### Queries

Use specifications to query your data:

```typescript
// Find all posts by a user
const userPosts = j.for(User).match(user =>
  user.successors(Post, post => post.author)
);

const posts = await j.query(userPosts, user);
```

### Real-time Updates

Watch for changes to your data:

```typescript
j.watch(userPosts, user, (posts) => {
  console.log("Posts updated:", posts);
});
```

## Next Steps

1. **Learn about Specifications**: Read the [Specification Guide](../documentation/specification.md)
2. **Set up Authorization**: Learn about [Authorization Rules](../documentation/authorization.md)
3. **Explore Examples**: Check out the [examples directory](./) for more complex examples
4. **Read the Documentation**: Browse the [documentation directory](../documentation/) for detailed guides

## Common Patterns

### Blog Application

```typescript
interface User {
  type: "User";
  publicKey: string;
}

interface Site {
  type: "Site";
  creator: User;
  domain: string;
}

interface Post {
  type: "Post";
  author: User;
  site: Site;
  title: string;
  content: string;
  createdAt: string;
}

interface Comment {
  type: "Comment";
  post: Post;
  author: User;
  text: string;
  createdAt: string;
}

// Find all posts on a site
const sitePosts = j.for(Site).match(site =>
  site.successors(Post, post => post.site)
);

// Find all comments on a post
const postComments = j.for(Post).match(post =>
  post.successors(Comment, comment => comment.post)
);
```

### Task Management

```typescript
interface User {
  type: "User";
  publicKey: string;
}

interface Project {
  type: "Project";
  creator: User;
  name: string;
  description: string;
  createdAt: string;
}

interface Task {
  type: "Task";
  project: Project;
  assignedTo: User;
  title: string;
  description: string;
  status: "todo" | "in-progress" | "done";
  createdAt: string;
}

// Find all tasks in a project
const projectTasks = j.for(Project).match(project =>
  project.successors(Task, task => task.project)
);

// Find all tasks assigned to a user
const userTasks = j.for(User).match(user =>
  user.successors(Task, task => task.assignedTo)
);
```

## Troubleshooting

### Common Issues

1. **Connection Errors**: Make sure your replicator is running on the correct port
2. **Type Errors**: Ensure your fact types match your interface definitions
3. **Query Errors**: Check that your specification syntax is correct

### Getting Help

- Check the [documentation](../documentation/) for detailed guides
- Look at the [examples](./) for working code
- Visit [jinaga.com](https://jinaga.com) for more resources
- Open an issue on [GitHub](https://github.com/jinaga/jinaga.js/issues) if you need help