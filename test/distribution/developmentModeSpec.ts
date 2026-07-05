import {
  AuthenticationNoOp,
  DistributionDeniedError,
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
import { createDevelopmentDiagnosticHandler } from "../../src/managers/developmentDiagnosticHandler";
import { DistributionDiagnostic } from "../../src/managers/distributionDiagnostic";
import { Blog, Post, model } from "../blogModel";

class DecisionNetwork implements Network {
  public response: FeedsResponse = { feeds: [] };
  feeds(): Promise<FeedsResponse> { return Promise.resolve(this.response); }
  fetchFeed(_feed: string, bookmark: string): Promise<FeedResponse> { return Promise.resolve({ references: [], bookmark }); }
  streamFeed(): () => void { return () => {}; }
  load(): Promise<FactEnvelope[]> { return Promise.resolve([]); }
  intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
    return Promise.resolve([{ start, specification }]);
  }
}

function diagnostic(overrides: Partial<DistributionDiagnostic>): DistributionDiagnostic {
  return {
    operation: "query",
    specification: "(p1: Blog) { u1: Post [ u1->blog: Blog = p1 ] } => u1",
    decision: "denied",
    reactive: false,
    reason: "reason text",
    ...overrides,
  };
}

describe("development-mode distribution diagnostics (issue #207 W7/W8)", () => {
  const blog = new Blog(new User("creator"), "domain");
  const blogPosts = model.given(Blog).match((blog, facts) =>
    facts.ofType(Post).join(post => post.blog, blog)
  );

  describe("W8 — query strict-throw in development mode", () => {
    let network: DecisionNetwork;

    function makeJinaga(developmentMode: boolean): Jinaga {
      network = new DecisionNetwork();
      const store = new MemoryStore();
      const factManager = new FactManager(new PassThroughFork(store), new ObservableSource(store), store, network, []);
      return new Jinaga(new AuthenticationNoOp(), factManager, null, developmentMode);
    }

    it("throws DistributionDeniedError for a structural denial (no-matching-rule)", async () => {
      const j = makeJinaga(true);
      network.response = {
        feeds: [],
        decisions: [{ feed: "f", decision: "denied", code: "no-matching-rule", reason: "No rules apply to this feed." }],
      };

      await expect(j.query(blogPosts, blog)).rejects.toBeInstanceOf(DistributionDeniedError);
    });

    it("carries the structural diagnostics on the thrown error", async () => {
      const j = makeJinaga(true);
      network.response = {
        feeds: [],
        decisions: [{ feed: "f", decision: "denied", code: "spec-more-restrictive-than-rule", reason: "narrower than rule" }],
      };

      const error = await j.query(blogPosts, blog).catch(e => e);
      expect(error).toBeInstanceOf(DistributionDeniedError);
      expect(error.diagnostics).toHaveLength(1);
      expect(error.diagnostics[0].code).toBe("spec-more-restrictive-than-rule");
    });

    it("does NOT throw for a reactive decision (the subscription race)", async () => {
      const j = makeJinaga(true);
      network.response = {
        feeds: ["f"],
        decisions: [{ feed: "f", decision: "reactive", reason: "pending authorization" }],
      };

      await expect(j.query(blogPosts, blog)).resolves.toEqual([]);
    });

    it("does NOT throw for a non-structural denial (principal-excluded)", async () => {
      const j = makeJinaga(true);
      network.response = {
        feeds: [],
        decisions: [{ feed: "f", decision: "denied", code: "principal-excluded", reason: "excluded" }],
      };

      await expect(j.query(blogPosts, blog)).resolves.toEqual([]);
    });

    it("stays silent-empty in production mode even for a structural denial", async () => {
      const j = makeJinaga(false);
      network.response = {
        feeds: [],
        decisions: [{ feed: "f", decision: "denied", code: "no-matching-rule", reason: "No rules apply to this feed." }],
      };

      await expect(j.query(blogPosts, blog)).resolves.toEqual([]);
    });

    it("queryWithDiagnostics never throws in development mode — it returns diagnostics", async () => {
      const j = makeJinaga(true);
      network.response = {
        feeds: [],
        decisions: [{ feed: "f", decision: "denied", code: "no-matching-rule", reason: "No rules apply to this feed." }],
      };

      const { results, diagnostics } = await j.queryWithDiagnostics(blogPosts, blog);
      expect(results).toEqual([]);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].code).toBe("no-matching-rule");
    });
  });

  describe("W7 — default development diagnostic handler", () => {
    let errorSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let infoSpy: jest.SpyInstance;

    beforeEach(() => {
      errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    });

    it("logs no-matching-rule at error level", () => {
      const handler = createDevelopmentDiagnosticHandler();
      handler(diagnostic({ code: "no-matching-rule" }));
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toContain("no distribution rule");
      expect(warnSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it("logs spec-more-restrictive-than-rule at error level", () => {
      const handler = createDevelopmentDiagnosticHandler();
      handler(diagnostic({ code: "spec-more-restrictive-than-rule" }));
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toContain("narrower than its share rule");
    });

    it("logs a non-reactive principal-excluded at warn level", () => {
      const handler = createDevelopmentDiagnosticHandler();
      handler(diagnostic({ code: "principal-excluded" }));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("not permitted");
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("logs a reactive decision at info level regardless of code", () => {
      const handler = createDevelopmentDiagnosticHandler();
      handler(diagnostic({ decision: "reactive", reactive: true, code: "not-authenticated" }));
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy.mock.calls[0][0]).toContain("pending authorization");
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("deduplicates identical diagnostics", () => {
      const handler = createDevelopmentDiagnosticHandler();
      const d = diagnostic({ code: "no-matching-rule" });
      handler(d);
      handler(d);
      handler(d);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
