import { DEFAULT_RETRY_TIMEOUT_MS, FetchConnection, HttpError, RetryOptions, SyncStatus, SyncStatusNotifier, WebClient, resolveRetrySchedule } from "@src";
import { WebClientSaver } from "../../src/fork/web-client-saver";
import { ContentTypeJson, PostAccept, PostContentType } from "../../src/http/ContentType";
import { RetryWaits } from "../../src/http/retry";
import { HttpConnection, HttpResponse } from "../../src/http/web-client";
import { FactEnvelope, Queue } from "../../src/storage";
import { waitForCondition } from "../utils/async-test-utils";

/**
 * A connection that fails a scripted number of times with a retryable status
 * before it succeeds, counting attempts. A count of `Infinity` never succeeds.
 */
class ScriptedConnection implements HttpConnection {
    public postCount = 0;

    constructor(private readonly failures: number) { }

    get(path: string): Promise<{}> {
        throw new Error("not used");
    }

    getStream(): () => void {
        throw new Error("not used");
    }

    async post(path: string, contentType: PostContentType, accept: PostAccept, body: string, timeoutSeconds: number): Promise<HttpResponse> {
        this.postCount++;
        if (this.postCount <= this.failures) {
            return {
                result: "retry",
                error: "The replicator is restarting.",
                statusCode: 503,
                body: "The replicator is restarting."
            };
        }
        return { result: "success", response: {} };
    }

    async getAcceptedContentTypes(path: string): Promise<string[]> {
        return [ContentTypeJson];
    }
}

