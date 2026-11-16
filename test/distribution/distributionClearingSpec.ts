import {
  AuthenticationNoOp,
  dehydrateFact,
  DistributionDiagnostic,
  FactEnvelope,
  FeedDecision,
  FactManager,
  FactReference,
  FeedResponse,
  FeedsResponse,
  Jinaga,
  MemoryStore,
  ObservableSource,
  PassThroughFork,
  Specification,
  User,
} from "@src";
import { Network, NetworkManager } from "../../src/managers/NetworkManager";
import { isPendingAuthorization, toDistributionDiagnostics } from "../../src/managers/distributionDiagnostic";
import { DistributionIntersectionBranch } from "../../src/distribution/distribution-engine";
import { Blog, Post, model } from "../blogModel";

// A Network double whose feed stream can be driven on demand, so a test can
// simulate a `reactive` feed's race resolving — the feed later delivering real
// facts (issue #207 W9). `loadResult` is what `load()` returns for the
// delivered references, so a test controls whether facts actually arrive.
class ControllableNetwork implements Network {
  public response: FeedsResponse = { feeds: [] };
  public loadResult: FactEnvelope[] = [];
  private streamCallbacks = new Map<string, (refs: FactReference[], bookmark: string) => Promise<void>>();

  feeds(): Promise<FeedsResponse> { return Promise.resolve(this.response); }
  fetchFeed(_feed: string, bookmark: string): Promise<FeedResponse> { return Promise.resolve({ references: [], bookmark }); }

  streamFeed(
    feed: string,
    bookmark: string,
    onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>,
    _onError: (err: Error) => void,
    _feedRefreshIntervalSeconds: number
  ): () => void {
    this.streamCallbacks.set(feed, onResponse);
    // Resolve the subscriber's start() with an initial empty response.
    Promise.resolve().then(() => onResponse([], bookmark));
    return () => {};
  }

  load(_factReferences: FactReference[]): Promise<FactEnvelope[]> { return Promise.resolve(this.loadResult); }
  intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
    return Promise.resolve([{ start, specification }]);
  }

  // Test helper: push feed references, which the subscriber loads (via
  // loadResult) and saves — the real "began delivering" path.
  async deliver(feed: string, references: FactReference[]): Promise<void> {
    const cb = this.streamCallbacks.get(feed);
    if (!cb) throw new Error(`No stream open for feed ${feed}`);
    await cb(references, "bookmark-2");
  }
}

const FEED = "reactive-feed";

