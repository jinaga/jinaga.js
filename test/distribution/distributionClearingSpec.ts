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
  ReadDiagnostic,
} from "@src";
import { Network, NetworkManager } from "../../src/managers/NetworkManager";
import { DistributionIntersectionBranch } from "../../src/distribution/distribution-engine";
import { Blog, Post, model } from "../blogModel";
import { asDistribution } from "./diagnosticNarrowing";

// A Network double whose feed stream can be driven on demand, so a test can
// simulate a `reactive` feed's race resolving — the feed later delivering real
// facts (issue #207 W9). `loadResult` is what `load()` returns for the
// delivered references, so a test controls whether facts actually arrive.
class ControllableNetwork implements Network {
    // Stands in for a replicator, so it can supply facts the store lacks.
    readonly canLoad = true;

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
    const received: ReadDiagnostic[] = [];
    j.onDistributionDiagnostic(d => received.push(d));

    const observer = j.subscribe(blogPosts, blog, () => {});
    await observer.loaded();

    // Raised only, so far.
    expect(received).toHaveLength(1);
    expect(asDistribution(received[0]).reactive).toBe(true);
    expect(asDistribution(received[0]).cleared).toBeFalsy();
    expect(asDistribution(received[0]).feed).toBe(FEED);

    // The race resolves: the feed delivers real facts.
    await network.deliver(FEED, [postRef]);

    expect(received).toHaveLength(2);
    expect(asDistribution(received[1]).cleared).toBe(true);
    expect(asDistribution(received[1]).reactive).toBe(false);
    expect(asDistribution(received[1]).feed).toBe(FEED);
    expect(received[1].operation).toBe("subscribe");
    expect(received[1].reason).not.toContain("pending");

    observer.stop();
  });

  it("does NOT clear when the feed delivers references but no facts load", async () => {
    network.loadResult = []; // references arrive, but load returns an empty graph
    const received: ReadDiagnostic[] = [];
    j.onDistributionDiagnostic(d => received.push(d));

    const observer = j.subscribe(blogPosts, blog, () => {});
    await observer.loaded();
    await network.deliver(FEED, [postRef]);

    expect(received.filter(d => asDistribution(d).cleared)).toHaveLength(0);

    observer.stop();
  });

  it("exposes both the raised and clearing diagnostics via observer.diagnostics()", async () => {
    const observer = j.subscribe(blogPosts, blog, () => {});
    await observer.loaded();
    await network.deliver(FEED, [postRef]);

    const diagnostics = observer.diagnostics();
    expect(diagnostics).toHaveLength(2);
    expect(asDistribution(diagnostics[0]).cleared).toBeFalsy();
    expect(asDistribution(diagnostics[1]).cleared).toBe(true);

    observer.stop();
  });

  it("fires the clearing only once even if the feed delivers again", async () => {
    const received: ReadDiagnostic[] = [];
    j.onDistributionDiagnostic(d => received.push(d));

    const observer = j.subscribe(blogPosts, blog, () => {});
    await observer.loaded();

    await network.deliver(FEED, [postRef]);
    await network.deliver(FEED, [postRef]);

    const cleared = received.filter(d => asDistribution(d).cleared);
    expect(cleared).toHaveLength(1);

    observer.stop();
  });

  it("does not emit a clearing after the observer is stopped", async () => {
    const received: ReadDiagnostic[] = [];
    j.onDistributionDiagnostic(d => received.push(d));

    const observer = j.subscribe(blogPosts, blog, () => {});
    await observer.loaded();
    observer.stop();

    await network.deliver(FEED, [postRef]);

    expect(received.filter(d => asDistribution(d).cleared)).toHaveLength(0);
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