class FakeQueue implements Queue {
    constructor(public envelopes: FactEnvelope[]) { }

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

function envelope(hash: string): FactEnvelope {
    return {
        fact: { type: "Test.Fact", hash, predecessors: {}, fields: {} },
        signatures: []
    };
}

describe("Configurable HTTP retry schedule (issue #305)", () => {
    function client(connection: HttpConnection, retry?: RetryOptions, notifier = new SyncStatusNotifier()) {
        return new WebClient(connection, notifier, { timeoutSeconds: 30, retry });
    }

    describe("the default schedule", () => {
        // Derived from the resolved defaults rather than from wall time, so the
        // four attempts the client has always made can be asserted without
        // spending the seven seconds they take. The waits themselves are what
        // the retry loop reads, so this fails if a default moves.
        it("plans the waits of 1s, 2s and 4s that admit four attempts", () => {
            const waits = new RetryWaits(resolveRetrySchedule(undefined));
            const planned: (number | null)[] = [];
            for (let i = 0; i < 4; i++) {
                planned.push(waits.next());
            }

            // Each wait carries up to a second of jitter on top of the nominal
            // delay, which is why these are ranges.
            expect(planned[0]).toBeGreaterThanOrEqual(1000);
            expect(planned[0]).toBeLessThan(2000);
            expect(planned[1]).toBeGreaterThanOrEqual(2000);
            expect(planned[1]).toBeLessThan(3000);
            expect(planned[2]).toBeGreaterThanOrEqual(4000);
            expect(planned[2]).toBeLessThan(5000);
            // Three waits, so four attempts, and then the budget is spent.
            expect(planned[3]).toBeNull();
        });

        it("spends its whole budget on those waits", () => {
            const schedule = resolveRetrySchedule(undefined);
            expect(schedule.initialDelayMs + schedule.initialDelayMs * schedule.backoffMultiplier +
                Math.min(schedule.initialDelayMs * Math.pow(schedule.backoffMultiplier, 2), schedule.maxDelayMs))
                .toBe(DEFAULT_RETRY_TIMEOUT_MS);
        });
    });

    describe("a POST that keeps failing", () => {
        it("retries without bound when the window is zero", async () => {
            // Nine failures is more than the default budget allows, so a save
            // that must eventually land only completes because the window is
            // unbounded. The delays are zero so the test does not wait on them.
            const connection = new ScriptedConnection(9);

            await client(connection, { initialDelayMs: 0, maxDelayMs: 0, timeoutMs: 0 })
                .loadWithRetry({ references: [] });

            expect(connection.postCount).toBe(10);
        });

        it("throws once a finite window has elapsed", async () => {
            // Waits of 10ms: two fit in a 25ms budget, a third would not, so
            // three attempts are made.
            const connection = new ScriptedConnection(Infinity);

            const error = await client(connection, { initialDelayMs: 10, maxDelayMs: 10, timeoutMs: 25 })
                .loadWithRetry({ references: [] }).catch(e => e);

            expect(error).toBeInstanceOf(HttpError);
            expect(error.statusCode).toBe(503);
            expect(connection.postCount).toBe(3);
        });

        it("reports the failure through onSyncStatus once the window elapses", async () => {
            const connection = new ScriptedConnection(Infinity);
            const notifier = new SyncStatusNotifier();
            const statuses: SyncStatus[] = [];
            notifier.onSyncStatus(status => statuses.push(status));
            const queue = new FakeQueue([envelope("fact1")]);
            const saver = new WebClientSaver(
                client(connection, { initialDelayMs: 5, maxDelayMs: 5, timeoutMs: 10 }, notifier),
                queue);

            await saver.save();

            const warning = statuses.map(s => s.warning).filter(w => w.length > 0);
            expect(warning).toHaveLength(1);
            expect(warning[0]).toContain("1 fact(s) could not be sent to the replicator");
            // The fact is still queued, so the next flush will try again.
            expect(queue.envelopes).toHaveLength(1);
        });
    });

    describe("a POST that recovers", () => {
        it("completes with no delay when the schedule asks for none", async () => {
            const connection = new ScriptedConnection(2);

            await client(connection, { initialDelayMs: 0, maxDelayMs: 0 })
                .loadWithRetry({ references: [] });

            // Attempts, not wall time: two failures and the success.
            expect(connection.postCount).toBe(3);
        });
    });

    describe("the feed stream", () => {
        const realFetch = global.fetch;
        afterEach(() => { global.fetch = realFetch; });

        function unreachable() {
            return jest.fn().mockImplementation(async () => {
                throw new Error("Network request failed");
            });
        }

        function connection(retry?: RetryOptions) {
            return new FetchConnection(
                "http://localhost",
                () => Promise.resolve({}),
                () => Promise.resolve(false),
                retry);
        }

        it("backs off on the configured schedule rather than on its own constants", async () => {
            const fetchMock = unreachable();
            global.fetch = fetchMock as any;

            // With the schedule the stream used to carry, a fifth connect
            // attempt arrives 15 seconds in: 1s + 2s + 4s + 8s of backoff.
            const disconnect = connection({ initialDelayMs: 0, maxDelayMs: 0 }).getStream(
                "/feeds/deadbeef?b=482.117.9",
                async () => { },
                () => { },
                90);

            try {
                await waitForCondition(() => fetchMock.mock.calls.length >= 5, 1000);
            } finally {
                disconnect();
            }

            expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(5);
        });

        it("stops reconnecting once a finite window has elapsed", async () => {
            const fetchMock = unreachable();
            global.fetch = fetchMock as any;
            const errors: Error[] = [];

            // Waits of 5ms: two fit in a 10ms budget, so three connect attempts
            // are made and then the stream gives up.
            const disconnect = connection({ initialDelayMs: 5, maxDelayMs: 5, timeoutMs: 10 }).getStream(
                "/feeds/deadbeef?b=482.117.9",
                async () => { },
                err => { errors.push(err); },
                90);

            try {
                await waitForCondition(() => errors.length >= 3, 1000);
                // Nothing further can arrive: the loop returned rather than
                // waiting, so this settles as soon as the condition holds.
                await waitForCondition(() => fetchMock.mock.calls.length >= 3, 1000);
            } finally {
                disconnect();
            }

            expect(fetchMock.mock.calls.length).toBe(3);
        });

        it("keeps the feed refresh interval as its ceiling when no schedule is configured", () => {
            // The stream reconnects for as long as the caller holds it, so its
            // default window is unbounded and its default ceiling is the refresh
            // interval, not the four-second ceiling the POST path defaults to.
            const schedule = resolveRetrySchedule(undefined, { maxDelayMs: 90 * 1000, timeoutMs: 0 });

            expect(schedule.maxDelayMs).toBe(90 * 1000);
            expect(schedule.timeoutMs).toBe(0);
            // A configured schedule wins over the path's default.
            expect(resolveRetrySchedule({ maxDelayMs: 2000 }, { maxDelayMs: 90 * 1000, timeoutMs: 0 }).maxDelayMs)
                .toBe(2000);
        });
    });

    describe("a schedule that cannot mean what it says", () => {
        it("falls back to the default rather than admitting the value", () => {
            const schedule = resolveRetrySchedule({
                initialDelayMs: -1,
                backoffMultiplier: 0.5,
                timeoutMs: Number.NaN
            });

            expect(schedule).toEqual(resolveRetrySchedule(undefined));
        });
    });
});
