import {
  AuthenticationNoOp,
  DistributionDeniedError,
  DistributionDiagnostic,
  FactManager,
  HttpConnection,
  HttpNetwork,
  HttpResponse,
  Jinaga,
  MemoryStore,
  ObservableSource,
  PassThroughFork,
  SyncStatusNotifier,
  WebClient,
} from "@src";
import { ContentTypeJson } from "../../src/http/ContentType";
import { isPendingAuthorization, isStructuralDenial, toDistributionDiagnostics } from "../../src/managers/distributionDiagnostic";
import { FeedDecision } from "../../src/http/messages";
import { Blog, Post, model } from "../blogModel";
import { User } from "@src";

const FEED = "feed-hash";

/**
 * An `HttpConnection` that answers `POST /feeds` with a caller-supplied raw
 * body, so the response travels the real `parseFeedsResponse` path rather than
 * being handed to the client as an already-typed object (issue #439). A client
 * test that constructs a `FeedsResponse` in TypeScript cannot reach the
 * mechanism this issue is about, because the parser is where the rejection
 * happened.
 */
class StubConnection implements HttpConnection {
  public feedsBody: unknown = { feeds: [] };

  get(path: string): Promise<{}> {
    if (path.startsWith("/feeds/")) {
      return Promise.resolve({ references: [], bookmark: "" });
    }
    return Promise.resolve({});
  }

  getStream(
    _path: string,
    onResponse: (response: {}) => Promise<void>,
    _onError: (err: Error) => void,
    _feedRefreshIntervalSeconds: number
  ): () => void {
    Promise.resolve().then(() => onResponse({ references: [], bookmark: "" }));
    return () => {};
  }

  post(path: string, _contentType: string, _accept: string | undefined, _body: string): Promise<HttpResponse> {
    if (path === "/feeds") {
      return Promise.resolve({ result: "success", response: this.feedsBody as {} });
    }
    if (path === "/load") {
      return Promise.resolve({ result: "success", response: { facts: [] } });
    }
    return Promise.resolve({ result: "success", response: {} });
  }

  getAcceptedContentTypes(_path: string): Promise<string[]> {
    return Promise.resolve([ContentTypeJson]);
  }
}

describe("a feeds decision this client does not know (issue #439)", () => {
  const creator = new User("creator");
  const blog = new Blog(creator, "domain");

  const blogPosts = model.given(Blog).match((blog, facts) =>
    facts.ofType(Post).join(post => post.blog, blog)
  );

  let connection: StubConnection;
  let j: Jinaga;

  beforeEach(() => {
    connection = new StubConnection();
    const webClient = new WebClient(connection, new SyncStatusNotifier(), { timeoutSeconds: 5 });
    const network = new HttpNetwork(webClient);
    const store = new MemoryStore();
    const factManager = new FactManager(
      new PassThroughFork(store),
      new ObservableSource(store),
      store,
      network,
      []
    );
    j = new Jinaga(new AuthenticationNoOp(), factManager, null);
  });

  // Criterion 1. A replicator that adds a denial code must not break a client
  // that predates it: the whole response, feeds included, was rejected before.
  it("uses the feeds and does not throw when the decision carries an unknown code", async () => {
    connection.feedsBody = {
      feeds: [FEED],
      decisions: [
        { feed: FEED, decision: "denied", code: "some-future-code", reason: "A future replicator said so." }
      ]
    };
    const received: DistributionDiagnostic[] = [];
    j.onDistributionDiagnostic(d => received.push(d));

    const posts = await j.query(blogPosts, blog);

    expect(posts).toEqual([]);
    expect(received).toHaveLength(1);
    expect(received[0].code).toBe("some-future-code");
    expect(received[0].reactive).toBe(false);
    expect(received[0].feed).toBe(FEED);
  });

  it("does not throw when an unknown code arrives on a reactive decision", async () => {
    connection.feedsBody = {
      feeds: [FEED],
      decisions: [
        { feed: FEED, decision: "reactive", code: "some-future-code", reason: "A future replicator said so." }
      ]
    };
    await expect(j.query(blogPosts, blog)).resolves.toEqual([]);
  });

  // Criterion 2. An unknown decision kind is reported as a denial that is
  // non-structural, and the kind reaches the diagnostic exactly as the
  // replicator sent it. No path mistakes it for authorization.
  it("reports an unknown decision kind as a non-structural denial, carrying the kind raw", async () => {
    connection.feedsBody = {
      feeds: [FEED],
      decisions: [
        { feed: FEED, decision: "some-future-kind", reason: "A future replicator said so." }
      ]
    };
    const received: DistributionDiagnostic[] = [];
    j.onDistributionDiagnostic(d => received.push(d));

    await expect(j.query(blogPosts, blog)).resolves.toEqual([]);

    expect(received).toHaveLength(1);
    expect(received[0].decision).toBe("some-future-kind");
    expect(received[0].reason).toBe("A future replicator said so.");
    expect(received[0].reactive).toBe(false);
    expect(isStructuralDenial(received[0])).toBe(false);
  });

  // Criterion 2, the case the issue's decision settles: an unknown kind is
  // non-structural even when a known structural code rides along with it,
  // because the code says why *that* verdict was reached and the client cannot
  // read the verdict. Throwing here would be the very breakage this issue is
  // about. The code is still carried, because it was already on the wire.
  it.each(["no-matching-rule", "spec-more-restrictive-than-rule"])(
    "does not throw when an unknown decision kind carries the structural code %s",
    async (code) => {
      connection.feedsBody = {
        feeds: [FEED],
        decisions: [
          { feed: FEED, decision: "some-future-kind", code, reason: "A future replicator said so." }
        ]
      };
      const received: DistributionDiagnostic[] = [];
      j.onDistributionDiagnostic(d => received.push(d));

      await expect(j.query(blogPosts, blog)).resolves.toEqual([]);

      expect(received).toHaveLength(1);
      expect(received[0].decision).toBe("some-future-kind");
      expect(received[0].code).toBe(code);
      expect(received[0].reactive).toBe(false);
      expect(isStructuralDenial(received[0])).toBe(false);
    }
  );

  // Criterion 3. The tolerance must not swallow the denial a known structural
  // code reports.
  it("still throws DistributionDeniedError for a known structural code", async () => {
    connection.feedsBody = {
      feeds: [],
      decisions: [
        { feed: FEED, decision: "denied", code: "no-matching-rule", reason: "No rules apply to this feed." }
      ]
    };
    await expect(j.query(blogPosts, blog)).rejects.toBeInstanceOf(DistributionDeniedError);
  });

  // Criterion 4. A malformed shape is still a failure, so the tolerance cannot
  // be mistaken for "parse whatever arrives".
  it("still fails the whole response when the shape is malformed", async () => {
    connection.feedsBody = { decisions: [] };
    await expect(j.query(blogPosts, blog)).rejects.toThrow(/'feeds'/);
  });
});