describe("distribution diagnostic clearing on transition (issue #207 W9)", () => {
  const blog = new Blog(new User("creator"), "domain");
  const blogPosts = model.given(Blog).match((blog, facts) =>
    facts.ofType(Post).join(post => post.blog, blog)
  );

  // A real Post under the blog, so delivering it loads + saves actual facts.
  const post = new Post(blog, new User("author"), "2020-01-01T00:00:00Z");
  const postRecords = dehydrateFact(post);
  const postEnvelopes: FactEnvelope[] = postRecords.map(f => ({ fact: f, signatures: [] }));
  const postRef: FactReference = { type: postRecords[postRecords.length - 1].type, hash: postRecords[postRecords.length - 1].hash };

  let network: ControllableNetwork;
  let store: MemoryStore;
  let j: Jinaga;

  beforeEach(() => {
    network = new ControllableNetwork();
    network.response = {
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "reactive", reason: "pending authorization" }],
    };
    network.loadResult = postEnvelopes;
    store = new MemoryStore();
    const factManager = new FactManager(new PassThroughFork(store), new ObservableSource(store), store, network, []);
    j = new Jinaga(new AuthenticationNoOp(), factManager, null);
  });

  it("emits a clearing diagnostic when a reactive feed begins delivering data", async () => {
    const received: DistributionDiagnostic[] = [];
    j.onDistributionDiagnostic(d => received.push(d));

    const observer = j.subscribe(blogPosts, blog, () => {});
    await observer.loaded();

    // Raised only, so far.
    expect(received).toHaveLength(1);
    expect(received[0].reactive).toBe(true);
    expect(received[0].cleared).toBeFalsy();
    expect(received[0].feed).toBe(FEED);

    // The race resolves: the feed delivers real facts.
    await network.deliver(FEED, [postRef]);

    expect(received).toHaveLength(2);
    expect(received[1].cleared).toBe(true);
    expect(received[1].reactive).toBe(false);
    expect(received[1].feed).toBe(FEED);
    expect(received[1].operation).toBe("subscribe");
    expect(received[1].reason).not.toContain("pending");

    observer.stop();
  });

  it("does NOT clear when the feed delivers references but no facts load", async () => {
    network.loadResult = []; // references arrive, but load returns an empty graph
    const received: DistributionDiagnostic[] = [];
    j.onDistributionDiagnostic(d => received.push(d));

    const observer = j.subscribe(blogPosts, blog, () => {});
    await observer.loaded();
    await network.deliver(FEED, [postRef]);

    expect(received.filter(d => d.cleared)).toHaveLength(0);

    observer.stop();
  });

  it("exposes both the raised and clearing diagnostics via observer.diagnostics()", async () => {
    const observer = j.subscribe(blogPosts, blog, () => {});
    await observer.loaded();
    await network.deliver(FEED, [postRef]);

    const diagnostics = observer.diagnostics();
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0].cleared).toBeFalsy();
    expect(diagnostics[1].cleared).toBe(true);

    observer.stop();
  });

  it("fires the clearing only once even if the feed delivers again", async () => {
    const received: DistributionDiagnostic[] = [];
    j.onDistributionDiagnostic(d => received.push(d));

    const observer = j.subscribe(blogPosts, blog, () => {});
    await observer.loaded();

    await network.deliver(FEED, [postRef]);
    await network.deliver(FEED, [postRef]);

    const cleared = received.filter(d => d.cleared);
    expect(cleared).toHaveLength(1);

    observer.stop();
  });

  it("does not emit a clearing after the observer is stopped", async () => {
    const received: DistributionDiagnostic[] = [];
    j.onDistributionDiagnostic(d => received.push(d));

    const observer = j.subscribe(blogPosts, blog, () => {});
    await observer.loaded();
    observer.stop();

    await network.deliver(FEED, [postRef]);

    expect(received.filter(d => d.cleared)).toHaveLength(0);
  });

  describe("NetworkManager.onFeedData", () => {
    it("fires a late-registered listener immediately once the feed has delivered facts", async () => {
      const manager = new NetworkManager(network, store, async () => {});
      const { feeds } = await manager.subscribe([], blogPosts.specification);
      await network.deliver(FEED, [postRef]);

      let fired = false;
      const unregister = manager.onFeedData(FEED, () => { fired = true; });
      expect(fired).toBe(true);
      unregister();
      // Release the subscriber so its refresh timer doesn't leak.
      manager.unsubscribe(feeds);
    });
  });
});

