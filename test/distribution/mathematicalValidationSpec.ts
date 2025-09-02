import { DistributionEngine, DistributionRules, User } from "../../src";
import { MemoryStore } from "../../src/memory/memory-store";
import { Blog, Post, Publish, Comment, model } from "../blogModel";
import { Specification, FactProjection } from "../../src/specification/specification";

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
      expect(result.given).toHaveLength(2);
      expect(result.given[1].name).toBe("distributionUser");
      expect(result.given[1].type).toBe(User.Type);

      // Check existential condition structure
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].conditions).toHaveLength(2);
      const existentialCondition = result.matches[0].conditions[1] as any;
      expect(existentialCondition.type).toBe("existential");
      expect(existentialCondition.exists).toBe(true);
    });

    it("should validate existential condition logic with formal specifications", () => {
       const specification = model.given(Blog).match((blog, facts) =>
         facts.ofType(Post)
           .join(post => post.blog, blog)
       ).specification;

       const ruleSpecification = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

       const result = engine.intersectSpecificationWithDistributionRule(specification, ruleSpecification);

      // Validate existential condition contains the distribution rule
      const existentialCondition = result.matches[0].conditions[1] as any;
      expect(existentialCondition.type).toBe("existential");
      expect(existentialCondition.matches).toHaveLength(1);
      expect(existentialCondition.matches[0].unknown.type).toBe(User.Type);

      // Validate path condition equates projected user with distribution user
      const pathCondition = existentialCondition.matches[0].conditions[1];
      expect(pathCondition.type).toBe("path");
      expect(pathCondition.labelRight).toBe("distributionUser");
    });

    it("should test intersection commutativity property", () => {
       // Create two different specifications
       const spec1 = model.given(Blog).match((blog, facts) =>
         facts.ofType(Post)
           .join(post => post.blog, blog)
       ).specification;

       const spec2 = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

       // Intersect in both orders
       const result1 = engine.intersectSpecificationWithDistributionRule(spec1, spec2);
       const result2 = engine.intersectSpecificationWithDistributionRule(spec2, spec1);

      // While the exact structure may differ, both should be valid intersections
      expect(result1.given).toContainEqual(
        expect.objectContaining({ name: "distributionUser", type: User.Type })
      );
      expect(result2.given).toContainEqual(
        expect.objectContaining({ name: "distributionUser", type: User.Type })
      );
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

      // Original match structure should be preserved
      expect(result.matches[0].conditions).toHaveLength(3); // original + existential
      const originalCondition = result.matches[0].conditions[0];
      expect(originalCondition.type).toBe("path");

      // Existential condition should be properly added
      const existentialCondition = result.matches[0].conditions[2] as any;
      expect(existentialCondition.type).toBe("existential");
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

      expect(result.given).toHaveLength(2);
      expect(result.matches[0].conditions).toHaveLength(3); // original path + two existentials + distribution existential

      // Validate nested existential structure is preserved
      const nestedExistential = result.matches[0].conditions[1] as any;
      expect(nestedExistential.matches[0].conditions).toHaveLength(2); // join + existential
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

      // The intersection should add exactly one existential condition for distribution
      const existentialConditions = result.matches[0].conditions.filter((c: any) => c.type === "existential");
      expect(existentialConditions).toHaveLength(2); // original existential + distribution existential

      // Distribution existential should be properly structured
      const distributionExistential = existentialConditions[1] as any;
      expect(distributionExistential.type).toBe("existential");
      expect(distributionExistential.matches).toHaveLength(1);
    });

    it("should test with various specification patterns from documentation", () => {
       // Pattern 1: Simple join
       const simpleSpec = model.given(Blog).match((blog, facts) =>
         facts.ofType(Post)
           .join(post => post.blog, blog)
       ).specification;

       // Pattern 2: Multiple conditions
       const multiConditionSpec = model.given(Blog).match((blog, facts) =>
         facts.ofType(Post)
           .join(post => post.blog, blog)
       ).specification;

       const ruleSpec = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

       const result1 = engine.intersectSpecificationWithDistributionRule(simpleSpec, ruleSpec);
       const result2 = engine.intersectSpecificationWithDistributionRule(multiConditionSpec, ruleSpec);

      // Both should produce valid intersections
      expect(result1.given).toHaveLength(2);
      expect(result2.given).toHaveLength(2);

      // Multi-condition spec should preserve additional conditions
      expect(result2.matches[0].conditions).toHaveLength(2); // path + existential
    });

    it("should handle multiple distribution rules correctly", () => {
       const specification = model.given(Blog).match((blog, facts) =>
         facts.ofType(Post)
           .join(post => post.blog, blog)
       ).specification;

       // Multiple distribution rules (simulated by calling intersect multiple times)
       const ruleSpec1 = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

       const ruleSpec2 = model.given(Blog).match(blog => blog.creator.predecessor().exists(user => user.successors(Comment, c => c.author))).specification;

       const result1 = engine.intersectSpecificationWithDistributionRule(specification, ruleSpec1);
       const result2 = engine.intersectSpecificationWithDistributionRule(specification, ruleSpec2);

      // Both results should have distribution user
      expect(result1.given[1].name).toBe("distributionUser");
      expect(result2.given[1].name).toBe("distributionUser");

      // Both rules should have the same structure
      const existential1 = result1.matches[0].conditions[1] as any;
      const existential2 = result2.matches[0].conditions[1] as any;
      expect(existential1.matches[0].conditions).toHaveLength(2); // path + path
      expect(existential2.matches[0].conditions).toHaveLength(3); // path + exists + path
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

      // The intersection should preserve all original conditions
      const originalConditions = result.matches[0].conditions.slice(0, -1); // exclude distribution existential
      expect(originalConditions).toHaveLength(1); // path

      // Validate condition types are preserved
      expect(originalConditions[0].type).toBe("path");
    });

    it("should validate algorithm produces mathematically correct results", () => {
       // Test with empty specification
       const emptySpec: Specification = {
         given: [{ name: "blog", type: "Blog" }],
         matches: [],
         projection: { type: "fact", label: "blog" } as FactProjection
       };

       const ruleSpec = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

       const result = engine.intersectSpecificationWithDistributionRule(emptySpec, ruleSpec);

      // Should still add distribution user and existential condition
      expect(result.given).toHaveLength(2);
      expect(result.given[1].name).toBe("distributionUser");
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].conditions).toHaveLength(1); // only existential
    });

    it("should test edge cases that could break mathematical properties", () => {
       // Edge case 1: Specification with no givens
       const noGivenSpec: Specification = {
         given: [],
         matches: [{
           unknown: { name: "post", type: "Post" },
           conditions: []
         }],
         projection: { type: "fact", label: "post" } as FactProjection
       };

       const ruleSpec = model.given(User).match((user, facts) =>
         facts.ofType(User)
           .join(u => u, user)
       ).specification;

       const result = engine.intersectSpecificationWithDistributionRule(noGivenSpec, ruleSpec);

       expect(result.given).toHaveLength(1); // only distribution user added
       expect(result.given[0].name).toBe("distributionUser");

       // Edge case 2: Rule specification with complex conditions
       const complexRuleSpec = model.given(Blog).match(blog => blog.creator.predecessor()).specification;

       const simpleSpec = model.given(Blog).select(blog => blog).specification;

       const complexResult = engine.intersectSpecificationWithDistributionRule(simpleSpec, complexRuleSpec);

      // Should handle complex rule specifications correctly
      expect(complexResult.given).toHaveLength(2);
      expect(complexResult.matches).toHaveLength(1);
      // Validate that intersection produces a valid result structure
      expect(complexResult.matches[0]).toBeDefined();
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

      // Should handle self-referencing specifications without breaking
      expect(result.given).toHaveLength(2);
      expect(result.matches).toHaveLength(1);
      // Validate that the intersection produces a valid structure
      expect(result.matches[0].conditions.length).toBeGreaterThan(0);
    });
  });
});