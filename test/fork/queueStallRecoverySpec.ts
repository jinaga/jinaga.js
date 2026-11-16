import {
    DEFAULT_FEED_REFRESH_INTERVAL_SECONDS,
    DEFAULT_RETRY_BACKOFF_MULTIPLIER,
    DEFAULT_RETRY_INITIAL_DELAY_MS,
    ForbiddenError,
    HttpError,
    MemoryStore,
    PersistentFork,
    PersistentForkOptions,
    SyncStatusNotifier,
    WebClient
} from "@src";
import { ContentTypeJson, PostAccept, PostContentType } from "../../src/http/ContentType";
import { HttpConnection, HttpResponse } from "../../src/http/web-client";
import { FactEnvelope, Queue } from "../../src/storage";
import { useFakeTimers } from "../utils/fake-timers";

/**
 * What the replicator does with a request.
 *
 * `connectionFailure` is the case the fork used to get stuck on: the request
 * never reached a replicator that could judge the facts, so nothing about them
 * is wrong and nothing about them has been decided.
 */
type Answer = "success" | "refusal" | "connectionFailure";

/**
 * A connection whose answers a test scripts per path, so the triggering
 * response goes through `WebClient`'s own classification rather than a test
 * restating which statuses count.
 */
class ScriptedConnection implements HttpConnection {
    /** Every request made, in order, as `"<METHOD> <path>"`. */
    public readonly requests: string[] = [];
    /** What a `POST /save` gets. */
    public save: Answer = "success";
    /** What a `POST /feeds` gets. */
    public feeds: Answer = "success";
    /** What a `GET` gets. */
    public read: Answer = "success";

    private saveGate: Promise<void> | null = null;

    /** How many `POST /save` requests have been made so far. */
    get saveCount(): number {
        return this.requests.filter(request => request === "POST /save").length;
    }

    /**
     * Hold every later `POST /save` open until the returned function is called,
     * so a test can have responses arrive while a flush is still running.
     */
    gateSave(): () => void {
        let release = () => { };
        this.saveGate = new Promise<void>(resolve => {
            release = () => {
                this.saveGate = null;
                resolve();
            };
        });
        return () => release();
    }

    async get(path: string): Promise<{}> {
        this.requests.push(`GET ${path}`);
        return this.answerGet(this.read);
    }

    getStream(): () => void {
        throw new Error("not used");
    }

    async post(path: string, contentType: PostContentType, accept: PostAccept, body: string, timeoutSeconds: number): Promise<HttpResponse> {
        this.requests.push(`POST ${path}`);
        if (path === "/save" && this.saveGate) {
            await this.saveGate;
        }
        const answer = path === "/save" ? this.save : this.feeds;
        switch (answer) {
            case "success":
                // A `/feeds` response is parsed, so a success there has to be a
                // feeds response.
                return {
                    result: "success",
                    response: path === "/feeds" ? { feeds: [] } : {}
                };
            case "refusal":
                // The replicator judged these facts and said no. It will say
                // the same thing next time.
                return { result: "failure", error: "Forbidden", statusCode: 403, body: "" };
            case "connectionFailure":
                // What `FetchConnection` synthesizes for a network error. Typed
                // as a failure rather than a retry, which is what a connection
                // says when it has already given up on the request.
                return { result: "failure", error: "Network request failed", statusCode: 500, body: "" };
        }
    }

    async getAcceptedContentTypes(path: string): Promise<string[]> {
        return [ContentTypeJson];
    }

    private async answerGet(answer: Answer): Promise<{}> {
        switch (answer) {
            case "success":
                return {};
            case "refusal":
                throw new ForbiddenError("Forbidden", null);
            case "connectionFailure":
                throw new HttpError("Network request failed", 500, null);
        }
    }
}

class FakeQueue implements Queue {
    constructor(public envelopes: FactEnvelope[] = []) { }

    async peek(): Promise<FactEnvelope[]> {
        return this.envelopes;
    }

    async enqueue(envelopes: FactEnvelope[]): Promise<void> {
        this.envelopes = [...this.envelopes, ...envelopes];
    }

    async dequeue(envelopes: FactEnvelope[]): Promise<void> {
        const removed = new Set(envelopes.map(e => e.fact.hash));
        this.envelopes = this.envelopes.filter(e => !removed.has(e.fact.hash));
    }
}

function plain(hash: string): FactEnvelope {
    return {
        fact: { type: "Test.Fact", hash, predecessors: {}, fields: {} },
        signatures: []
    };
}

/**
 * Let the promise continuations that are already queued run.
 *
 * The fake clock decides when a backoff timer fires. What the flush that timer
 * starts then does is a chain of promises the clock knows nothing about, so a
 * test advances the clock and then lets that chain run. Each turn runs only
 * work that was already queued, so this never waits on the wall clock and the
 * turn count is a bound rather than a delay.
 */
async function drain(turns = 200): Promise<void> {
    for (let turn = 0; turn < turns; turn++) {
        await Promise.resolve();
    }
}

