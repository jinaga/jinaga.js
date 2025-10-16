import { DistributionEngine, DistributionRules, User, dehydrateFact } from "@src";
import { Blog, Post, distribution, model } from "../blogModel";

describe("DistributionEngine direct usage", () => {
  const creator = new User("creator");
  const reader = new User("reader");
  const blog = new Blog(creator, "domain");
  const post = new Post(blog, creator, new Date());

  it("should return success when user lacks permissions in test mode", () => {
    const distributionRules = distribution(new DistributionRules([]));

    // Create engine with isTest=true
    const engine = new DistributionEngine(distributionRules);

    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
    ).specification;

    const namedStart = { "blog": dehydrateFact(blog)[0] };
    const userFact = dehydrateFact(reader)[0];

    const result = engine.canDistributeToAll([specification], namedStart, userFact);

    expect(result.type).toBe('success');
  });

  it("should return success when user lacks permissions with isTest=false", () => {
    const distributionRules = distribution(new DistributionRules([]));

    // Create engine with isTest=false (default)
    const engine = new DistributionEngine(distributionRules);

    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
    ).specification;

    const namedStart = { "blog": dehydrateFact(blog)[0] };
    const userFact = dehydrateFact(reader)[0];

    const result = engine.canDistributeToAll([specification], namedStart, userFact);

    expect(result.type).toBe('success');
  });

  it("should return success when user lacks permissions with default behavior", () => {
    const distributionRules = distribution(new DistributionRules([]));

    // Create engine without isTest parameter (should default to false)
    const engine = new DistributionEngine(distributionRules);

    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
    ).specification;

    const namedStart = { "blog": dehydrateFact(blog)[0] };
    const userFact = dehydrateFact(reader)[0];

    const result = engine.canDistributeToAll([specification], namedStart, userFact);

    expect(result.type).toBe('success');
  });
});