import {
  AuthenticationNoOp,
  dehydrateFact,
  DistributionDiagnostic,
  FactEnvelope,
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
import { DistributionIntersectionBranch } from "../../src/distribution/distribution-engine";
import { Blog, Post, model } from "../blogModel";

// A Network double whose feed stream can be driven on demand, so a test can
// simulate a `reactive` feed's race resolving — the feed later delivering real
// facts (issue #207 W9). `loadResult` is what `load()` returns for the
// delivered references, so a test controls whether facts actually arrive.
class ControllableNetwork implements Network {
  public response: FeedsResponse = { feeds: [] };
  public loadResult: FactEnvelope[] = [];
  // Every feed a stream was opened for, and every feed whose stream was closed
  // again, in the order each happened. A test reads these to assert which feeds
  // are held open and that releasing them actually closed the stream.
  public readonly streamsOpened: string[] = [];
  public readonly streamsClosed: string[] = [];
  // References carried by a feed's *first* stream response, which is the
  // response the subscriber's start() waits on. A feed that delivers facts
  // there has already delivered by the time a clearing listener registers.
  public initialReferences: FactReference[] = [];
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
    this.streamsOpened.push(feed);
    // Resolve the subscriber's start() with its initial response.
    const initial = this.initialReferences;
    Promise.resolve().then(() => onResponse(initial, bookmark));
    // Record the close but keep the callback, so a test can still push through
    // a released feed and assert that nothing reaches the observer.
    return () => { this.streamsClosed.push(feed); };
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

  // A `watch` makes one pass over its feeds. When a feed answers that pass with
  // a pending authorization -- the authorizing fact has not reached the
  // replicator yet -- nothing used to fetch it again, so the watch stayed empty
  // after the race resolved (issue #394). It now holds exactly those feeds open
  // through the same subscribe path, and clears them through the same listener.
  describe("a watch holding a pending-authorization feed open (issue #394)", () => {
    it("delivers the rows once the pending feed delivers facts, with no refresh", async () => {
      const added: string[] = [];
      const observer = j.watch(blogPosts, blog, post => { added.push(j.hash(post)); });
      await observer.loaded();
      expect(added).toHaveLength(0);

      // The race resolves: the feed the watch held open delivers real facts.
      await network.deliver(FEED, [postRef]);
      await observer.processed();

      expect(added).toEqual([postRef.hash]);

      observer.stop();
    });

    it("emits one clearing diagnostic for the feed, reported against the watch", async () => {
      const received: DistributionDiagnostic[] = [];
      const observer = j.watch(blogPosts, blog, () => {});
      observer.onDiagnostic(d => received.push(d));
      await observer.loaded();

      expect(received).toHaveLength(1);
      expect(received[0].reactive).toBe(true);
      expect(received[0].cleared).toBeFalsy();
      expect(received[0].operation).toBe("watch");

      await network.deliver(FEED, [postRef]);
      await network.deliver(FEED, [postRef]);

      const cleared = received.filter(d => d.cleared);
      expect(cleared).toHaveLength(1);
      expect(cleared[0].feed).toBe(FEED);
      expect(cleared[0].cleared).toBe(true);
      expect(cleared[0].reactive).toBe(false);
      expect(cleared[0].operation).toBe("watch");
      expect(observer.diagnostics().filter(d => d.cleared)).toEqual(cleared);

      observer.stop();
    });

    // A structural denial says the shapes never matched, which no arriving fact
    // can change, so holding the feed open would wait on a race that cannot
    // resolve. The third case is a replicator that calls a structurally denied
    // feed reactive (observed on jinaga-replicator 3.7.7, issue #242): the code
    // is the narrower claim and it wins here too.
    it.each([
      ["denied with no-matching-rule", "denied" as const, "no-matching-rule" as const],
      ["denied with spec-more-restrictive-than-rule", "denied" as const, "spec-more-restrictive-than-rule" as const],
      ["reactive with a structural code", "reactive" as const, "no-matching-rule" as const],
    ])("opens no stream for a feed %s", async (_name, decision, code) => {
      network.response = {
        feeds: [FEED],
        decisions: [{ feed: FEED, decision, code, reason: "structurally denied" }],
      };

      const observer = j.watch(blogPosts, blog, () => {});
      await observer.loaded();

      expect(network.streamsOpened).toEqual([]);

      observer.stop();
    });

    it("opens no stream when every feed is authorized", async () => {
      network.response = {
        feeds: [FEED],
        decisions: [{ feed: FEED, decision: "authorized", reason: "authorized" }],
      };

      const observer = j.watch(blogPosts, blog, () => {});
      await observer.loaded();

      expect(network.streamsOpened).toEqual([]);

      observer.stop();
    });

    // Holding a feed can resolve its race in the same turn: if the feed's first
    // stream response already carries facts, the feed has delivered before a
    // clearing listener registers, and `onFeedData` fires that listener at
    // once. The raised diagnostic therefore has to be published before the hold
    // begins, or a consumer is told a diagnostic cleared before it is told the
    // diagnostic was raised.
    it("publishes the raised diagnostic before the clearing, even when the first response delivers facts", async () => {
      network.initialReferences = [postRef];
      const received: DistributionDiagnostic[] = [];
      const observer = j.watch(blogPosts, blog, () => {});
      observer.onDiagnostic(d => received.push(d));
      await observer.loaded();
      // Release the held feed before asserting, so a failure here does not
      // leave the subscriber's refresh timer running.
      observer.stop();

      expect(received.map(d => d.cleared === true)).toEqual([false, true]);
      expect(observer.diagnostics().map(d => d.cleared === true)).toEqual([false, true]);
    });

    it("releases the held feed on stop(), after which a delivery emits nothing", async () => {
      const added: string[] = [];
      const received: DistributionDiagnostic[] = [];
      const observer = j.watch(blogPosts, blog, post => { added.push(j.hash(post)); });
      observer.onDiagnostic(d => received.push(d));
      await observer.loaded();

      expect(network.streamsOpened).toEqual([FEED]);
      expect(network.streamsClosed).toEqual([]);

      observer.stop();

      expect(network.streamsClosed).toEqual([FEED]);

      await network.deliver(FEED, [postRef]);

      expect(added).toEqual([]);
      expect(received.filter(d => d.cleared)).toHaveLength(0);
    });
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
