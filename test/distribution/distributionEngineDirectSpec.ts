import { DistributionEngine, DistributionRules, MemoryStore, User, buildFeeds, dehydrateFact } from "@src";
import { Blog, Post, distribution, model } from "../blogModel";

describe("DistributionEngine direct usage", () => {
  const creator = new User("creator");
  const reader = new User("reader");
  const blog = new Blog(creator, "domain");
  const post = new Post(blog, creator, new Date());

  it("should provide detailed debug info when isTest=true", async () => {
    const store = new MemoryStore();
    const distributionRules = distribution(new DistributionRules([]));
    
    // Create engine with isTest=true
    const engine = new DistributionEngine(distributionRules, store, true);
    
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
    ).specification;

    const namedStart = { "blog": dehydrateFact(blog)[0] };
    const userFact = dehydrateFact(reader)[0];

    const result = await engine.canDistributeToAll([specification], namedStart, userFact);
    
    expect(result.type).toBe('failure');
    if (result.type === 'failure') {
      expect(result.reason).toContain("The user does not match");
      expect(result.reason).toContain("Expected hashes: []");
      expect(result.reason).toContain("User hash:");
    }
  });

  it("should NOT provide detailed debug info when isTest=false", async () => {
    const store = new MemoryStore();
    const distributionRules = distribution(new DistributionRules([]));
    
    // Create engine with isTest=false (default)
    const engine = new DistributionEngine(distributionRules, store, false);
    
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
    ).specification;

    const namedStart = { "blog": dehydrateFact(blog)[0] };
    const userFact = dehydrateFact(reader)[0];

    const result = await engine.canDistributeToAll([specification], namedStart, userFact);
    
    expect(result.type).toBe('failure');
    if (result.type === 'failure') {
      expect(result.reason).toContain("The user does not match");
      expect(result.reason).not.toContain("Matching set:");
      expect(result.reason).not.toContain("User fact:");
    }
  });

  it("should NOT authorize a sub-feed that drops an existential restriction (isTest=false)", async () => {
    // The "published posts" rule (withEveryone) authorizes Blog -> Post -> Publish.
    // A bare Blog -> Post feed would expose unpublished posts, so the sub-feed
    // relaxation must reject it — the dropped Publish is a successor restriction,
    // not a mandatory predecessor. This guards the replicator (isTest=false), not
    // just JinagaTest. See issue #204.
    const store = new MemoryStore();
    const distributionRules = distribution(new DistributionRules([]));
    const engine = new DistributionEngine(distributionRules, store, false);

    const allPosts = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post).join(post => post.blog, blog)
    ).specification;

    const blogRecords = dehydrateFact(blog);
    const blogReference = blogRecords[blogRecords.length - 1];
    const namedStart = { [allPosts.given[0].label.name]: blogReference };

    // Anonymous: only the published-posts (withEveryone) rule could apply, and
    // it must not be satisfied by dropping the Publish restriction.
    const result = await engine.canDistributeToAll(buildFeeds(allPosts), namedStart, null);
    expect(result.type).toBe('failure');
  });

  it("should NOT provide detailed debug info when isTest is omitted (default behavior)", async () => {
    const store = new MemoryStore();
    const distributionRules = distribution(new DistributionRules([]));
    
    // Create engine without isTest parameter (should default to false)
    const engine = new DistributionEngine(distributionRules, store);
    
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
    ).specification;

    const namedStart = { "blog": dehydrateFact(blog)[0] };
    const userFact = dehydrateFact(reader)[0];

    const result = await engine.canDistributeToAll([specification], namedStart, userFact);
    
    expect(result.type).toBe('failure');
    if (result.type === 'failure') {
      expect(result.reason).toContain("The user does not match");
      expect(result.reason).not.toContain("Expected hashes:");
      expect(result.reason).not.toContain("User hash:");
    }
  });
});