import { Jinaga, JinagaTest, User, buildModel, ModelBuilder } from "@src";

/**
 * Test demonstrating the bug with hard-coded resultSubset: [] in createSelfInverse
 * 
 * This test reproduces the scenario where self-inverses incorrectly track removals
 * due to using an empty resultSubset instead of the proper context.resultSubset.
 * 
 * The bug manifests as:
 * 1. All self-inverse removals get the same hash (empty object hash)
 * 2. Only the last removal function is stored, others are overwritten
 * 3. Wrong removal functions are called when facts are deleted
 */

// Simple blog model for testing
export class Blog {
    static Type = "Blog" as const;
    type = Blog.Type;
    constructor(
        public creator: User,
        public domain: string
    ) { }
}

export class Post {
    static Type = "Post" as const;
    type = Post.Type;
    constructor(
        public blog: Blog,
        public author: User,
        public title: string,
        public content: string,
        public createdAt: Date | string
    ) { }
}

export class PostDeleted {
    static Type = "Post.Deleted" as const;
    type = PostDeleted.Type;
    constructor(
        public post: Post
    ) { }
}

const blogModel = (m: ModelBuilder) => m
    .type(User)
    .type(Blog, f => f
        .predecessor("creator", User)
    )
    .type(Post, f => f
        .predecessor("blog", Blog)
        .predecessor("author", User)
    )
    .type(PostDeleted, f => f
        .predecessor("post", Post)
    );

export const model = buildModel(blogModel);

describe("Self-Inverse ResultSubset Bug", () => {
    let j: Jinaga;
    let user: User;
    let blog: Blog;

    beforeEach(() => {
        user = new User("--- PUBLIC KEY GOES HERE ---");
        blog = new Blog(user, "test-blog.com");
    });

    it("should demonstrate incorrect removal tracking with hard-coded resultSubset", async () => {
        /**
         * Test Scenario:
         * 1. Create blog and multiple posts
         * 2. Subscribe to posts by user (triggers self-inverse)
         * 3. Delete posts one by one
         * 4. Verify that removal tracking works correctly
         * 
         * The bug: Self-inverse uses resultSubset: [] instead of context.resultSubset
         * This causes all removal functions to have the same hash (empty object hash)
         * Result: Wrong removal functions are called or removals fail entirely
         */
        
        // Create initial state with blog but no posts
        j = JinagaTest.create({
            initialState: [user, blog]
        });

        // Create posts after subscription (this triggers the self-inverse)
        const post1 = new Post(blog, user, "First Post", "Content 1", new Date());
        const post2 = new Post(blog, user, "Second Post", "Content 2", new Date());
        const post3 = new Post(blog, user, "Third Post", "Content 3", new Date());

        // Track which posts are added and removed
        const addedPosts: string[] = [];
        const removedPosts: string[] = [];
        const removalFunctions: Map<string, () => Promise<void>> = new Map();

        // Subscribe to posts by user - this creates a self-inverse
        const postsSpec = model.given(User).match((user, facts) =>
            facts.ofType(Post)
                .join(post => post.author, user)
                .select(post => ({
                    title: post.title,
                    content: post.content,
                    createdAt: post.createdAt
                }))
        );

        const observer = j.watch(postsSpec, user, async (post) => {
            addedPosts.push(post.title);
            console.log(`Added post: ${post.title}`);
            
            // Return removal function
            return async () => {
                removedPosts.push(post.title);
                console.log(`Removed post: ${post.title}`);
            };
        });

        // Wait for initial load
        await observer.loaded();

        // Add posts one by one
        await j.fact(post1);
        await j.fact(post2);
        await j.fact(post3);

        // Wait for all additions to be processed
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify all posts were added
        expect(addedPosts).toContain("First Post");
        expect(addedPosts).toContain("Second Post");
        expect(addedPosts).toContain("Third Post");
        expect(addedPosts).toHaveLength(3);

        // Now delete posts one by one
        // This is where the bug manifests - self-inverse removals use wrong hash
        const delete1 = new PostDeleted(post1);
        const delete2 = new PostDeleted(post2);
        const delete3 = new PostDeleted(post3);

        await j.fact(delete1);
        await j.fact(delete2);
        await j.fact(delete3);

        // Wait for all deletions to be processed
        await new Promise(resolve => setTimeout(resolve, 100));

        // With the bug: removedPosts might be empty or contain wrong posts
        // With the fix: removedPosts should contain all three posts
        console.log("Added posts:", addedPosts);
        console.log("Removed posts:", removedPosts);

        // This assertion will fail with the current buggy implementation
        // because self-inverse uses resultSubset: [] causing hash collisions
        expect(removedPosts).toContain("First Post");
        expect(removedPosts).toContain("Second Post");
        expect(removedPosts).toContain("Third Post");
        expect(removedPosts).toHaveLength(3);

        observer.stop();
    });

    it("should demonstrate hash collision in removal tracking", async () => {
        /**
         * This test specifically demonstrates the hash collision issue:
         * 
         * With resultSubset: [] (buggy):
         * - computeTupleSubsetHash(tuple, []) always returns same hash
         * - All removal functions stored under same key
         * - Only last one survives, others overwritten
         * 
         * With resultSubset: context.resultSubset (correct):
         * - computeTupleSubsetHash(tuple, ["user", "post"]) returns unique hashes
         * - Each removal function stored under unique key
         * - All removals work correctly
         */
        
        j = JinagaTest.create({
            initialState: [user, blog]
        });

        const post1 = new Post(blog, user, "Post 1", "Content 1", new Date());
        const post2 = new Post(blog, user, "Post 2", "Content 2", new Date());

        const removalCalls: string[] = [];

        const postsSpec = model.given(User).match((user, facts) =>
            facts.ofType(Post)
                .join(post => post.author, user)
                .select(post => ({
                    title: post.title,
                    content: post.content
                }))
        );

        const observer = j.watch(postsSpec, user, async (post) => {
            console.log(`Setting up removal for: ${post.title}`);
            
            return async () => {
                removalCalls.push(post.title);
                console.log(`Removal function called for: ${post.title}`);
            };
        });

        await observer.loaded();

        // Add both posts
        await j.fact(post1);
        await j.fact(post2);

        await new Promise(resolve => setTimeout(resolve, 100));

        // Delete first post
        await j.fact(new PostDeleted(post1));
        await new Promise(resolve => setTimeout(resolve, 100));

        // Delete second post  
        await j.fact(new PostDeleted(post2));
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log("Removal calls made:", removalCalls);

        // With the bug: removalCalls might be empty or only contain one post
        // With the fix: removalCalls should contain both posts
        expect(removalCalls).toContain("Post 1");
        expect(removalCalls).toContain("Post 2");
        expect(removalCalls).toHaveLength(2);

        observer.stop();
    });
});
