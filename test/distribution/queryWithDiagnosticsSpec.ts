import {
  AuthenticationNoOp,
  FactEnvelope,
  FactManager,
  FactReference,
  FeedDecision,
  FeedResponse,
  FeedsResponse,
  Jinaga,
  MemoryStore,
  ObservableSource,
  PassThroughFork,
  Specification,
  User,
  dehydrateFact,
} from "@src";
import { Network } from "../../src/managers/NetworkManager";
import { DistributionIntersectionBranch } from "../../src/distribution/distribution-engine";
import { Blog, Post, model } from "../blogModel";
import { asDistribution } from "./diagnosticNarrowing";

// A Network double that returns the caller-configured feed hashes and
// per-feed decisions from `feeds()` (issue #207 W3/W4), so we can drive
// `queryWithDiagnostics` (W8b) the way a real replicator would.
class DecisionNetwork implements Network {
    // Stands in for a replicator, so it can supply facts the store lacks.
    readonly canLoad = true;

  public response: FeedsResponse = { feeds: [] };
  public feedsCalls = 0;

  feeds(_start: FactReference[], _specification: Specification): Promise<FeedsResponse> {
    this.feedsCalls++;
    return Promise.resolve(this.response);
  }

  fetchFeed(_feed: string, bookmark: string): Promise<FeedResponse> {
    // Every feed is at its end: the replicator delivers no references, so
    // results come purely from the local store (silent-empty for denials).
    return Promise.resolve({ references: [], bookmark });
  }

  streamFeed(): () => void {
    return () => {};
  }

  load(_factReferences: FactReference[]): Promise<FactEnvelope[]> {
    return Promise.resolve([]);
  }

  intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
    return Promise.resolve([{ start, specification }]);
  }
}

describe("queryWithDiagnostics (issue #207 W8b)", () => {
  const creator = new User("creator");
  const blog = new Blog(creator, "domain");

  const blogPosts = model.given(Blog).match((blog, facts) =>
    facts.ofType(Post).join(post => post.blog, blog)
  );

  let network: DecisionNetwork;
  let store: MemoryStore;
  let j: Jinaga;

  // The feed hash `feeds()` reports for the blogPosts spec. `query` fetches
  // whatever hashes are in `feeds`, and `feed`/`decision` correlate by hash.
  const AUTHORIZED_FEED = "authorized-feed-hash";

  // Seed the local store with a couple of posts so an authorized read returns
  // rows. When a feed is denied, nothing was ever synced locally, so the
  // corresponding read stays silently empty — modeled by leaving the store
  // unseeded in that test.
  async function seedPosts() {
    const posts = [
      new Post(blog, creator, "2020-01-01T00:00:00Z"),
      new Post(blog, creator, "2020-01-02T00:00:00Z"),
    ];
    const dehydration = posts.flatMap(p => dehydrateFact(p));
    await store.save(dehydration.map(fact => (<FactEnvelope>{ fact, signatures: [] })));
  }

  beforeEach(() => {
    network = new DecisionNetwork();
    store = new MemoryStore();
    const observableSource = new ObservableSource(store);
    const fork = new PassThroughFork(store);
    const factManager = new FactManager(fork, observableSource, store, network, []);
    j = new Jinaga(new AuthenticationNoOp(), factManager, null);
  });

  it("returns results with no diagnostics when every feed is authorized", async () => {
    await seedPosts();
    network.response = {
      feeds: [AUTHORIZED_FEED],
      decisions: [
        { feed: AUTHORIZED_FEED, decision: "authorized", reason: "" },
      ],
    };

    const { results, diagnostics } = await j.queryWithDiagnostics(blogPosts, blog);

    expect(results).toHaveLength(2);
    expect(diagnostics).toEqual([]);
  });

  it("surfaces a no-matching-rule feed as a non-reactive denied diagnostic", async () => {
    // A denied feed is not listed in `feeds` (nothing to fetch); its decision
    // still arrives so the caller learns why the result is empty.
    network.response = {
      feeds: [],
      decisions: [
        {
          feed: "denied-feed-hash",
          decision: "denied",
          code: "no-matching-rule",
          reason: "No rules apply to this feed.",
        },
      ],
    };

    const { results, diagnostics } = await j.queryWithDiagnostics(blogPosts, blog);

    // Results stay silently empty (no authorized feed fetched).
    expect(results).toHaveLength(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].operation).toBe("query");
    expect(asDistribution(diagnostics[0]).decision).toBe("denied");
    expect(asDistribution(diagnostics[0]).reactive).toBe(false);
    expect(asDistribution(diagnostics[0]).code).toBe("no-matching-rule");
    expect(diagnostics[0].reason).toContain("No rules apply to this feed.");
    expect(diagnostics[0].specification).toContain("Post");
  });

  it("surfaces a reactive feed as a reactive diagnostic without throwing", async () => {
    // Scenario (c): the feed is registered and kept alive (present in `feeds`),
    // but the current user is not yet authorized. It must never be fatal.
    network.response = {
      feeds: [AUTHORIZED_FEED],
      decisions: [
        {
          feed: AUTHORIZED_FEED,
          decision: "reactive",
          reason: "pending authorization",
        },
      ],
    };

    const promise = j.queryWithDiagnostics(blogPosts, blog);
    await expect(promise).resolves.toBeDefined();
    const { diagnostics } = await promise;

    expect(diagnostics).toHaveLength(1);
    expect(asDistribution(diagnostics[0]).decision).toBe("reactive");
    expect(asDistribution(diagnostics[0]).reactive).toBe(true);
    expect(diagnostics[0].reason).toBe("pending authorization");
  });

  it("reports only denied/reactive feeds, never authorized ones", async () => {
    network.response = {
      feeds: [AUTHORIZED_FEED],
      decisions: [
        { feed: AUTHORIZED_FEED, decision: "authorized", reason: "" },
        { feed: "reactive-feed", decision: "reactive", reason: "pending" },
        { feed: "denied-feed", decision: "denied", code: "principal-excluded", reason: "excluded" },
      ],
    };

    const { diagnostics } = await j.queryWithDiagnostics(blogPosts, blog);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(d => asDistribution(d).decision).sort()).toEqual(["denied", "reactive"]);
    expect(diagnostics.every(d => d.operation === "query")).toBe(true);
  });

  it("is inert against an old replicator that omits decisions", async () => {
    await seedPosts();
    network.response = { feeds: [AUTHORIZED_FEED] };

    const { results, diagnostics } = await j.queryWithDiagnostics(blogPosts, blog);

    expect(results).toHaveLength(2);
    expect(diagnostics).toEqual([]);
  });

  it("returns empty results and no diagnostics for a null given", async () => {
    const { results, diagnostics } = await j.queryWithDiagnostics(blogPosts, null as any);

    expect(results).toEqual([]);
    expect(diagnostics).toEqual([]);
    // The network is never consulted for an invalid given.
    expect(network.feedsCalls).toBe(0);
  });
});
