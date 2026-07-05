import {
  AuthenticationNoOp,
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
// simulate a `reactive` feed's race resolving — the feed later delivering data
// (issue #207 W9).
class ControllableNetwork implements Network {
  public response: FeedsResponse = { feeds: [] };
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

  load(_factReferences: FactReference[]): Promise<FactEnvelope[]> { return Promise.resolve([]); }
  intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
    return Promise.resolve([{ start, specification }]);
  }

  // Test helper: deliver a novel fact reference on a feed, which the subscriber
  // treats as new data — triggering the feed's "began delivering" signal.
  async deliver(feed: string): Promise<void> {
    const cb = this.streamCallbacks.get(feed);
    if (!cb) throw new Error(`No stream open for feed ${feed}`);
    await cb([{ type: Post.Type, hash: "novel-post-hash" }], "bookmark-2");
  }
}

const FEED = "reactive-feed";

describe("distribution diagnostic clearing on transition (issue #207 W9)", () => {
  const blog = new Blog(new User("creator"), "domain");
  const blogPosts = model.given(Blog).match((blog, facts) =>
    facts.ofType(Post).join(post => post.blog, blog)
  );

  let network: ControllableNetwork;
  let store: MemoryStore;
  let j: Jinaga;

  beforeEach(() => {
    network = new ControllableNetwork();
    network.response = {
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "reactive", reason: "pending authorization" }],
    };
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

    // The race resolves: the feed delivers data.
    await network.deliver(FEED);

    expect(received).toHaveLength(2);
    expect(received[1].cleared).toBe(true);
    expect(received[1].feed).toBe(FEED);
    expect(received[1].operation).toBe("subscribe");

    observer.stop();
  });

  it("exposes both the raised and clearing diagnostics via observer.diagnostics()", async () => {
    const observer = j.subscribe(blogPosts, blog, () => {});
    await observer.loaded();
    await network.deliver(FEED);

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

    await network.deliver(FEED);
    await network.deliver(FEED);

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

    await network.deliver(FEED);

    expect(received.filter(d => d.cleared)).toHaveLength(0);
  });

  describe("NetworkManager.onFeedData", () => {
    it("fires a late-registered listener immediately once the feed has delivered", async () => {
      const manager = new NetworkManager(network, store, async () => {});
      const { feeds } = await manager.subscribe([], blogPosts.specification);
      await network.deliver(FEED);

      let fired = false;
      const unregister = manager.onFeedData(FEED, () => { fired = true; });
      expect(fired).toBe(true);
      unregister();
      // Release the subscriber so its refresh timer doesn't leak.
      manager.unsubscribe(feeds);
    });
  });
});
