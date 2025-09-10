import { describeSpecification, DistributionEngine, DistributionRules } from "@src";
import { Blog, model, Post, Publish } from "../blogModel";

const postsInBlog = model.given(Blog).match(blog =>
    blog.successors(Post, post => post.blog)
);

const nonPublishedPostsInBlog = model.given(Blog).match(blog =>
    blog.successors(Post, post => post.blog)
        .notExists(post => post.successors(Publish, publish => publish.post))
);

const blogCreator = model.given(Blog).match(blog => blog.creator.predecessor());

describe("Distribution engine feeds", () => {
    it("should return a simple feed if allowed for everyone", () => {
        const distribution = (d: DistributionRules) => d
            .share(postsInBlog)
            .withEveryone();

        const engine = new DistributionEngine(distribution(new DistributionRules([])));

        const namedStart = {};
        const feeds = engine.getFeeds(postsInBlog.specification, namedStart, null);
        expect(feeds).toHaveLength(1);
        expect("\n" + describeSpecification(feeds[0], 3).trimEnd()).toBe(`
            (p1: Blog) {
                u1: Post [
                    u1->blog: Blog = p1
                ]
            }`
        )
    });

    it("should return two feeds for existential specification if allowed for everyone", () => {
        const distribution = (d: DistributionRules) => d
            .share(nonPublishedPostsInBlog)
            .withEveryone();

        const engine = new DistributionEngine(distribution(new DistributionRules([])));

        const namedStart = {};
        const feeds = engine.getFeeds(nonPublishedPostsInBlog.specification, namedStart, null);
        expect(feeds).toHaveLength(2);
        expect("\n" + describeSpecification(feeds[0], 3).trimEnd()).toBe(`
            (p1: Blog) {
                u1: Post [
                    u1->blog: Blog = p1
                ]
                u2: Publish [
                    u2->post: Post = u1
                ]
            }`
        );
        expect("\n" + describeSpecification(feeds[1], 3).trimEnd()).toBe(`
            (p1: Blog) {
                u1: Post [
                    u1->blog: Blog = p1
                    !E {
                        u2: Publish [
                            u2->post: Post = u1
                        ]
                    }
                ]
            }`
        );
    });

    it("should return an intersected feed if allowed for predecessor", () => {
        const distribution = (d: DistributionRules) => d
            .share(postsInBlog)
            .with(blogCreator);

        const engine = new DistributionEngine(distribution(new DistributionRules([])));

        const namedStart = {};
        const feeds = engine.getFeeds(postsInBlog.specification, namedStart, null);
        expect(feeds).toHaveLength(1);
        expect("\n" + describeSpecification(feeds[0], 3).trimEnd()).toBe(`
            (p1: Blog, distributionUser: Jinaga.User [
                E {
                    dist_u1: Jinaga.User [
                        dist_u1 = p1->creator: Jinaga.User
                        dist_u1 = distributionUser
                    ]
                }
            ]) {
                u1: Post [
                    u1->blog: Blog = p1
                ]
            }`
        )
    });
});
