import {
  AuthenticationNoOp,
  dehydrateFact,
  DistributionDiagnostic,
  FactEnvelope,
  FeedDecision,
  FactManager,
  Fork,
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
import { waitForCondition } from "../utils/async-test-utils";

// Yield to the macrotask queue, which drains every microtask behind it. Not a
// delay: `setImmediate` runs as soon as the work already queued is done, so
// nothing here waits on a clock.
const drain = () => new Promise<void>(resolve => setImmediate(resolve));

// A Network double whose feed stream can be driven on demand, so a test can
// simulate a `reactive` feed's race resolving — the feed later delivering real
// facts (issue #207 W9). `loadResult` is what `load()` returns for the
// delivered references, so a test controls whether facts actually arrive.
class ControllableNetwork implements Network {
  public response: FeedsResponse = { feeds: [] };
  public loadResult: FactEnvelope[] = [];
  /**
   * How many `POST /feeds` requests this network has answered (issue #394).
   * A watch that asks the replicator again rather than reading its own cache
   * is the thing criterion 2 is about, and this is where it shows.
   */
  public feedsRequests = 0;
  /** When set, `feeds()` rejects with it, as a lost connection does. */
  public feedsError: unknown = null;
  /**
   * References a feed delivers on its next fetch, consumed when it does, so a
   * feed delivers its rows once and the fetch loop then terminates.
   */
  public readonly feedResults = new Map<string, FactReference[]>();
  /** Feeds a subscriber opened a stream for (issue #394 criterion 8). */
  public readonly streamedFeeds: string[] = [];
  private streamCallbacks = new Map<string, (refs: FactReference[], bookmark: string) => Promise<void>>();

  feeds(): Promise<FeedsResponse> {
    this.feedsRequests++;
    if (this.feedsError !== null) {
      return Promise.reject(this.feedsError);
    }
    return Promise.resolve(this.response);
  }
  fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
    const references = this.feedResults.get(feed) ?? [];
    this.feedResults.delete(feed);
    return Promise.resolve({ references, bookmark });
  }

  streamFeed(
    feed: string,
    bookmark: string,
    onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>,
    _onError: (err: Error) => void,
    _feedRefreshIntervalSeconds: number
  ): () => void {
    this.streamedFeeds.push(feed);
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
  //
  // A watch now asks the replicator again for a pending feed (issue #394), and
  // a feed that clears or settles under that second question is answered, so it
  // no longer withholds the date. What still withholds it is a feed that is
  // neither: here the second question cannot reach the replicator, so it
  // decided nothing and the feed is still pending when the load ends. Issue
  // #394's own tests cover the clearing and settling cases.
  it("writes no date for a watch whose only feed is pending", async () => {
    network.response = {
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "reactive", reason: "pending authorization" }],
    };
    const answer = network.feeds.bind(network);
    let asked = 0;
    network.feeds = () => {
      asked++;
      return asked === 1 ? answer() : Promise.reject(new Error("the connection failed"));
    };

    const first = j.watch(blogPosts, blog, () => {});
    await first.loaded();
    first.stop();

    network.feeds = answer;

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

/**
 * A Fork double for issue #394's step 1 and step 3.
 *
 * What the watch reads from a fork is a flush it can start, an outcome that
 * flush reports, and the progress notifications that say a batch has left. So
 * that is all this scripts. `onFlush` is where a test makes the replicator's
 * answer change, which is what sending the authorizing fact does in the field.
 */
class ScriptedFork implements Fork {
  /** How many flushes this fork has been asked for. */
  public flushes = 0;
  /**
   * What `processQueueNow` does. `ends` is a flush that finished, however it
   * finished -- the facts were accepted, they were refused, or there were none.
   * `fails` is one that rejected. `retrying` reports a retry and never answers,
   * which is a `POST /save` under `retry: { timeoutMs: 0 }`.
   */
  public flushOutcome: 'ends' | 'fails' | 'retrying' = 'ends';
  /** Run as a flush starts, so a test can move the replicator's graph on. */
  public onFlush: () => void = () => { };
  private readonly progressListeners = new Set<(count: number) => void>();
  private readonly retryListeners = new Set<() => void>();

  async save(_envelopes: FactEnvelope[]): Promise<void> {
    // The store write is the fact manager's; this double only queues.
  }

  onProgress(listener: (count: number) => void): () => void {
    this.progressListeners.add(listener);
    return () => { this.progressListeners.delete(listener); };
  }

  onRetrying(listener: () => void): () => void {
    this.retryListeners.add(listener);
    return () => { this.retryListeners.delete(listener); };
  }

  async load(_references: FactReference[]): Promise<FactEnvelope[]> {
    return [];
  }

  processQueueNow(): Promise<void> {
    this.flushes++;
    this.onFlush();
    if (this.flushOutcome === 'retrying') {
      this.notifyRetrying();
      // An unbounded schedule: the flush never ends on its own, which is why
      // the watch cannot wait for it.
      return new Promise<void>(() => { });
    }
    if (this.flushOutcome === 'fails') {
      return Promise.reject(new Error("the connection failed"));
    }
    return Promise.resolve();
  }

  async close(): Promise<void> { }

  /** Fire a progress notification, as the saver does after each batch. */
  public reportProgress(count: number): void {
    for (const listener of [...this.progressListeners]) {
      listener(count);
    }
  }

  /** How many listeners the watch currently holds on the progress channel. */
  public get progressListenerCount(): number {
    return this.progressListeners.size;
  }

  private notifyRetrying(): void {
    for (const listener of [...this.retryListeners]) {
      listener();
    }
  }
}

// Issue #394. A watch makes one pass over its feeds. When the replicator
// answers that pass `reactive` because the authorizing fact has not reached it
// yet, nothing used to ask again, so the watch stayed empty after the race
// resolved. These drive the mechanism -- a network whose decisions a test
// scripts, and a fork whose flush outcome and progress notifications it fires
// -- rather than a whole JinagaTest.
describe("a watch resolves a feed pending authorization (issue #394)", () => {
  const blog = new Blog(new User("creator"), "domain");
  const blogPosts = model.given(Blog).match((blog, facts) =>
    facts.ofType(Post).join(post => post.blog, blog)
  );

  const post = new Post(blog, new User("author"), "2020-01-01T00:00:00Z");
  const postRecords = dehydrateFact(post);
  const postEnvelopes: FactEnvelope[] = postRecords.map(f => ({ fact: f, signatures: [] }));
  const postRef: FactReference = { type: postRecords[postRecords.length - 1].type, hash: postRecords[postRecords.length - 1].hash };

  const PENDING: FeedsResponse = {
    feeds: [FEED],
    decisions: [{ feed: FEED, decision: "reactive", code: "principal-excluded", reason: "pending authorization" }],
  };

  let network: ControllableNetwork;
  let fork: ScriptedFork;
  let store: MemoryStore;
  let j: Jinaga;
  let diagnostics: DistributionDiagnostic[];

  // The replicator has received the authorizing fact: the same request it
  // answered `reactive` is answered `authorized`, and the feed delivers.
  function authorize(feed: string = FEED): void {
    network.response = {
      feeds: [feed],
      decisions: [{ feed, decision: "authorized", reason: "authorized" }],
    };
    network.feedResults.set(feed, [postRef]);
  }

  beforeEach(() => {
    network = new ControllableNetwork();
    network.response = PENDING;
    network.loadResult = postEnvelopes;
    store = new MemoryStore();
    fork = new ScriptedFork();
    const factManager = new FactManager(fork, new ObservableSource(store), store, network, []);
    j = new Jinaga(new AuthenticationNoOp(), factManager, null);
    diagnostics = [];
    j.onDistributionDiagnostic(d => diagnostics.push(d));
  });

  // Criteria 1, 2, 3 and 8. Fails on `main`, where a watch never asks again:
  // the pass is answered `reactive`, the cached response is returned to every
  // later fetch, and no row ever arrives.
  it("flushes, asks again, and delivers the rows before the load resolves", async () => {
    fork.onFlush = () => authorize();
    const rows: any[] = [];

    const observer = j.watch(blogPosts, blog, p => { rows.push(p); });
    await observer.loaded();

    // Criterion 1: the rows are there by the time the load resolves, with no
    // refresh, remount or new watch.
    expect(rows).toHaveLength(1);
    // Criterion 2: the replicator was asked twice, the second time after the
    // flush. A watch that read its cached response would have asked once.
    expect(network.feedsRequests).toBe(2);
    expect(fork.flushes).toBe(1);
    // Criterion 3: it clears once, as a watch.
    const cleared = diagnostics.filter(d => d.cleared);
    expect(cleared).toHaveLength(1);
    expect(cleared[0].feed).toBe(FEED);
    expect(cleared[0].operation).toBe("watch");
    expect(cleared[0].reactive).toBe(false);
    expect(diagnostics.filter(d => d.settled)).toHaveLength(0);
    // Criterion 8: no feed subscription anywhere in it.
    expect(network.streamedFeeds).toEqual([]);

    observer.stop();
  });

  // Criterion 1, where authorizing replaces the feed rather than re-deciding
  // it: the replicator answers with the specification's own feeds, so the
  // pending feed is not named at all. It is no longer withheld either way.
  it("clears a pending feed the second answer no longer names", async () => {
    fork.onFlush = () => authorize("authorized-feed");
    const rows: any[] = [];

    const observer = j.watch(blogPosts, blog, p => { rows.push(p); });
    await observer.loaded();

    expect(rows).toHaveLength(1);
    expect(diagnostics.filter(d => d.cleared).map(d => d.feed)).toEqual([FEED]);

    observer.stop();
  });

  // Criterion 4. The flush ended and the replicator still withholds the feed,
  // so this client has nothing left to send that could change the answer.
  it("settles the feed when the flush ended and the second answer still withholds it", async () => {
    const observer = j.watch(blogPosts, blog, () => { });
    await observer.loaded();

    expect(network.feedsRequests).toBe(2);
    const settled = diagnostics.filter(d => d.settled);
    expect(settled).toHaveLength(1);
    expect(settled[0].feed).toBe(FEED);
    expect(settled[0].code).toBe("principal-excluded");
    expect(settled[0].decision).toBe("denied");
    expect(settled[0].reactive).toBe(false);
    expect(settled[0].operation).toBe("watch");
    expect(diagnostics.filter(d => d.cleared)).toHaveLength(0);

    observer.stop();
  });

  // Criterion 4 again, for a flush that ended by failing. Whether a flushed
  // fact was accepted or refused is not consulted: either way the next fetch
  // is the replicator's answer.
  it("settles the feed when the flush ended by failing", async () => {
    fork.flushOutcome = 'fails';

    const observer = j.watch(blogPosts, blog, () => { });
    await observer.loaded();

    expect(network.feedsRequests).toBe(2);
    expect(diagnostics.filter(d => d.settled)).toHaveLength(1);

    observer.stop();
  });

  // Criterion 4, emitted at most once per feed until it clears. A refresh makes
  // a whole new pass, and the feed is already settled.
  it("settles a feed once, however many passes find it pending", async () => {
    const observer = j.watch(blogPosts, blog, () => { });
    await observer.loaded();
    await observer.refresh();

    expect(fork.flushes).toBe(2);
    expect(diagnostics.filter(d => d.settled)).toHaveLength(1);

    observer.stop();
  });

  // Criterion 5. A flush that is retrying is one the replicator is not
  // answering, so asking it about the feed would answer about a graph that has
  // not received the fact. Waiting for the schedule instead would hold the load
  // for the whole retry budget, which is unbounded here.
  it("resolves the load at the first retry, and settles nothing", async () => {
    fork.flushOutcome = 'retrying';
    const rows: any[] = [];

    const observer = j.watch(blogPosts, blog, p => { rows.push(p); });
    await observer.loaded();

    expect(fork.flushes).toBe(1);
    expect(network.feedsRequests).toBe(1);
    expect(diagnostics.filter(d => d.settled)).toHaveLength(0);
    expect(diagnostics.filter(d => d.cleared)).toHaveLength(0);
    expect(rows).toEqual([]);

    observer.stop();
  });

  // Criterion 6. The fetch decided nothing, so it clears and settles nothing,
  // and the load still does not reject: the first pass succeeded.
  it("leaves the feed pending when the second fetch cannot connect", async () => {
    fork.onFlush = () => { network.feedsError = new Error("the connection failed"); };

    const observer = j.watch(blogPosts, blog, () => { });
    await expect(observer.loaded()).resolves.toBeUndefined();

    expect(network.feedsRequests).toBe(2);
    expect(diagnostics.filter(d => d.settled)).toHaveLength(0);
    expect(diagnostics.filter(d => d.cleared)).toHaveLength(0);

    observer.stop();
  });

  // Criterion 7, from criterion 5. The retry succeeded in the end, which is
  // what the batch leaving the queue reports, and that is the signal to ask
  // again -- not a clock of this issue's own.
  it("asks again after a later batch leaves, from a retrying flush", async () => {
    fork.flushOutcome = 'retrying';
    const rows: any[] = [];

    const observer = j.watch(blogPosts, blog, p => { rows.push(p); });
    await observer.loaded();
    expect(rows).toEqual([]);

    authorize();
    fork.reportProgress(0);
    await observer.processed();
    // The fetch the notification started is not awaited by anything the test
    // holds, so wait for the diagnostic it produces.
    await waitForCondition(() => diagnostics.some(d => d.cleared));

    expect(rows).toHaveLength(1);
    expect(diagnostics.filter(d => d.cleared)).toHaveLength(1);
    expect(fork.flushes).toBe(1);

    observer.stop();
  });

  // Criterion 7, from criterion 6, and for a fact first written after the load
  // resolved. A save puts facts *into* the queue, which is not a batch leaving,
  // so the count going up fetches nothing; the batch leaving does.
  it("asks again only when a notification reports a batch leaving", async () => {
    fork.onFlush = () => { network.feedsError = new Error("the connection failed"); };

    const observer = j.watch(blogPosts, blog, () => { });
    await observer.loaded();
    expect(network.feedsRequests).toBe(2);

    network.feedsError = null;
    authorize();

    // Two facts queued: the count rises, and nothing has reached the
    // replicator.
    fork.reportProgress(2);
    expect(network.feedsRequests).toBe(2);

    // A batch leaves.
    fork.reportProgress(1);
    await waitForCondition(() => diagnostics.some(d => d.cleared));
    expect(network.feedsRequests).toBe(3);

    observer.stop();
  });

  // Criterion 9. Neither state can be changed by a fact this client sends, so
  // there is nothing to flush for and nothing to ask again about.
  it("makes no flush, no second fetch and no progress listener for a structural denial", async () => {
    network.response = {
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "denied", code: "no-matching-rule", reason: "no rule matches" }],
    };

    const observer = j.watch(blogPosts, blog, () => { });
    await observer.loaded();

    expect(fork.flushes).toBe(0);
    expect(network.feedsRequests).toBe(1);
    expect(fork.progressListenerCount).toBe(0);

    observer.stop();
  });

  it("makes no flush, no second fetch and no progress listener when every feed is authorized", async () => {
    network.response = {
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "authorized", reason: "authorized" }],
    };

    const observer = j.watch(blogPosts, blog, () => { });
    await observer.loaded();

    expect(fork.flushes).toBe(0);
    expect(network.feedsRequests).toBe(1);
    expect(fork.progressListenerCount).toBe(0);

    observer.stop();
  });

  // Criterion 10.
  it("releases the progress listener on stop, and fetches nothing afterwards", async () => {
    fork.flushOutcome = 'retrying';

    const observer = j.watch(blogPosts, blog, () => { });
    await observer.loaded();
    expect(fork.progressListenerCount).toBe(1);

    observer.stop();
    expect(fork.progressListenerCount).toBe(0);

    const asked = network.feedsRequests;
    const raised = diagnostics.length;
    authorize();
    fork.reportProgress(0);
    await drain();

    expect(network.feedsRequests).toBe(asked);
    expect(diagnostics).toHaveLength(raised);
  });

  // Criterion 11. A settled feed is the replicator's answer to everything this
  // client has sent, so the local graph is as complete as this replica can make
  // it and an instant cached read of it is correct.
  it("writes the cache date once the pending feed settles", async () => {
    const first = j.watch(blogPosts, blog, () => { });
    await first.loaded();
    expect(diagnostics.filter(d => d.settled)).toHaveLength(1);
    first.stop();

    const second = j.watch(blogPosts, blog, () => { });
    expect(await second.cached()).toBe(true);
    await second.loaded();
    second.stop();
  });

  it("writes the cache date once the pending feed clears", async () => {
    fork.onFlush = () => authorize();

    const first = j.watch(blogPosts, blog, () => { });
    await first.loaded();
    first.stop();

    const second = j.watch(blogPosts, blog, () => { });
    expect(await second.cached()).toBe(true);
    await second.loaded();
    second.stop();
  });

  it("writes no cache date while the feed is neither cleared nor settled", async () => {
    fork.flushOutcome = 'retrying';

    const first = j.watch(blogPosts, blog, () => { });
    await first.loaded();
    first.stop();

    const second = j.watch(blogPosts, blog, () => { });
    expect(await second.cached()).toBe(false);
    second.stop();
  });

  // Criterion 12. A subscription holds its feeds open and hears the race
  // resolve through the clearing listeners, so it borrows none of this.
  it("leaves a subscription's feeds to the subscription", async () => {
    const observer = j.subscribe(blogPosts, blog, () => { });
    await observer.loaded();

    expect(fork.flushes).toBe(0);
    expect(network.feedsRequests).toBe(1);
    expect(fork.progressListenerCount).toBe(0);
    expect(diagnostics.filter(d => d.settled)).toHaveLength(0);

    observer.stop();
  });
});

