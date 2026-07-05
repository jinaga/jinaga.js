import { FetchConnection, ForbiddenError } from "@src";
import { ContentTypeJson } from "../../src/http/ContentType";

// Build a minimal fetch Response stand-in with the shape FetchConnection reads.
function fakeResponse(status: number, contentType: string, body: unknown) {
  return {
    status,
    statusText: status === 403 ? "Forbidden" : "Error",
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? contentType : null) },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

describe("ForbiddenError (issue #207 W10)", () => {
  it("carries reason and raw body, and is an Error", () => {
    const body = { reason: "no dice" };
    const err = new ForbiddenError("no dice", body);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.name).toBe("ForbiddenError");
    expect(err.message).toBe("no dice");
    expect(err.reason).toBe("no dice");
    expect(err.body).toBe(body);
  });

  describe("FetchConnection surfaces the 403 body", () => {
    const realFetch = global.fetch;
    afterEach(() => { global.fetch = realFetch; });

    function connection() {
      return new FetchConnection(
        "http://localhost",
        () => Promise.resolve({}),
        () => Promise.resolve(false)
      );
    }

    it("throws ForbiddenError with the reason field from a JSON body (POST)", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(403, "application/json", { reason: "The user does not match the distribution rule." })
      ) as any;

      const conn = connection();
      await expect(conn.post("/read", ContentTypeJson, ContentTypeJson, "{}", 30))
        .rejects.toMatchObject({
          name: "ForbiddenError",
          reason: "The user does not match the distribution rule.",
          body: { reason: "The user does not match the distribution rule." },
        });
    });

    it("throws ForbiddenError with a plain-string body (GET)", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(403, "text/plain", "Forbidden: no rule applies")
      ) as any;

      const conn = connection();
      const error = await conn.get("/feeds/abc").catch(e => e);
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.reason).toBe("Forbidden: no rule applies");
      expect(error.body).toBe("Forbidden: no rule applies");
    });

    it("falls back to the status line when the body is empty (POST)", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(403, "text/plain", "")
      ) as any;

      const conn = connection();
      const error = await conn.post("/read", ContentTypeJson, ContentTypeJson, "{}", 30).catch(e => e);
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.reason).toBe("Forbidden");
    });
  });
});