describe("Flushing a queue that stalled on the connection (issue #400)", () => {
    /** The ceiling the backoff climbs to when nothing configures one. */
    const defaultCeilingMs = DEFAULT_FEED_REFRESH_INTERVAL_SECONDS * 1000;

    let connection: ScriptedConnection;
    let client: WebClient;
    let queue: FakeQueue;
    let fork: PersistentFork;

    function createFork(options: PersistentForkOptions = {}) {
        connection = new ScriptedConnection();
        client = new WebClient(connection, new SyncStatusNotifier(), {
            timeoutSeconds: 30,
            retry: options.retry
        });
        queue = new FakeQueue();
        // No debounce, so the only thing that holds facts in the queue is a
        // request the replicator did not answer.
        fork = new PersistentFork(new MemoryStore(), queue, client, 0, options);
    }

    /** Queue a fact and let the flush that the save schedules run. */
    async function saveAndFlush(hash: string): Promise<void> {
        await fork.save([plain(hash)]);
        await drain();
    }

    beforeEach(() => {
        useFakeTimers();
        // The schedule adds jitter so that clients which have all reached the
        // ceiling still spread their attempts. A test asserting on the delays
        // the schedule produced takes it out, rather than asserting on a range
        // that would also admit the wrong delay.
        jest.spyOn(Math, "random").mockReturnValue(0);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it("sends the queued facts when the replicator answers another request", async () => {
        // Criterion 1. The queue is what a client holds after writing offline,
        // and reading is all it does after reconnecting.
        createFork();
        connection.save = "connectionFailure";

        await saveAndFlush("A");

        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["A"]);
        const stalledAfter = connection.saveCount;
        expect(stalledAfter).toBeGreaterThan(0);

        connection.save = "success";
        await client.feeds("a feed request");
        await drain();

        // No fact() call, no push(), no restart -- and the clock has not
        // advanced at all, so the backoff cannot account for this either.
        expect(queue.envelopes).toHaveLength(0);
        expect(connection.saveCount).toBeGreaterThan(stalledAfter);
    });

    it("sends the queued facts when the replicator refuses another request", async () => {
        // Criterion 2. A refusal is the replicator answering. It says the
        // request arrived, which is the whole of what the flush needs to know.
        createFork();
        connection.save = "connectionFailure";

        await saveAndFlush("A");

        const stalledAfter = connection.saveCount;
        connection.save = "success";
        connection.feeds = "refusal";

        await expect(client.feeds("a feed request")).rejects.toThrow();
        await drain();

        expect(queue.envelopes).toHaveLength(0);
        expect(connection.saveCount).toBeGreaterThan(stalledAfter);
    });

    it("stays stalled when another request fails on the connection", async () => {
        // Criterion 3. A request that never reached the replicator shows
        // nothing, so it is not evidence to act on.
        createFork();
        connection.save = "connectionFailure";

        await saveAndFlush("A");

        const stalledAfter = connection.saveCount;
        connection.save = "success";
        connection.feeds = "connectionFailure";

        await expect(client.feeds("a feed request")).rejects.toThrow();
        await drain();

        expect(connection.saveCount).toBe(stalledAfter);
        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["A"]);
    });

    it("sends the queued facts on the backoff with no other request made", async () => {
        // Criterion 4. A client that reconnects and then does nothing at all
        // still drains its queue.
        createFork();
        connection.save = "connectionFailure";

        await saveAndFlush("A");

        const stalledAfter = connection.saveCount;
        connection.save = "success";

        jest.advanceTimersByTime(DEFAULT_RETRY_INITIAL_DELAY_MS - 1);
        await drain();
        expect(connection.saveCount).toBe(stalledAfter);

        jest.advanceTimersByTime(1);
        await drain();

        expect(connection.saveCount).toBe(stalledAfter + 1);
        expect(queue.envelopes).toHaveLength(0);
    });

    it("spaces successive backoff flushes by the schedule's growing delays", async () => {
        // Criterion 5. Each flush that stalls again waits the next, longer
        // delay, and the ceiling is the feed refresh interval.
        const ceilingSeconds = 4;
        createFork({ feedRefreshIntervalSeconds: ceilingSeconds });
        connection.save = "connectionFailure";

        await saveAndFlush("A");

        const ceilingMs = ceilingSeconds * 1000;
        const observed: number[] = [];
        let plannedMs = DEFAULT_RETRY_INITIAL_DELAY_MS;
        for (let attempt = 0; attempt < 4; attempt++) {
            const expectedMs = Math.min(plannedMs, ceilingMs);
            const before = connection.saveCount;

            jest.advanceTimersByTime(expectedMs - 1);
            await drain();
            expect(connection.saveCount).toBe(before);

            jest.advanceTimersByTime(1);
            await drain();
            expect(connection.saveCount).toBe(before + 1);

            observed.push(expectedMs);
            plannedMs = plannedMs * DEFAULT_RETRY_BACKOFF_MULTIPLIER;
        }

        // Growing, and capped: the last two waits are both the ceiling.
        expect(observed[1]).toBeGreaterThan(observed[0]);
        expect(Math.max(...observed)).toBe(ceilingMs);
        expect(observed[observed.length - 1]).toBe(ceilingMs);
    });

    it("caps the backoff at a configured maximum delay instead of the refresh interval", async () => {
        // Criterion 5, the other half: a configured ceiling wins, and the
        // delays come from the one schedule rather than from a second one here.
        const maxDelayMs = DEFAULT_RETRY_INITIAL_DELAY_MS + 500;
        createFork({ retry: { maxDelayMs } });
        connection.save = "connectionFailure";

        await saveAndFlush("A");

        // The first delay is the schedule's initial one, under the ceiling.
        jest.advanceTimersByTime(DEFAULT_RETRY_INITIAL_DELAY_MS);
        await drain();

        // The second would be the initial delay multiplied, which is past the
        // configured ceiling, so it is the ceiling.
        const before = connection.saveCount;
        jest.advanceTimersByTime(maxDelayMs - 1);
        await drain();
        expect(connection.saveCount).toBe(before);

        jest.advanceTimersByTime(1);
        await drain();
        expect(connection.saveCount).toBe(before + 1);
    });

    it("schedules no backoff flush when the replicator refused what is left", async () => {
        // Criterion 6. Sending a refused fact again changes nothing until
        // something grows the replicator's graph, and the next save already
        // does that. A schedule here would only be a loop.
        createFork();
        connection.save = "refusal";

        await saveAndFlush("A");

        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["A"]);
        const refusedAfter = connection.saveCount;

        jest.advanceTimersByTime(defaultCeilingMs * 10);
        await drain();
        expect(connection.saveCount).toBe(refusedAfter);

        connection.save = "success";
        await client.feeds("a feed request");
        await drain();

        expect(connection.saveCount).toBe(refusedAfter);
        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["A"]);
    });

    it("makes no save request on a response when nothing has stalled", async () => {
        // Criterion 7. The trigger is a stalled queue, not a response, so a
        // client that is working normally sends no extra traffic.
        createFork();

        await client.feeds("a feed request");
        await drain();
        expect(connection.saveCount).toBe(0);

        await saveAndFlush("A");
        expect(queue.envelopes).toHaveLength(0);
        const drainedAfter = connection.saveCount;

        await client.feeds("a feed request");
        await drain();

        expect(connection.saveCount).toBe(drainedAfter);
    });

    it("starts no second flush for responses that arrive while one is running", async () => {
        // Criterion 8. A feed stream delivering response after response costs
        // at most one flush.
        createFork();
        connection.save = "connectionFailure";

        await saveAndFlush("A");

        const stalledAfter = connection.saveCount;
        connection.save = "success";
        const releaseSave = connection.gateSave();

        await client.feeds("a feed request");
        await drain();
        expect(connection.saveCount).toBe(stalledAfter + 1);

        await client.feeds("a feed request");
        await client.feeds("a feed request");
        await drain();
        expect(connection.saveCount).toBe(stalledAfter + 1);

        releaseSave();
        await drain();

        expect(queue.envelopes).toHaveLength(0);
        expect(connection.saveCount).toBe(stalledAfter + 1);
    });

    it("flushes a save made during the backoff, and starts the cycle over", async () => {
        // Criterion 9. A write behaves exactly as it does today, and the
        // backoff that follows it begins again at the schedule's first delay
        // rather than carrying on from where the previous cycle had climbed to.
        createFork();
        connection.save = "connectionFailure";

        await saveAndFlush("A");

        // One backoff flush, which stalls again, so the cycle has advanced to
        // its second delay.
        jest.advanceTimersByTime(DEFAULT_RETRY_INITIAL_DELAY_MS);
        await drain();
        const backedOffAfter = connection.saveCount;

        await saveAndFlush("B");
        expect(connection.saveCount).toBe(backedOffAfter + 1);

        const writtenAfter = connection.saveCount;
        jest.advanceTimersByTime(DEFAULT_RETRY_INITIAL_DELAY_MS - 1);
        await drain();
        expect(connection.saveCount).toBe(writtenAfter);

        jest.advanceTimersByTime(1);
        await drain();
        expect(connection.saveCount).toBe(writtenAfter + 1);
    });

    it("runs no backoff flush and ignores responses once the fork is closed", async () => {
        // Criterion 10.
        createFork();
        connection.save = "connectionFailure";

        await saveAndFlush("A");

        await fork.close();
        await drain();
        const closedAfter = connection.saveCount;

        connection.save = "success";
        jest.advanceTimersByTime(defaultCeilingMs * 10);
        await drain();
        expect(connection.saveCount).toBe(closedAfter);

        await client.feeds("a feed request");
        await drain();

        expect(connection.saveCount).toBe(closedAfter);
        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["A"]);
    });
});
