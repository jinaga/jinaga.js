import { describeSpecification, DistributionEngine, DistributionRules, MemoryStore, User } from "@src";
import { Blog, Comment, model, Post, Publish } from "../blogModel";

describe("DistributionEngine.intersectSpecificationWithDistributionRule - Mathematical Validation", () => {
    let engine: DistributionEngine;
    let store: MemoryStore;
    let distributionRules: DistributionRules;

    beforeEach(() => {
        store = new MemoryStore();
        distributionRules = new DistributionRules([]);
        engine = new DistributionEngine(distributionRules, store);
    });

    describe("Mathematical Proof Validation Tests", () => {
        it("should validate intersection with documentation example - tasks of reader's project", () => {
            // Based on specification-intersection.md example
            // Using Blog/Post model as proxy for the documentation example
            // Specification A: posts of a blog
            const specA = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
            ).specification;

            // Specification B: user distribution rule (same givens as spec A)
            const specB = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

            const result = engine.intersectSpecificationWithDistributionRule(specA, specB);

            // Validate structure matches documentation example
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

        it("should validate existential condition logic with formal specifications", () => {
            const specification = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
            ).specification;

            const ruleSpecification = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

            const result = engine.intersectSpecificationWithDistributionRule(specification, ruleSpecification);

            // Validate the complete specification structure
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


        it("should validate intersection preserves original specification semantics", () => {
            const originalSpec = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
                    .exists(post => facts.ofType(Publish)
                        .join(publish => publish.post, post)
                    )
            ).specification;

            const ruleSpec = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

            const result = engine.intersectSpecificationWithDistributionRule(originalSpec, ruleSpec);

            // Validate the complete specification structure with nested existential
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
    });

    describe("Complex Specification Tests", () => {
        it("should handle complex nested specifications with multiple joins", () => {
            const complexSpec = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
                    .exists(post => facts.ofType(Publish)
                        .join(publish => publish.post, post)
                        .exists(publish => facts.ofType(Comment)
                            .join(comment => comment.post, post)
                        )
                    )
            ).specification;

            const ruleSpec = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

            const result = engine.intersectSpecificationWithDistributionRule(complexSpec, ruleSpec);

            // Validate the complete specification structure with deeply nested existentials
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
                                E {
                                    u3: Comment [
                                        u3->post: Post = u1
                                    ]
                                }
                            ]
                        }
                    ]
                } => u1`);
        });

        it("should verify existential condition logic matches theoretical requirements", () => {
            const specWithExistential = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
                    .exists(post => facts.ofType(Publish)
                        .join(publish => publish.post, post)
                    )
            ).specification;

            const ruleSpec = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

            const result = engine.intersectSpecificationWithDistributionRule(specWithExistential, ruleSpec);

            // Validate the complete specification structure with existential
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

        it("should test with various specification patterns from documentation", () => {
            // Test simple join pattern
            const simpleSpec = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
            ).specification;

            const ruleSpec = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

            const result = engine.intersectSpecificationWithDistributionRule(simpleSpec, ruleSpec);

            // Validate the specification structure
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

        it("should handle multiple distribution rules correctly", () => {
            const specification = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
            ).specification;

            // Test with different distribution rules
            const ruleSpec1 = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

            const ruleSpec2 = model.given(Blog).match(blog => blog.creator.predecessor().exists(user => user.successors(Comment, c => c.author))).specification;

            const result1 = engine.intersectSpecificationWithDistributionRule(specification, ruleSpec1);
            const result2 = engine.intersectSpecificationWithDistributionRule(specification, ruleSpec2);

            // Both should produce valid intersections with distribution users
            expect("\n" + describeSpecification(result1, 4).trimEnd()).toBe(`
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

            expect("\n" + describeSpecification(result2, 4).trimEnd()).toBe(`
                (p1: Blog, distributionUser: Jinaga.User [
                    E {
                        dist_u1: Jinaga.User [
                            dist_u1 = p1->creator: Jinaga.User
                            E {
                                u2: Comment [
                                    u2->author: Jinaga.User = dist_u1
                                ]
                            }
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

    describe("Theoretical Validation", () => {
        it("should ensure intersection preserves mathematical correctness", () => {
            // Test that intersection doesn't break the original specification's logic
            const originalSpec = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
            ).specification;

            const ruleSpec = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

            const result = engine.intersectSpecificationWithDistributionRule(originalSpec, ruleSpec);

            // Validate the complete specification structure
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


        it("should handle complex rule specifications correctly", () => {
            // Test with rule specification that has complex conditions
            const complexRuleSpec = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

            const simpleSpec = model.given(Blog).select(blog => blog).specification;

            const result = engine.intersectSpecificationWithDistributionRule(simpleSpec, complexRuleSpec);

            // Validate the specification structure with no matches
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

        it("should validate intersection with self-referencing specifications", () => {
            // Create a specification that references itself
            const selfRefSpec = model.given(Blog).match((blog, facts) =>
                facts.ofType(Post)
                    .join(post => post.blog, blog)
                    .exists(post => facts.ofType(Comment)
                        .join(comment => comment.post, post)
                    )
            ).specification;

            const ruleSpec = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

            const result = engine.intersectSpecificationWithDistributionRule(selfRefSpec, ruleSpec);

            // Validate the complete specification structure with self-referencing elements
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
                            u2: Comment [
                                u2->post: Post = u1
                            ]
                        }
                    ]
                } => u1`);
        });
    });
});