describe("cache date withheld while a feed is pending authorization (issue #402)", () => {
  const blog = new Blog(new User("creator"), "domain");
  const blogPosts = model.given(Blog).match((blog, facts) =>
    facts.ofType(Post).join(post => post.blog, blog)
  );

  const post = new Post(blog, new User("author"), "2020-01-01T00:00:00Z");
  const postRecords = dehydrateFact(post);
  const postEnvelopes: FactEnvelope[] = postRecords.map(f => ({ fact: f, signatures: [] }));
  const postRef: FactReference = { type: postRecords[postRecords.length - 1].type, hash: postRecords[postRecords.length - 1].hash };

  let network: ControllableNetwork;
  let store: MemoryStore;
  let j: Jinaga;

  beforeEach(() => {
    network = new ControllableNetwork();
    network.loadResult = postEnvelopes;
    store = new MemoryStore();
    const factManager = new FactManager(new PassThroughFork(store), new ObservableSource(store), store, network, []);
    j = new Jinaga(new AuthenticationNoOp(), factManager, null);
  });

  // Criterion 1. The pending feed sent none of its facts, so the local graph
  // does not hold the answer and the next start must fetch before it reads.
  it("writes no date for a watch whose only feed is pending", async () => {
    network.response = {
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "reactive", reason: "pending authorization" }],
    };

    const first = j.watch(blogPosts, blog, () => {});
    await first.loaded();
    first.stop();

    const second = j.watch(blogPosts, blog, () => {});
    expect(await second.cached()).toBe(false);
    await second.loaded();
    second.stop();
  });

  // Criterion 2. A subscription holds the feed open, so the pending state
  // retires when the feed delivers, and that is when the load counts as
  // complete.
  it("writes the date for a subscription when its pending feed clears", async () => {
    network.response = {
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "reactive", reason: "pending authorization" }],
    };

    const observer = j.subscribe(blogPosts, blog, () => {});
    await observer.loaded();

    const beforeClearing = j.subscribe(blogPosts, blog, () => {});
    expect(await beforeClearing.cached()).toBe(false);
    await beforeClearing.loaded();
    beforeClearing.stop();

    // The race resolves: the feed delivers its facts into the local graph.
    await network.deliver(FEED, [postRef]);

    const afterClearing = j.subscribe(blogPosts, blog, () => {});
    expect(await afterClearing.cached()).toBe(true);
    await afterClearing.loaded();
    afterClearing.stop();
    observer.stop();
  });

  // Criterion 3, authorized.
  it("writes the date when every feed is authorized", async () => {
    network.response = {
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "authorized", reason: "authorized" }],
    };

    const first = j.subscribe(blogPosts, blog, () => {});
    await first.loaded();
    first.stop();

    const second = j.subscribe(blogPosts, blog, () => {});
    expect(await second.cached()).toBe(true);
    await second.loaded();
    second.stop();
  });

  // Criterion 3, structurally denied. No arriving fact changes the verdict, so
  // there is nothing to wait for.
  it("writes the date when a feed is denied structurally", async () => {
    network.response = {
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "denied", code: "no-matching-rule", reason: "no rule matches" }],
    };

    const first = j.subscribe(blogPosts, blog, () => {});
    await first.loaded();
    first.stop();

    const second = j.subscribe(blogPosts, blog, () => {});
    expect(await second.cached()).toBe(true);
    await second.loaded();
    second.stop();
  });

  // Criterion 5. `reactive` and the date come from one rule, so a replicator
  // that calls a structural denial reactive withholds nothing.
  it("writes the date when a reactive decision carries a structural code", async () => {
    network.response = {
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "reactive", code: "spec-more-restrictive-than-rule", reason: "narrowed past the rule" }],
    };

    const first = j.subscribe(blogPosts, blog, () => {});
    await first.loaded();
    expect(first.diagnostics()[0].reactive).toBe(false);
    first.stop();

    const second = j.subscribe(blogPosts, blog, () => {});
    expect(await second.cached()).toBe(true);
    await second.loaded();
    second.stop();
  });

  // Criterion 4. Unchanged by this issue, pinned so the pending rule does not
  // become the only thing that withholds the date.
  it("writes no date when the load is rejected", async () => {
    network.response = { feeds: [FEED], decisions: [] };
    network.feeds = () => Promise.reject(new Error("network is down"));

    const first = j.subscribe(blogPosts, blog, () => {});
    await expect(first.loaded()).rejects.toThrow("network is down");
    first.stop();

    network.feeds = () => Promise.resolve({
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "authorized", reason: "authorized" }],
    });

    const second = j.subscribe(blogPosts, blog, () => {});
    expect(await second.cached()).toBe(false);
    await second.loaded();
    second.stop();
  });
});

