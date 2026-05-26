import { describeSpecification, DistributionEngine, DistributionRules, FactProjection, MemoryStore, Specification, User } from "@src";
import { Blog, Comment, model, Post, Publish } from "../blogModel";

describe("DistributionEngine.intersectSpecificationWithDistributionRule", () => {
    let engine: DistributionEngine;

    beforeEach(() => {
        const distributionRules = new DistributionRules([]);
        const store = new MemoryStore();
        engine = new DistributionEngine(distributionRules, store);
    });

    describe("Basic functionality tests", () => {
        it("adds distributionUser given of type Jinaga.User", () => {
            const specification = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
            ).specification;

            const ruleSpecification = model.given(Blog).match((blog, facts) =>
                facts.ofType(User)
                    .join(u => u, blog.creator)
            ).specification;

            const result = engine.intersectSpecificationWithDistributionRule(specification, ruleSpecification);

            expect("\n" + describeSpecification(result, 4).trimEnd()).toBe(`
                (p1: Blog, distributionUser: Jinaga.User) {
                    dist_u1: Jinaga.User [
                        dist_u1 = p1->creator: Jinaga.User
                        dist_u1 = distributionUser
                    ]
                    u1: Post [
                        u1->blog: Blog = p1
                    ]
                } => u1`);
        });

        it("pins the rule's projected user to the distributionUser given", () => {
            const specification = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
            ).specification;

            const ruleSpecification = model.given(Blog).match((blog, facts) =>
                facts.ofType(User)
                    .join(u => u, blog.creator)
            ).specification;

            const result = engine.intersectSpecificationWithDistributionRule(specification, ruleSpecification);

            const lastGiven = result.given[result.given.length - 1];
            expect(lastGiven.label.name).toBe("distributionUser");
            expect(lastGiven.label.type).toBe(User.Type);
            expect(lastGiven.conditions).toHaveLength(0);

            // The first match is the lifted rule's user match. It must have
            // a path condition equating it to the new `distributionUser`
            // given — that's what gates the result by authorization.
            const lifted = result.matches[0];
            expect(lifted.unknown.type).toBe(User.Type);
            const distributionUserPaths = lifted.conditions
                .filter(c => c.type === "path")
                .filter((c: any) => c.labelRight === "distributionUser");
            expect(distributionUserPaths).toHaveLength(1);
        });
    });

    describe("Edge case tests", () => {
        it("handles a specification with only givens", () => {
            const specification: Specification = {
                given: [{ label: { name: "p1", type: "Blog" }, conditions: [] }],
                matches: [],
                projection: { type: "fact", label: "p1" } as FactProjection
            };

            const ruleSpecification = model.given(Blog).match((blog, facts) =>
                facts.ofType(User)
                    .join(u => u, blog.creator)
            ).specification;

            const result = engine.intersectSpecificationWithDistributionRule(specification, ruleSpecification);

            expect("\n" + describeSpecification(result, 4).trimEnd()).toBe(`
                (p1: Blog, distributionUser: Jinaga.User) {
                    dist_u1: Jinaga.User [
                        dist_u1 = p1->creator: Jinaga.User
                        dist_u1 = distributionUser
                    ]
                } => p1`);
        });

        it("throws when the rule does not have a fact projection", () => {
            const specification = model.given(Blog).select(blog => blog).specification;

            const ruleSpecification = model.given(Blog).select(blog => ({
                posts: blog.successors(Post, post => post.blog)
            })).specification;

            expect(() => {
                engine.intersectSpecificationWithDistributionRule(specification, ruleSpecification);
            }).toThrow("Distribution rule specification must have a fact projection");
        });
    });

    describe("Integration tests", () => {
        it("preserves nested existential conditions in the original spec", () => {
            const specification = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
                    .exists(post => facts.ofType(Publish)
                        .join(publish => publish.post, post)
                    )
            ).specification;

            const ruleSpecification = model.given(Blog).match((blog, facts) =>
                facts.ofType(User)
                    .join(u => u, blog.creator)
            ).specification;

            const result = engine.intersectSpecificationWithDistributionRule(specification, ruleSpecification);

            expect("\n" + describeSpecification(result, 4).trimEnd()).toBe(`
                (p1: Blog, distributionUser: Jinaga.User) {
                    dist_u1: Jinaga.User [
                        dist_u1 = p1->creator: Jinaga.User
                        dist_u1 = distributionUser
                    ]
                    u1: Post [
                        u1->blog: Blog = p1
                        E {
                            u2: Publish [
                                u2->post: Post = u1
                            ]
                        }
                    ]
                } => u1`);
        });

        it("works with rules that have no matches (project a given)", () => {
            const specification = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
            ).specification;

            // Rule whose user spec projects the given directly: every reader
            // is allowed iff they're the blog's creator referenced from the
            // given. The intersection must still produce a syntactic gate
            // that the spec runner can evaluate.
            const ruleSpecification = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

            const result = engine.intersectSpecificationWithDistributionRule(specification, ruleSpecification);

            expect("\n" + describeSpecification(result, 4).trimEnd()).toBe(`
                (p1: Blog, distributionUser: Jinaga.User) {
                    dist_u1: Jinaga.User [
                        dist_u1 = p1->creator: Jinaga.User
                        dist_u1 = distributionUser
                    ]
                    u1: Post [
                        u1->blog: Blog = p1
                    ]
                } => u1`);
        });

        it("handles a self-referencing rule with a Comment chain", () => {
            const specification = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
                    .exists(post => facts.ofType(Comment)
                        .join(comment => comment.post, post)
                    )
            ).specification;

            const ruleSpecification = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

            const result = engine.intersectSpecificationWithDistributionRule(specification, ruleSpecification);

            expect("\n" + describeSpecification(result, 4).trimEnd()).toBe(`
                (p1: Blog, distributionUser: Jinaga.User) {
                    dist_u1: Jinaga.User [
                        dist_u1 = p1->creator: Jinaga.User
                        dist_u1 = distributionUser
                    ]
                    u1: Post [
                        u1->blog: Blog = p1
                        E {
                            u2: Comment [
                                u2->post: Post = u1
                            ]
                        }
                    ]
                } => u1`);
        });
    });

    describe("Error handling tests", () => {
        it("throws for a null specification", () => {
            const ruleSpecification = model.given(Blog).match((blog, facts) =>
                facts.ofType(User)
                    .join(u => u, blog.creator)
            ).specification;

            expect(() => {
                engine.intersectSpecificationWithDistributionRule(null as any, ruleSpecification);
            }).toThrow();
        });

        it("throws for a null rule specification", () => {
            const specification = model.given(Blog).select(blog => blog).specification;

            expect(() => {
                engine.intersectSpecificationWithDistributionRule(specification, null as any);
            }).toThrow();
        });
    });
});
