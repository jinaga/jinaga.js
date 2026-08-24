import { DistributionEngine, DistributionRules, MemoryStore, User, buildFeeds, dehydrateFact } from "@src";
import { Blog, Post, Publish, distribution, model } from "../blogModel";

describe("DistributionEngine diagnostics (issue #207 W1/W2)", () => {
  const creator = new User("creator");
  const reader = new User("reader");
  const blog = new Blog(creator, "domain");

  const blogPosts = model.given(Blog).match((blog, facts) =>
    facts.ofType(Post).join(post => post.blog, blog)
  );

  function namedStartForBlog(specification = blogPosts.specification) {
    const records = dehydrateFact(blog);
    const blogReference = records[records.length - 1];
    return { [specification.given[0].label.name]: blogReference };
  }

  it("codes a feed with no counterpart rule as no-matching-rule", async () => {
    const store = new MemoryStore();
    // No rules at all: nothing can be a near-miss, so this is purely missing.
    const engine = new DistributionEngine(new DistributionRules([]), store, false);

    const result = await engine.canDistributeToAll(
      [blogPosts.specification], namedStartForBlog(), dehydrateFact(reader)[0]);

    expect(result.type).toBe('failure');
    if (result.type === 'failure') {
      expect(result.code).toBe('no-matching-rule');
      expect(result.perFeed).toHaveLength(1);
      expect(result.perFeed[0].code).toBe('no-matching-rule');
      expect(result.perFeed[0].feed).toEqual(expect.any(String));
      expect(result.reason).toContain("No rules apply to this feed.");
    }
  });

  it("names the fact type a target traverses to that the rule does not share", async () => {
    const store = new MemoryStore();
    // The rule shares Blog -> Post with everyone.
    const rules = new DistributionRules([]).share(blogPosts).withEveryone();
    const engine = new DistributionEngine(rules, store, false);

    // The target traverses on to Publish, which the rule does not share. It is
    // not narrower than the rule — it asks for a fact type the rule never
    // delivers — so the reason has to name Publish.
    const broaderTarget = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post).join(post => post.blog, blog)
        .selectMany(post => post.successors(Publish, publish => publish.post))
    ).specification;

    const result = await engine.canDistributeToAll(
      buildFeeds(broaderTarget), namedStartForBlog(broaderTarget), dehydrateFact(reader)[0]);

    expect(result.type).toBe('failure');
    if (result.type === 'failure') {
      // The wire code is unchanged: an older client rejects a code it does not
      // recognize. Only the reason is more precise.
      expect(result.code).toBe('spec-more-restrictive-than-rule');
      expect(result.perFeed[0].code).toBe('spec-more-restrictive-than-rule');
      expect(result.reason).toContain("traverses to Publish, which this rule does not share");
    }
  });

  it("names the condition a target adds that the rule does not impose", async () => {
    const store = new MemoryStore();
    const rules = new DistributionRules([]).share(blogPosts).withEveryone();
    const engine = new DistributionEngine(rules, store, false);

    // The target adds a not-exists the rule lacks. This one really is narrower,
    // and it is still denied: the replicator would be evaluating a condition
    // over Publish on the client's behalf, disclosing whether such facts exist,
    // and the condition's excluding feed would hand the client the facts.
    const narrowerTarget = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post).join(post => post.blog, blog)
        .notExists(post => post.successors(Publish, publish => publish.post))
    ).specification;

    const result = await engine.canDistributeToAll(
      buildFeeds(narrowerTarget), namedStartForBlog(narrowerTarget), dehydrateFact(reader)[0]);

    expect(result.type).toBe('failure');
    if (result.type === 'failure') {
      expect(result.reason).toContain("adds a not-exists condition over Publish");
      expect(result.reason).toContain("disclose whether such facts exist");
    }
  });

  it("codes a shape-matched but unauthorized user as principal-excluded", async () => {
    const store = new MemoryStore();
    const engine = new DistributionEngine(distribution(new DistributionRules([])), store, false);

    // Blog -> Post matches the "creator can see all posts" rule by shape, but
    // the reader is not the creator.
    const result = await engine.canDistributeToAll(
      [blogPosts.specification], namedStartForBlog(), dehydrateFact(reader)[0]);

    expect(result.type).toBe('failure');
    if (result.type === 'failure') {
      expect(result.code).toBe('principal-excluded');
      expect(result.perFeed[0].code).toBe('principal-excluded');
      expect(result.reason).toContain("The user does not match");
    }
  });

  it("codes a shape-matched rule with no logged-in user as not-authenticated", async () => {
    const store = new MemoryStore();
    const engine = new DistributionEngine(distribution(new DistributionRules([])), store, false);

    const result = await engine.canDistributeToAll(
      [blogPosts.specification], namedStartForBlog(), null);

    expect(result.type).toBe('failure');
    if (result.type === 'failure') {
      expect(result.code).toBe('not-authenticated');
      expect(result.perFeed[0].code).toBe('not-authenticated');
      expect(result.reason).toContain("User is not logged in.");
    }
  });
});