describe("isPendingAuthorization (issue #402)", () => {
  // The predicate is the one rule, so the `reactive` field of a diagnostic is
  // derived from it rather than carrying a second copy of the decision.
  it("is true only for a reactive decision with no structural code", () => {
    expect(isPendingAuthorization({ feed: "f", decision: "reactive", reason: "" })).toBe(true);
    expect(isPendingAuthorization({ feed: "f", decision: "reactive", code: "not-authenticated", reason: "" })).toBe(true);
    expect(isPendingAuthorization({ feed: "f", decision: "reactive", code: "no-matching-rule", reason: "" })).toBe(false);
    expect(isPendingAuthorization({ feed: "f", decision: "reactive", code: "spec-more-restrictive-than-rule", reason: "" })).toBe(false);
    expect(isPendingAuthorization({ feed: "f", decision: "authorized", reason: "" })).toBe(false);
    expect(isPendingAuthorization({ feed: "f", decision: "denied", code: "principal-excluded", reason: "" })).toBe(false);
  });

  // The field and the predicate agree by construction, not by coincidence.
  it("decides the reactive field of every diagnostic it raises", () => {
    const decisions: FeedDecision[] = [
      { feed: "a", decision: "reactive", reason: "" },
      { feed: "b", decision: "reactive", code: "no-matching-rule", reason: "" },
      { feed: "c", decision: "denied", code: "not-authenticated", reason: "" },
    ];
    const diagnostics = toDistributionDiagnostics("subscribe", "spec", decisions);
    for (const diagnostic of diagnostics) {
      const decision = decisions.find(d => d.feed === diagnostic.feed)!;
      expect(diagnostic.reactive).toBe(isPendingAuthorization(decision));
    }
  });
});

describe("the clearing feed's cache date lands before its delivery completes (issue #402)", () => {
  const blog = new Blog(new User("creator"), "domain");
  const blogPosts = model.given(Blog).match((blog, facts) =>
    facts.ofType(Post).join(post => post.blog, blog)
  );

  const post = new Post(blog, new User("author"), "2020-01-01T00:00:00Z");
  const postRecords = dehydrateFact(post);
  const postEnvelopes: FactEnvelope[] = postRecords.map(f => ({ fact: f, signatures: [] }));
  const postRef: FactReference = { type: postRecords[postRecords.length - 1].type, hash: postRecords[postRecords.length - 1].hash };

  // A store whose cache-date write does not land in the tick it was started in,
  // which is what IndexedDB's transaction does and what `MemoryStore` -- whose
  // write is a synchronous assignment -- cannot show. `events` records the
  // order, so the test asserts the ordering itself rather than polling for it.
  class DeferredMruStore extends MemoryStore {
    public readonly events: string[] = [];
    async setMruDate(specificationHash: string, mruDate: Date): Promise<void> {
      await new Promise<void>(resolve => setImmediate(resolve));
      await super.setMruDate(specificationHash, mruDate);
      this.events.push("date written");
    }
  }

  it("so the next start sees the date a cleared feed wrote", async () => {
    const network = new ControllableNetwork();
    network.response = {
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "reactive", reason: "pending authorization" }],
    };
    network.loadResult = postEnvelopes;
    const store = new DeferredMruStore();
    const factManager = new FactManager(new PassThroughFork(store), new ObservableSource(store), store, network, []);
    const j = new Jinaga(new AuthenticationNoOp(), factManager, null);

    const observer = j.subscribe(blogPosts, blog, () => {});
    await observer.loaded();
    // Nothing written yet: the feed is pending.
    expect(store.events).toEqual([]);

    // The race resolves. The delivery must not complete until the date it
    // caused has landed, because the clearing diagnostic is raised
    // synchronously and a consumer can start the next observer from it.
    await network.deliver(FEED, [postRef]);
    store.events.push("delivery resolved");
    expect(store.events).toEqual(["date written", "delivery resolved"]);

    const next = j.subscribe(blogPosts, blog, () => {});
    expect(await next.cached()).toBe(true);
    await next.loaded();
    next.stop();
    observer.stop();
  });
});