// Issue #394 for `watchRows`, which had the same gap and no `refresh()` at all.
// The rule is one rule in one place, so these assert that the stream reaches it
// rather than re-asserting what it does.
describe("a watchRows stream resolves a feed pending authorization (issue #394)", () => {
  const blog = new Blog(new User("creator"), "domain");
  const blogPosts = model.given(Blog).match((blog, facts) =>
    facts.ofType(Post).join(post => post.blog, blog)
  );

  const post = new Post(blog, new User("author"), "2020-01-01T00:00:00Z");
  const postRecords = dehydrateFact(post);
  const postEnvelopes: FactEnvelope[] = postRecords.map(f => ({ fact: f, signatures: [] }));
  const postRef: FactReference = { type: postRecords[postRecords.length - 1].type, hash: postRecords[postRecords.length - 1].hash };

  let network: ControllableNetwork;
  let fork: ScriptedFork;
  let store: MemoryStore;
  let j: Jinaga;
  let diagnostics: DistributionDiagnostic[];

  function authorize(): void {
    network.response = {
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "authorized", reason: "authorized" }],
    };
    network.feedResults.set(FEED, [postRef]);
  }

  beforeEach(() => {
    network = new ControllableNetwork();
    network.response = {
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "reactive", code: "principal-excluded", reason: "pending authorization" }],
    };
    network.loadResult = postEnvelopes;
    store = new MemoryStore();
    fork = new ScriptedFork();
    const factManager = new FactManager(fork, new ObservableSource(store), store, network, []);
    j = new Jinaga(new AuthenticationNoOp(), factManager, null);
    diagnostics = [];
    j.onDistributionDiagnostic(d => diagnostics.push(d));
  });

  // Criteria 1, 2, 3 and 8. Fails on `main`, where `watchRows` fetches once and
  // has no `refresh()` to fall back on.
  it("flushes, asks again, and delivers the rows before the stream is returned", async () => {
    fork.onFlush = () => authorize();

    const stream = await j.watchRows(blogPosts, blog);
    const changes = stream[Symbol.asyncIterator]();
    const first = await changes.next();

    expect(first.value.operation).toBe("added");
    expect(Jinaga.hash(first.value.result)).toBe(postRef.hash);
    expect(network.feedsRequests).toBe(2);
    expect(fork.flushes).toBe(1);
    const cleared = diagnostics.filter(d => d.cleared);
    expect(cleared).toHaveLength(1);
    expect(cleared[0].operation).toBe("watch");
    expect(network.streamedFeeds).toEqual([]);

    stream.stop();
  });

  // Criterion 4.
  it("settles the feed when the flush ended and the second answer still withholds it", async () => {
    const stream = await j.watchRows(blogPosts, blog);

    expect(network.feedsRequests).toBe(2);
    const settled = diagnostics.filter(d => d.settled);
    expect(settled).toHaveLength(1);
    expect(settled[0].feed).toBe(FEED);
    expect(settled[0].operation).toBe("watch");

    stream.stop();
  });

  // Criterion 5.
  it("returns the stream at the first retry, and settles nothing", async () => {
    fork.flushOutcome = 'retrying';

    const stream = await j.watchRows(blogPosts, blog);

    expect(network.feedsRequests).toBe(1);
    expect(diagnostics.filter(d => d.settled)).toHaveLength(0);
    expect(stream.pending).toBe(0);

    stream.stop();
  });

  // Criteria 6 and 7.
  it("asks again after a later batch leaves, having failed to connect", async () => {
    fork.onFlush = () => { network.feedsError = new Error("the connection failed"); };

    const stream = await j.watchRows(blogPosts, blog);
    const changes = stream[Symbol.asyncIterator]();
    expect(network.feedsRequests).toBe(2);
    expect(diagnostics.filter(d => d.settled)).toHaveLength(0);

    network.feedsError = null;
    authorize();
    fork.reportProgress(0);

    const first = await changes.next();
    expect(first.value.operation).toBe("added");
    expect(Jinaga.hash(first.value.result)).toBe(postRef.hash);
    // The rows arrive from inside the fetch, so the clearing diagnostic the
    // fetch's own decisions produce follows them.
    await waitForCondition(() => diagnostics.some(d => d.cleared));
    expect(diagnostics.filter(d => d.cleared)).toHaveLength(1);

    stream.stop();
  });

  // Criterion 9.
  it("makes no flush and no second fetch when every feed is authorized", async () => {
    network.response = {
      feeds: [FEED],
      decisions: [{ feed: FEED, decision: "authorized", reason: "authorized" }],
    };

    const stream = await j.watchRows(blogPosts, blog);

    expect(fork.flushes).toBe(0);
    expect(network.feedsRequests).toBe(1);
    expect(fork.progressListenerCount).toBe(0);

    stream.stop();
  });

  // Criterion 10.
  it("releases the progress listener on stop", async () => {
    fork.flushOutcome = 'retrying';

    const stream = await j.watchRows(blogPosts, blog);
    expect(fork.progressListenerCount).toBe(1);

    stream.stop();
    expect(fork.progressListenerCount).toBe(0);

    const asked = network.feedsRequests;
    authorize();
    fork.reportProgress(0);
    await drain();
    expect(network.feedsRequests).toBe(asked);
  });

  // Criterion 12, for the stream that holds its feeds open.
  it("leaves a subscribeRows stream's feeds to the subscription", async () => {
    const stream = await j.subscribeRows(blogPosts, blog);

    expect(fork.flushes).toBe(0);
    expect(network.feedsRequests).toBe(1);
    expect(fork.progressListenerCount).toBe(0);
    expect(diagnostics.filter(d => d.settled)).toHaveLength(0);

    stream.stop();
  });

  // Criterion 9 for the stream that makes no fetch at all.
  it("makes no flush for a watchChanges stream, which does not fetch", async () => {
    const stream = await j.watchChanges(blogPosts, blog);

    expect(fork.flushes).toBe(0);
    expect(network.feedsRequests).toBe(0);
    expect(fork.progressListenerCount).toBe(0);

    stream.stop();
  });
});
