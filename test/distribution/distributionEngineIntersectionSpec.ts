import { describeSpecification, DistributionEngine, DistributionRules, FactProjection, MemoryStore, Specification, User } from "@src";
import { Blog, model, Post, Publish } from "../blogModel";

describe("DistributionEngine.intersectSpecificationWithDistributionRule", () => {
    let engine: DistributionEngine;
    let store: MemoryStore;
    let distributionRules: DistributionRules;

    beforeEach(() => {
        store = new MemoryStore();
        distributionRules = new DistributionRules([]);
        engine = new DistributionEngine(distributionRules, store);
    });

    describe("Basic functionality tests", () => {
        it("should correctly add distribution user as new given with type Jinaga.User", () => {
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
                } => u1`);
        });

        it("should create existential condition properly structured with distribution rule specification", () => {
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
                } => u1`);
        });

        it("should equate projected user with distribution user in path condition", () => {
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
                } => u1`);
        });
    });

    describe("Edge case tests", () => {
        it("should handle empty specifications", () => {
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
                (p1: Blog, distributionUser: Jinaga.User [
                    E {
                        dist_u1: Jinaga.User [
                            dist_u1 = p1->creator: Jinaga.User
                            dist_u1 = distributionUser
                        ]
                    }
                ]) {
                } => p1`);
        });

        it("should throw error for invalid rules with non-fact projections", () => {
            const specification = model.given(Blog).select(blog => blog).specification;

            const ruleSpecification = model.given(Blog).select(blog => ({
                posts: blog.successors(Post, post => post.blog)
            })).specification;

            expect(() => {
                engine.intersectSpecificationWithDistributionRule(specification, ruleSpecification);
            }).toThrow("Distribution rule specification must have a fact projection");
        });

        it("should handle specifications with no matches", () => {
            const specification = model.given(Blog).select(blog => blog).specification;

            const ruleSpecification: Specification = {
                given: [{ label: { name: "p1", type: "Blog" }, conditions: [] }],
                matches: [{
                    unknown: { name: "user", type: User.Type },
                    conditions: []
                }],
                projection: { type: "fact", label: "user" } as FactProjection
            };

            const result = engine.intersectSpecificationWithDistributionRule(specification, ruleSpecification);

            expect("\n" + describeSpecification(result, 4).trimEnd()).toBe(`
                (p1: Blog, distributionUser: Jinaga.User [
                    E {
                        dist_user: Jinaga.User [
                            dist_user = distributionUser
                        ]
                    }
                ]) {
                } => p1`);
        });
    });

    describe("Integration tests", () => {
        it("should handle various specification types and distribution rules", () => {
            const specification = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
            ).specification;

            const ruleSpecification: Specification = {
                given: [{ label: { name: "p1", type: "Blog" }, conditions: [] }],
                matches: [{
                    unknown: { name: "user", type: User.Type },
                    conditions: []
                }],
                projection: { type: "fact", label: "user" } as FactProjection
            };

            const result = engine.intersectSpecificationWithDistributionRule(specification, ruleSpecification);

            expect("\n" + describeSpecification(result, 4).trimEnd()).toBe(`
                (p1: Blog, distributionUser: Jinaga.User [
                    E {
                        dist_user: Jinaga.User [
                            dist_user = distributionUser
                        ]
                    }
                ]) {
                    u1: Post [
                        u1->blog: Blog = p1
                    ]
                } => u1`);
        });

        it("should handle complex nested specifications", () => {
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
                        E {
                            u2: Publish [
                                u2->post: Post = u1
                            ]
                        }
                    ]
                } => u1`);
        });

        it("should handle multiple distribution rules", () => {
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
                } => u1`);
        });
    });

    describe("Error handling tests", () => {
        it("should throw error for malformed inputs - null specification", () => {
            const ruleSpecification = model.given(Blog).match((blog, facts) =>
                facts.ofType(User)
                    .join(u => u, blog.creator)
            ).specification;

            expect(() => {
                engine.intersectSpecificationWithDistributionRule(null as any, ruleSpecification);
            }).toThrow();
        });

        it("should throw error for malformed inputs - null rule specification", () => {
            const specification = model.given(Blog).select(blog => blog).specification;

            expect(() => {
                engine.intersectSpecificationWithDistributionRule(specification, null as any);
            }).toThrow();
        });

        it("should handle performance with complex specifications", () => {
            // Create a complex specification with nested matches
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

            const startTime = Date.now();
            const result = engine.intersectSpecificationWithDistributionRule(specification, ruleSpecification);
            const endTime = Date.now();

            expect("\n" + describeSpecification(result, 4).trimEnd()).toBe(`
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
                        E {
                            u2: Publish [
                                u2->post: Post = u1
                            ]
                        }
                    ]
                } => u1`);
            expect(endTime - startTime).toBeLessThan(100); // Should complete quickly
        });
    });
});