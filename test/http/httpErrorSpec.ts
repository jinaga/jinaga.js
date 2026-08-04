import { FetchConnection, HttpError, SyncStatusNotifier, WebClient } from "@src";
import { ContentTypeJson, PostAccept, PostContentType } from "../../src/http/ContentType";
import { HttpConnection, HttpResponse } from "../../src/http/web-client";

// Build a minimal fetch Response stand-in with the shape FetchConnection reads.
function fakeResponse(status: number, statusText: string, contentType: string, body: unknown) {
  return {
    status,
    statusText,
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? contentType : null) },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

// A stub HttpConnection that hands back canned responses and counts attempts,
// so the retry policy can be observed without waiting on real backoff.
class StubConnection implements HttpConnection {
  public postCount = 0;

  constructor(private responses: HttpResponse[]) {}

  get(path: string): Promise<{}> {
    throw new Error("not used");
  }

  getStream(): () => void {
    throw new Error("not used");
  }

  async post(path: string, contentType: PostContentType, accept: PostAccept, body: string, timeoutSeconds: number): Promise<HttpResponse> {
    const response = this.responses[Math.min(this.postCount, this.responses.length - 1)];
    this.postCount++;
    return response;
  }

  async getAcceptedContentTypes(path: string): Promise<string[]> {
    return [ContentTypeJson];
  }
}

describe("HTTP error diagnostics (issue #234)", () => {
  describe("FetchConnection surfaces the response body", () => {
    const realFetch = global.fetch;
    afterEach(() => { global.fetch = realFetch; });

    function connection() {
      return new FetchConnection(
        "http://localhost",
        () => Promise.resolve({}),
        () => Promise.resolve(false)
      );
    }

    it("throws HttpError carrying the plain-text body, status, and raw body (GET)", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(500, "Internal Server Error", "text/plain", "Fact Test.Order:AXn3 has no signature.")
      ) as any;

      const error = await connection().get("/feeds/abc").catch(e => e);
      expect(error).toBeInstanceOf(HttpError);
      expect(error.message).toBe("Fact Test.Order:AXn3 has no signature.");
      expect(error.statusCode).toBe(500);
      expect(error.body).toBe("Fact Test.Order:AXn3 has no signature.");
    });

    it("prefers the 'message' field of a JSON body over the status line (GET)", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(400, "Bad Request", "application/json", { message: "Expected an array 'facts' property." })
      ) as any;

      const error = await connection().get("/load").catch(e => e);
      expect(error.message).toBe("Expected an array 'facts' property.");
      expect(error.statusCode).toBe(400);
    });

    it("falls back to the status line when the body is empty (GET)", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(500, "Internal Server Error", "text/plain", "")
      ) as any;

      const error = await connection().get("/feeds/abc").catch(e => e);
      expect(error.message).toBe("Internal Server Error");
    });

    it("returns the body as the error text (POST)", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(400, "Bad Request", "text/plain", "Cannot authorize 1 fact of type Test.Order.")
      ) as any;

      const response = await connection().post("/save", ContentTypeJson, ContentTypeJson, "{}", 30);
      expect(response).toMatchObject({
        error: "Cannot authorize 1 fact of type Test.Order.",
        statusCode: 400,
        body: "Cannot authorize 1 fact of type Test.Order."
      });
    });

    it("falls back to the status line when the body is empty (POST)", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(503, "Service Unavailable", "text/plain", "")
      ) as any;

      const response = await connection().post("/save", ContentTypeJson, ContentTypeJson, "{}", 30);
      expect(response).toMatchObject({ error: "Service Unavailable" });
    });
  });

  describe("FetchConnection classifies retryable statuses", () => {
    const realFetch = global.fetch;
    afterEach(() => { global.fetch = realFetch; });

    function connection() {
      return new FetchConnection(
        "http://localhost",
        () => Promise.resolve({}),
        () => Promise.resolve(false)
      );
    }

    async function resultFor(status: number) {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(status, "Error", "text/plain", "")
      ) as any;
      const response = await connection().post("/save", ContentTypeJson, ContentTypeJson, "{}", 30);
      return response.result;
    }

    it.each([500, 502, 503, 408, 429])("retries a transient %i", async (status) => {
      expect(await resultFor(status)).toBe("retry");
    });

    it.each([400, 401, 404, 409, 422])("fails immediately on a deterministic %i", async (status) => {
      expect(await resultFor(status)).toBe("failure");
    });
  });

  describe("WebClient propagates the diagnostics", () => {
    function webClient(connection: HttpConnection) {
      return new WebClient(connection, new SyncStatusNotifier(), { timeoutSeconds: 30 });
    }

    it("throws HttpError carrying the status and body", async () => {
      const connection = new StubConnection([{
        result: "failure",
        error: "Cannot authorize 1 fact of type Test.Order.",
        statusCode: 400,
        body: "Cannot authorize 1 fact of type Test.Order."
      }]);

      const error = await webClient(connection).load({ references: [] }).catch(e => e);
      expect(error).toBeInstanceOf(HttpError);
      expect(error.message).toBe("Cannot authorize 1 fact of type Test.Order.");
      expect(error.statusCode).toBe(400);
    });

    it("throws a plain Error when the connection reports no status", async () => {
      const connection = new StubConnection([{ result: "failure", error: "network down" }]);

      const error = await webClient(connection).load({ references: [] }).catch(e => e);
      expect(error).not.toBeInstanceOf(HttpError);
      expect(error.message).toBe("network down");
    });

    it("does not retry a deterministic failure", async () => {
      const connection = new StubConnection([{
        result: "failure",
        error: "Expected an array 'facts' property.",
        statusCode: 400,
        body: "Expected an array 'facts' property."
      }]);

      const error = await webClient(connection).loadWithRetry({ references: [] }).catch(e => e);
      expect(error.message).toBe("Expected an array 'facts' property.");
      // One attempt, no backoff: the request cannot succeed on a second try.
      expect(connection.postCount).toBe(1);
    });

    it("still retries a transient failure and reports the last body on give-up", async () => {
      const connection = new StubConnection([{
        result: "retry",
        error: "The replicator is restarting.",
        statusCode: 503,
        body: "The replicator is restarting."
      }]);

      const error = await webClient(connection).loadWithRetry({ references: [] }).catch(e => e);
      expect(error).toBeInstanceOf(HttpError);
      expect(error.statusCode).toBe(503);
      expect(connection.postCount).toBeGreaterThan(1);
      // 1s + 2s + 4s of backoff, plus up to a second of jitter each.
    }, 30000);
  });
});
