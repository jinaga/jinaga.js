import { describeSpecification, DistributionEngine, DistributionRules, FactProjection, MemoryStore, Specification, User } from "@src";
import { Blog, Comment, CommentApproved, model, Post, Publish } from "../blogModel";

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

    describe("Label collision tests", () => {
        it("renames unknowns inside nested existential conditions of the rule", () => {
            // The rule's user-spec embeds a CommentApproved match inside a
            // `notExists`. The intersection algorithm lifts the rule's
            // matches into the caller's spec; if it only renames top-level
            // rule unknowns it leaves the nested `comment`/`commentApproved`
            // names alone, which can collide with the caller's labels and
            // silently change semantics. After the fix every rule-bound
            // unknown — including those inside existentials — must carry
            // the `dist_` prefix in the merged spec.
            const specification = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
            ).specification;

            // Rule: shared with the blog creator, but only if some
            // CommentApproved exists for some Comment on the blog — the
            // inner Comment and CommentApproved matches live inside an
            // existential on the User match.
            const ruleSpecification = model.given(Blog).match((blog, facts) =>
                facts.ofType(User)
                    .join(u => u, blog.creator)
                    .exists(u => facts.ofType(Comment)
                        .join(comment => comment.post.blog, blog)
                        .exists(comment => facts.ofType(CommentApproved)
                            .join(approved => approved.comment, comment)
                        )
                    )
            ).specification;

            const result = engine.intersectSpecificationWithDistributionRule(specification, ruleSpecification);
            const description = describeSpecification(result, 0);

            // The model builder auto-numbers rule unknowns as u1/u2/u3.
            // After alpha-renaming, every rule-bound unknown — at any depth
            // — must carry the `dist_` prefix. If the bug were still present
            // the nested Comment and CommentApproved matches would remain
            // bare `u2`/`u3` and collide with the caller's `u1: Post`.
            expect(description).toContain("dist_u1: Jinaga.User"); // top-level (worked pre-fix)
            expect(description).toContain("dist_u2: Comment");     // inside outer existential
            expect(description).toContain("dist_u3: CommentApproved"); // inside nested existential

            // No bare rule-bound names should leak through inside the
            // lifted existential (the caller's `u1: Post` is the only
            // un-prefixed `u1` allowed).
            expect(description).not.toMatch(/\bu2: Comment\b/);
            expect(description).not.toMatch(/\bu3: CommentApproved\b/);
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
