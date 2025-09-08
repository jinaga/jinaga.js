import { DistributionEngine, DistributionRules, User, dehydrateFact } from "@src";
import { Blog, Post, distribution, model } from "../blogModel";

describe("DistributionEngine direct usage", () => {
  const creator = new User("creator");
  const reader = new User("reader");
  const blog = new Blog(creator, "domain");
  const post = new Post(blog, creator, new Date());

  it("should provide detailed debug info when isTest=true", () => {
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
    
    expect(result.type).toBe('failure');
    if (result.type === 'failure') {
      expect(result.reason).toContain("The user does not match");
      expect(result.reason).toContain("Expected hashes: []");
      expect(result.reason).toContain("User hash:");
    }
  });

  it("should NOT provide detailed debug info when isTest=false", () => {
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
    
    expect(result.type).toBe('failure');
    if (result.type === 'failure') {
      expect(result.reason).toContain("The user does not match");
      expect(result.reason).not.toContain("Matching set:");
      expect(result.reason).not.toContain("User fact:");
    }
  });

  it("should NOT provide detailed debug info when isTest is omitted (default behavior)", () => {
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
    
    expect(result.type).toBe('failure');
    if (result.type === 'failure') {
      expect(result.reason).toContain("The user does not match");
      expect(result.reason).not.toContain("Expected hashes:");
      expect(result.reason).not.toContain("User hash:");
    }
  });
});