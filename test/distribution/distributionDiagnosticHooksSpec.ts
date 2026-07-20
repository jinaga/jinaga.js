import {
  AuthenticationNoOp,
  DistributionDeniedError,
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
import { Network } from "../../src/managers/NetworkManager";
import { DistributionIntersectionBranch } from "../../src/distribution/distribution-engine";
import { Blog, Post, model } from "../blogModel";

// A Network double that reports caller-configured feed hashes and per-feed
// decisions from `feeds()` (issue #207 W3/W4), and resolves subscriptions
// immediately so watch/subscribe complete. Drives the W5 instance hook and the
// W6 observer channel the way a real replicator would.
class DecisionNetwork implements Network {
  public response: FeedsResponse = { feeds: [] };

  feeds(_start: FactReference[], _specification: Specification): Promise<FeedsResponse> {
    return Promise.resolve(this.response);
  }

  fetchFeed(_feed: string, bookmark: string): Promise<FeedResponse> {
    return Promise.resolve({ references: [], bookmark });
  }

  streamFeed(
    _feed: string,
    bookmark: string,
    onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>,
    _onError: (err: Error) => void,
    _feedRefreshIntervalSeconds: number
  ): () => void {
    // Deliver an empty response so the subscriber's start() promise resolves.
    Promise.resolve().then(() => onResponse([], bookmark));
    return () => {};
  }

  load(_factReferences: FactReference[]): Promise<FactEnvelope[]> {
    return Promise.resolve([]);
  }

  intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
    return Promise.resolve([{ start, specification }]);
  }
}

describe("distribution diagnostic hooks (issue #207 W5/W6)", () => {
  const creator = new User("creator");
  const blog = new Blog(creator, "domain");

  const blogPosts = model.given(Blog).match((blog, facts) =>
    facts.ofType(Post).join(post => post.blog, blog)
  );

  const FEED = "feed-hash";

  let network: DecisionNetwork;
  let store: MemoryStore;
  let j: Jinaga;

  beforeEach(() => {
    network = new DecisionNetwork();
    store = new MemoryStore();
    const observableSource = new ObservableSource(store);
    const fork = new PassThroughFork(store);
    const factManager = new FactManager(fork, observableSource, store, network, []);
    j = new Jinaga(new AuthenticationNoOp(), factManager, null);
  });

  function deniedResponse(): FeedsResponse {
    return {
      feeds: [],
      decisions: [
        { feed: "denied-feed", decision: "denied", code: "no-matching-rule", reason: "No rules apply to this feed." },
      ],
    };
  }

  function reactiveResponse(): FeedsResponse {
    return {
      feeds: [FEED],
      decisions: [
        { feed: FEED, decision: "reactive", reason: "pending authorization" },
      ],
    };
  }

  describe("W5 — j.onDistributionDiagnostic", () => {
    it("fires for query with operation 'query' (the hook fires before the structural denial throws)", async () => {
      network.response = deniedResponse();
      const received: DistributionDiagnostic[] = [];
      j.onDistributionDiagnostic(d => received.push(d));

      // A structural denial now makes a one-shot query throw by default
      // (issue jinaga-server#179). The diagnostic hook still fires first.
      await expect(j.query(blogPosts, blog)).rejects.toBeInstanceOf(DistributionDeniedError);

      expect(received).toHaveLength(1);
      expect(received[0].operation).toBe("query");
      expect(received[0].decision).toBe("denied");
      expect(received[0].reactive).toBe(false);
      expect(received[0].code).toBe("no-matching-rule");
    });

    it("fires for watch with operation 'watch'", async () => {
      network.response = deniedResponse();
      const received: DistributionDiagnostic[] = [];
      j.onDistributionDiagnostic(d => received.push(d));

      const observer = j.watch(blogPosts, blog, () => {});
      await observer.loaded();
      observer.stop();

      expect(received).toHaveLength(1);
      expect(received[0].operation).toBe("watch");
      expect(received[0].decision).toBe("denied");
    });

    it("fires for subscribe with operation 'subscribe' and reactive:true, without throwing", async () => {
      network.response = reactiveResponse();
      const received: DistributionDiagnostic[] = [];
      j.onDistributionDiagnostic(d => received.push(d));

      const observer = j.subscribe(blogPosts, blog, () => {});
      await expect(observer.loaded()).resolves.toBeUndefined();
      observer.stop();

      expect(received).toHaveLength(1);
      expect(received[0].operation).toBe("subscribe");
      expect(received[0].decision).toBe("reactive");
      expect(received[0].reactive).toBe(true);
    });

    it("does not fire for authorized-only feeds", async () => {
      network.response = {
        feeds: [FEED],
        decisions: [{ feed: FEED, decision: "authorized", reason: "" }],
      };
      const received: DistributionDiagnostic[] = [];
      j.onDistributionDiagnostic(d => received.push(d));

      await j.query(blogPosts, blog);

      expect(received).toEqual([]);
    });

    it("is inert against an old replicator that omits decisions", async () => {
      network.response = { feeds: [FEED] };
      const received: DistributionDiagnostic[] = [];
      j.onDistributionDiagnostic(d => received.push(d));

      await j.query(blogPosts, blog);
      const observer = j.watch(blogPosts, blog, () => {});
      await observer.loaded();
      observer.stop();

      expect(received).toEqual([]);
    });

    it("isolates a throwing handler so the operation still succeeds", async () => {
      // A reactive decision never throws (it self-heals), so this isolates the
      // handler-isolation behavior from the structural-denial throw path.
      network.response = reactiveResponse();
      const received: DistributionDiagnostic[] = [];
      j.onDistributionDiagnostic(() => { throw new Error("handler boom"); });
      j.onDistributionDiagnostic(d => received.push(d));

      await expect(j.query(blogPosts, blog)).resolves.toEqual([]);
      expect(received).toHaveLength(1);
    });
  });

  describe("W6 — observer.diagnostics() / onDiagnostic", () => {
    it("exposes captured diagnostics via observer.diagnostics()", async () => {
      network.response = reactiveResponse();

      const observer = j.subscribe(blogPosts, blog, () => {});
      await observer.loaded();

      const diagnostics = observer.diagnostics();
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].operation).toBe("subscribe");
      expect(diagnostics[0].reactive).toBe(true);
      observer.stop();
    });

    it("delivers to onDiagnostic and replays already-captured diagnostics", async () => {
      network.response = deniedResponse();

      const observer = j.watch(blogPosts, blog, () => {});
      await observer.loaded();

      // Registered after load — the already-captured diagnostic must replay.
      const received: DistributionDiagnostic[] = [];
      observer.onDiagnostic(d => received.push(d));

      expect(received).toHaveLength(1);
      expect(received[0].operation).toBe("watch");
      expect(received[0].code).toBe("no-matching-rule");
      observer.stop();
    });

    it("never rejects loaded() for a denied feed", async () => {
      network.response = deniedResponse();

      const observer = j.watch(blogPosts, blog, () => {});
      await expect(observer.loaded()).resolves.toBeUndefined();
      expect(observer.diagnostics()).toHaveLength(1);
      observer.stop();
    });
  });
});