describe("classifying a decision this client does not know (issue #439)", () => {
  function decision(overrides: Partial<FeedDecision>): FeedDecision {
    return { feed: FEED, decision: "denied", reason: "", ...overrides };
  }

  // An unknown code is not structural: nothing about a code this client cannot
  // read says the shapes never matched, so it must not reach the throw.
  it.each(["reactive", "denied"] as const)(
    "never reports an unknown code as structural, on a %s decision",
    (kind) => {
      const diagnostics = toDistributionDiagnostics(
        "query",
        "spec",
        [decision({ decision: kind, code: "some-future-code" })]
      );
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].code).toBe("some-future-code");
      expect(diagnostics[0].reactive).toBe(false);
      expect(isStructuralDenial(diagnostics[0])).toBe(false);
    }
  );

  // An unknown kind is never authorized: silence is reserved for a feed the
  // replicator positively authorized, so one this client cannot read is
  // reported like any other withheld feed. It is never pending and never
  // structural, whatever code accompanies it.
  it.each([undefined, "no-matching-rule", "spec-more-restrictive-than-rule", "principal-excluded", "some-future-code"])(
    "reports an unknown decision kind carrying code %s as a non-structural, non-pending denial",
    (code) => {
      const d = decision({ decision: "some-future-kind", code });
      const diagnostics = toDistributionDiagnostics("query", "spec", [d]);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].decision).toBe("some-future-kind");
      expect(diagnostics[0].code).toBe(code);
      expect(diagnostics[0].reactive).toBe(false);
      expect(isStructuralDenial(diagnostics[0])).toBe(false);
      expect(isPendingAuthorization(d)).toBe(false);
    }
  );

  // An `authorized` decision raises no diagnostic, unknown code or not.
  it("raises no diagnostic for an authorized decision carrying an unknown code", () => {
    expect(toDistributionDiagnostics(
      "query",
      "spec",
      [decision({ decision: "authorized", code: "some-future-code" })]
    )).toEqual([]);
  });

  // An unknown code gives no basis for the positive claim `reactive: true`
  // makes -- that an arriving fact can heal this feed -- so a watch must not
  // hold a feed open waiting on one.
  it("does not read a reactive decision with an unknown code as pending authorization", () => {
    expect(isPendingAuthorization(decision({ decision: "reactive", code: "some-future-code" })))
      .toBe(false);
  });

  // The known cases are unchanged.
  it("still reads a reactive decision with a known non-structural code as pending", () => {
    expect(isPendingAuthorization(decision({ decision: "reactive", code: "principal-excluded" })))
      .toBe(true);
    expect(isPendingAuthorization(decision({ decision: "reactive" }))).toBe(true);
    expect(isPendingAuthorization(decision({ decision: "reactive", code: "no-matching-rule" })))
      .toBe(false);
  });
});
