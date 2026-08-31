import { SyncStatus, SyncStatusNotifier, WebClient } from "@src";
import { ContentTypeJson, PostAccept, PostContentType } from "../../src/http/ContentType";
import { HttpConnection, HttpResponse } from "../../src/http/web-client";
import { WebClientSaver } from "../../src/fork/web-client-saver";
import { FactEnvelope, Queue } from "../../src/storage";

/**
 * A connection that enforces a request-size limit, the way a proxy in front of
 * the replicator does. nginx's default `client_max_body_size` is 1m; anything
 * over it comes back 413 before the replicator ever sees the request.
 */
class SizeLimitedConnection implements HttpConnection {
    public readonly bodySizes: number[] = [];

    constructor(private readonly maxBodyBytes: number) { }

    get(path: string): Promise<{}> {
        throw new Error("not used");
    }

    getStream(): () => void {
        throw new Error("not used");
    }

    async post(path: string, contentType: PostContentType, accept: PostAccept, body: string, timeoutSeconds: number): Promise<HttpResponse> {
        // Bytes on the wire, which is what a proxy limit counts -- not
        // `String.length`, which is UTF-16 code units.
        const bytes = Buffer.byteLength(body, "utf8");
        this.bodySizes.push(bytes);
        if (bytes > this.maxBodyBytes) {
            // 413 is not retryable, so this surfaces immediately rather than
            // spending the limited-retry budget on a request that can never fit.
            return {
                result: "failure",
                error: "Payload Too Large",
                statusCode: 413,
                body: ""
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

// A fact whose serialized size is driven by one padded field, so a test can
// say "this one is too big to send" without depending on real domain shapes.
function envelope(hash: string, payloadBytes: number): FactEnvelope {
    return {
        fact: {
            type: "Test.Fact",
            hash,
            predecessors: {},
            fields: { payload: "x".repeat(payloadBytes) }
        },
        signatures: []
    };
}

describe("Save queue flush (issue #245)", () => {
    const maxBodyBytes = 4000;
    // Well under the connection's limit, so several envelopes ride in one
    // request but the whole queue cannot.
    const maxBatchBytes = 1500;

    let connection: SizeLimitedConnection;
    let notifier: SyncStatusNotifier;
    let statuses: SyncStatus[];
    let client: WebClient;

    beforeEach(() => {
        connection = new SizeLimitedConnection(maxBodyBytes);
        notifier = new SyncStatusNotifier();
        statuses = [];
        notifier.onSyncStatus(status => statuses.push(status));
        client = new WebClient(connection, notifier, { timeoutSeconds: 30 });
    });

    function saver(queue: Queue) {
        return new WebClientSaver(client, queue, { maxBatchBytes });
    }

    it("drains a queue whose whole payload exceeds the request limit", async () => {
        // Twelve facts of ~400 bytes each: about 4.8 KB in one request, past
        // the limit, but comfortable in batches.
        const queue = new FakeQueue(
            Array.from({ length: 12 }, (_, i) => envelope(`fact${i}`, 400)));

        await saver(queue).save();

        expect(queue.envelopes).toHaveLength(0);
        expect(connection.bodySizes.length).toBeGreaterThan(1);
        expect(Math.max(...connection.bodySizes)).toBeLessThanOrEqual(maxBodyBytes);
    });

    it("does not grow monotonically once a flush has failed", async () => {
        // The failure mode from the report: the queue only ever got larger, so
        // every attempt was more certain to fail than the last.
        const queue = new FakeQueue([
            ...Array.from({ length: 6 }, (_, i) => envelope(`small${i}`, 400)),
            envelope("enormous", maxBodyBytes * 2),
            ...Array.from({ length: 6 }, (_, i) => envelope(`later${i}`, 400))
        ]);

        await saver(queue).save();
        const afterFirst = queue.envelopes.length;

        await queue.enqueue([envelope("newWrite", 400)]);
        await saver(queue).save();

        expect(afterFirst).toBeLessThan(13);
        expect(queue.envelopes.length).toBeLessThanOrEqual(afterFirst + 1);
    });

    it("stops at the first batch that fails, keeping facts that may depend on it", async () => {
        const queue = new FakeQueue([
            ...Array.from({ length: 6 }, (_, i) => envelope(`small${i}`, 400)),
            envelope("enormous", maxBodyBytes * 2),
            ...Array.from({ length: 6 }, (_, i) => envelope(`later${i}`, 400))
        ]);

        await saver(queue).save();

        const remaining = queue.envelopes.map(e => e.fact.hash);
        // Everything ahead of the blocking fact is gone.
        expect(remaining).not.toContain("small0");
        expect(remaining).not.toContain("small5");
        // The blocking fact stays, and so does everything behind it: a later
        // fact may name an earlier one as a predecessor, and sending it while
        // its predecessor is still queued would leave a dangling reference.
        expect(remaining).toContain("enormous");
        expect(remaining).toContain("later0");
        expect(remaining).toContain("later5");
    });

    it("reports a queue that is not draining through sync status", async () => {
        const queue = new FakeQueue([
            envelope("enormous", maxBodyBytes * 2),
            envelope("behind", 400)
        ]);

        await saver(queue).save();

        // Today the transport error is logged and discarded, so an application
        // has no way to learn its local store has diverged from the replicator.
        const warning = statuses.find(s => s.warning.length > 0);
        expect(warning).toBeDefined();
        expect(warning!.warning).toContain("2");
        expect(warning!.sending).toBe(false);
    });

    it("reports no warning once the queue drains", async () => {
        const queue = new FakeQueue(
            Array.from({ length: 4 }, (_, i) => envelope(`fact${i}`, 400)));

        await saver(queue).save();

        expect(queue.envelopes).toHaveLength(0);
        expect(statuses.length).toBeGreaterThan(0);
        expect(statuses[statuses.length - 1].warning).toBe("");
        expect(statuses[statuses.length - 1].sending).toBe(false);
    });

    it("gives a fact over the batch budget a request to itself, without dropping it", async () => {
        // A fact larger than the batch budget cannot be made to fit by
        // batching. It must still be attempted -- silently skipping it would
        // lose a write -- and it must not drag its neighbours into a request
        // that is oversized because of it.
        const queue = new FakeQueue([
            envelope("small", 200),
            envelope("oversized", maxBatchBytes * 2),
            envelope("alsoSmall", 200)
        ]);

        await saver(queue).save();

        // Three requests: the small one, the oversized one alone, the last one.
        expect(connection.bodySizes).toHaveLength(3);
        expect(queue.envelopes).toHaveLength(0);
    });

    it("keeps a fact that no request can carry, and everything behind it", async () => {
        // Over the connection's limit too, so it can never be sent. It stays
        // queued rather than being discarded, and it blocks what follows.
        const queue = new FakeQueue([
            envelope("sendable", 200),
            envelope("unsendable", maxBodyBytes * 2),
            envelope("behind", 200)
        ]);

        await saver(queue).save();

        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["unsendable", "behind"]);
    });

    it("measures the budget in UTF-8 bytes, not UTF-16 code units", async () => {
        // A limit set just above the batch budget, the way an operator would
        // set the budget under a known proxy limit.
        const tightLimit = maxBatchBytes + 500;
        const tightConnection = new SizeLimitedConnection(tightLimit);
        const tightClient = new WebClient(tightConnection, notifier, { timeoutSeconds: 30 });

        // Each of these characters is one UTF-16 code unit but three UTF-8
        // bytes. Counting `String.length` under-reports the payload threefold
        // and packs batches well past the limit -- and non-ASCII text is
        // exactly the data most likely to push a payload over a limit.
        const queue = new FakeQueue(
            Array.from({ length: 6 }, (_, i) => ({
                fact: {
                    type: "Test.Fact",
                    hash: `wide${i}`,
                    predecessors: {},
                    fields: { payload: "漢".repeat(400) }
                },
                signatures: []
            })));

        await new WebClientSaver(tightClient, queue, { maxBatchBytes }).save();

        expect(queue.envelopes).toHaveLength(0);
        expect(Math.max(...tightConnection.bodySizes)).toBeLessThanOrEqual(tightLimit);
    });

    it("falls back to the defaults for a non-positive bound", async () => {
        // Zero would put one fact in every request, and a negative value none
        // at all. Neither is what the option name promises, so neither is
        // honoured.
        const queue = new FakeQueue(
            Array.from({ length: 4 }, (_, i) => envelope(`fact${i}`, 100)));

        await new WebClientSaver(client, queue, { maxBatchBytes: 0, maxBatchCount: -1 }).save();

        expect(queue.envelopes).toHaveLength(0);
        expect(connection.bodySizes).toHaveLength(1);
    });

    it("makes no request for an empty queue", async () => {
        const queue = new FakeQueue([]);

        await saver(queue).save();

        expect(connection.bodySizes).toHaveLength(0);
        expect(statuses).toHaveLength(0);
    });
});
