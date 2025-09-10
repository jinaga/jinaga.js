import { describeSpecification, DistributionEngine, DistributionRules } from "@src";
import { Blog, model, Post } from "../blogModel";

const postsInBlog = model.given(Blog).match(blog =>
    blog.successors(Post, post => post.blog)
);

describe("Distribution engine feeds", () => {
    it("should return a simple feed if allowed for everyone", () => {
        const distribution = (d: DistributionRules) => d
            .share(postsInBlog)
            .withEveryone();

        const engine = new DistributionEngine(distribution(new DistributionRules([])));
        const specification = postsInBlog;

        const feeds = engine.getFeeds(specification.specification, null);
        expect(feeds).toHaveLength(1);
        expect("\n" + describeSpecification(feeds[0], 3).trimEnd()).toBe(`
            (p1: Blog) {
                u1: Post [
                    u1->blog: Blog = p1
                ]
            } => u1`
        )
    });
});
