/**
 * Basic Jinaga Usage Examples
 * 
 * This file demonstrates the fundamental concepts of Jinaga.js
 * including fact creation, querying, and real-time updates.
 */

import { JinagaBrowser } from "jinaga";

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

interface Comment {
  type: "Comment";
  post: Post;
  author: User;
  text: string;
  createdAt: string;
}

// Create a Jinaga instance
const j = JinagaBrowser.create({
  httpEndpoint: "http://localhost:8080/jinaga"
});

async function basicUsageExample() {
  // Create a user
  const user = await j.fact({
    type: "User",
    publicKey: "user-public-key-123"
  });

  // Create a site
  const site = await j.fact({
    type: "Site",
    creator: user,
    domain: "example.com"
  });

  // Create a post
  const post = await j.fact({
    type: "Post",
    author: user,
    site: site,
    createdAt: new Date().toISOString()
  });

  // Create a comment
  const comment = await j.fact({
    type: "Comment",
    post: post,
    author: user,
    text: "Great post!",
    createdAt: new Date().toISOString()
  });

  console.log("Created facts:", { user, site, post, comment });
}

// Query examples
async function queryExamples() {
  const user = await j.fact({
    type: "User",
    publicKey: "user-public-key-123"
  });

  // Note: In a real application, you would define these specifications
  // using the actual Jinaga API. This is a conceptual example.
  console.log("Query examples would go here with proper Jinaga API usage");
  console.log("User:", user);
}

// Real-time updates
async function watchExample() {
  const user = await j.fact({
    type: "User",
    publicKey: "user-public-key-123"
  });

  // Note: In a real application, you would define these specifications
  // using the actual Jinaga API. This is a conceptual example.
  console.log("Watch examples would go here with proper Jinaga API usage");
  console.log("User:", user);
}

// Authorization examples
async function authorizationExample() {
  // Note: In a real application, you would define these authorization rules
  // using the actual Jinaga API. This is a conceptual example.
  console.log("Authorization examples would go here with proper Jinaga API usage");
}

// Run examples
async function runExamples() {
  try {
    await basicUsageExample();
    await queryExamples();
    await authorizationExample();
    await watchExample();
  } catch (error) {
    console.error("Error running examples:", error);
  }
}

// Export for use in other files
export {
  basicUsageExample,
  queryExamples,
  watchExample,
  authorizationExample,
  runExamples
};

// Run if this file is executed directly
if (require.main === module) {
  runExamples();
}