import { FetchConnection, HttpError } from "@src";
import { waitForCondition } from "../utils/async-test-utils";

// A stand-in for the streaming Response that FetchConnection.getStream reads.
// The success shape hands back a reader that immediately reports `done`, which
// is enough to exercise the connect path without a real body.
function fakeStreamResponse(ok: boolean, status: number, statusText: string, contentType = "text/plain", body: unknown = "") {
  return {
    ok,
    status,
    statusText,
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? contentType : null) },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) }
  };
}

describe("FetchConnection.getStream when the replicator has forgotten a feed (issue #243)", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  function connection() {
    return new FetchConnection(
      "http://localhost",
      () => Promise.resolve({}),
      () => Promise.resolve(false)
    );
  }

  it("reports a connect failure through onError instead of swallowing it", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      fakeStreamResponse(false, 404, "Not Found", "text/plain", "feed_not_found")
    ) as any;

    const errors: Error[] = [];
    const disconnect = connection().getStream(
      "/feeds/deadbeef?b=482.117.9",
      async () => { },
      err => { errors.push(err); },
      90);

    try {
      // The first connect attempt fails immediately; no backoff has elapsed
      // yet, so this settles as soon as the rejection propagates.
      await waitForCondition(() => errors.length > 0);
    } finally {
      disconnect();
    }

    expect(errors).toHaveLength(1);
  });

  it("preserves the status code and diagnostic body on the reported error", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      fakeStreamResponse(false, 404, "Not Found", "text/plain", "feed_not_found")
    ) as any;

    const errors: Error[] = [];
    const disconnect = connection().getStream(
      "/feeds/deadbeef?b=482.117.9",
      async () => { },
      err => { errors.push(err); },
      90);

    try {
      await waitForCondition(() => errors.length > 0);
    } finally {
      disconnect();
    }

    // The polling GET path already does this (issue #234). Without the same
    // typing here a caller cannot tell "the server forgot this feed" from
    // "the server is unreachable", and so cannot recover from the first.
    const error = errors[0] as HttpError;
    expect(error).toBeInstanceOf(HttpError);
    expect(error.statusCode).toBe(404);
    expect(error.body).toBe("feed_not_found");
  });

  it("does not report an aborted connection as an error", async () => {
    global.fetch = jest.fn().mockImplementation(async () => {
      const abort: any = new Error("The operation was aborted.");
      abort.name = "AbortError";
      throw abort;
    }) as any;

    const errors: Error[] = [];
    const disconnect = connection().getStream(
      "/feeds/deadbeef?b=482.117.9",
      async () => { },
      err => { errors.push(err); },
      90);

    // Give the connect attempt a turn of the event loop to reject and be
    // classified, then confirm nothing was reported. There is no positive
    // event to wait for here -- the assertion is that none occurs.
    await waitForCondition(() => (global.fetch as jest.Mock).mock.calls.length > 0);
    disconnect();

    expect(errors).toHaveLength(0);
  });

  it("still reports errors raised once the stream is open", async () => {
    // A body whose reader rejects: the pre-existing read-loop path to onError,
    // which must keep working alongside the new connect-failure path.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      body: { getReader: () => ({ read: async () => { throw new Error("stream broke"); } }) }
    }) as any;

    const errors: Error[] = [];
    const disconnect = connection().getStream(
      "/feeds/deadbeef?b=482.117.9",
      async () => { },
      err => { errors.push(err); },
      90);

    try {
      await waitForCondition(() => errors.length > 0);
    } finally {
      disconnect();
    }

    expect(errors[0].message).toBe("stream broke");
  });
});
