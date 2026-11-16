import { AuthorizationEngine, AuthorizationRules, FactRecord, FetchConnection, Forbidden, ForbiddenError, HttpError, MemoryStore, SyncStatus, SyncStatusNotifier, User, WebClient, buildModel, dehydrateFact } from "@src";
import { ContentTypeJson, PostAccept, PostContentType } from "../../src/http/ContentType";
import { HttpConnection, HttpResponse } from "../../src/http/web-client";
import { WebClientSaver } from "../../src/fork/web-client-saver";
import { RetryOptions } from "../../src/http/retry";
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

    it("keeps a refused fact but drains the facts that do not descend from it", async () => {
        const queue = new FakeQueue([
            ...Array.from({ length: 6 }, (_, i) => envelope(`small${i}`, 400)),
            envelope("enormous", maxBodyBytes * 2),
            ...Array.from({ length: 6 }, (_, i) => envelope(`later${i}`, 400))
        ]);

        await saver(queue).save();

        // Only the fact no request can carry stays. Everything ahead of it had
        // already drained; everything behind it names no queued predecessor, so
        // holding it back would strand it behind a fact it does not depend on
        // (issue #395).
        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["enormous"]);
    });

    it("reports a queue that is not draining through sync status", async () => {
        const queue = new FakeQueue([
            envelope("enormous", maxBodyBytes * 2),
            envelope("behind", 400)
        ]);

        await saver(queue).save();

        // Today the transport error is logged and discarded, so an application
        // has no way to learn its local store has diverged from the replicator.
        // "behind" names no queued predecessor, so it is sent and only the
        // oversized fact remains to be reported (issue #395).
        const warning = statuses[statuses.length - 1];
        expect(warning.warning).toContain("1 fact(s)");
        expect(warning.sending).toBe(false);
        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["enormous"]);
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

    it("keeps a fact that no request can carry, without dropping or blocking it", async () => {
        // Over the connection's limit too, so it can never be sent. It stays
        // queued rather than being discarded, and the fact behind it, which
        // names no queued predecessor, still goes.
        const queue = new FakeQueue([
            envelope("sendable", 200),
            envelope("unsendable", maxBodyBytes * 2),
            envelope("behind", 200)
        ]);

        await saver(queue).save();

        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["unsendable"]);
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

/**
 * A stand-in for `WebClient` that records every request and refuses the ones a
 * test tells it to. Only the two methods the saver calls are implemented, so it
 * is handed over as a `WebClient` rather than deriving from one.
 */
class RecordingClient {
    public readonly requests: string[][] = [];

    constructor(
        private readonly notifier: SyncStatusNotifier,
        private readonly refuse: (hashes: string[]) => Error | undefined
    ) { }

    notifySyncStatus(status: SyncStatus) {
        this.notifier.notify(status);
    }

    async saveWithRetry(envelopes: FactEnvelope[]): Promise<void> {
        const hashes = envelopes.map(e => e.fact.hash);
        this.requests.push(hashes);
        const error = this.refuse(hashes);
        if (error) {
            throw error;
        }
    }

    asWebClient(): WebClient {
        return this as unknown as WebClient;
    }
}

// A fact with no predecessors, identified by hash alone.
function plain(hash: string): FactEnvelope {
    return {
        fact: { type: "Test.Fact", hash, predecessors: {}, fields: {} },
        signatures: []
    };
}

// A fact that names other queued facts as predecessors, so the saver can see
// which facts a refused one holds back.
function descendant(hash: string, predecessorHashes: string[]): FactEnvelope {
    return {
        fact: {
            type: "Test.Fact",
            hash,
            predecessors: {
                prior: predecessorHashes.map(h => ({ type: "Test.Fact", hash: h }))
            },
            fields: {}
        },
        signatures: []
    };
}

function refusing(hash: string, error: () => Error) {
    return (hashes: string[]) => hashes.includes(hash) ? error() : undefined;
}

const forbidden = () => new ForbiddenError("Rejected 1 fact of type Test.Fact.", null);

describe("Save queue flush past a refused batch (issue #395)", () => {
    let notifier: SyncStatusNotifier;
    let statuses: SyncStatus[];

    beforeEach(() => {
        notifier = new SyncStatusNotifier();
        statuses = [];
        notifier.onSyncStatus(status => statuses.push(status));
    });

    it("sends the facts a refused fact does not hold back, and keeps the refused one", async () => {
        // Criterion 2. The replicator refuses A whatever else the request
        // holds, and B does not descend from A.
        const queue = new FakeQueue([plain("A"), plain("B")]);
        const client = new RecordingClient(notifier, refusing("A", forbidden));

        await new WebClientSaver(client.asWebClient(), queue).save();

        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["A"]);
        expect(client.requests).toContainEqual(["B"]);
    });

    it("never sends a fact whose queued predecessor is still refused", async () => {
        // Criterion 3. C names the refused A directly; D reaches it through C.
        const queue = new FakeQueue([
            plain("A"),
            plain("B"),
            descendant("C", ["A"]),
            descendant("D", ["C"])
        ]);
        const client = new RecordingClient(notifier, refusing("A", forbidden));

        await new WebClientSaver(client.asWebClient(), queue).save();

        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["A", "C", "D"]);
        // Held back rather than merely rejected. The ordinary first batch is
        // built before any refusal is known, so C and D ride in it; what the
        // saver must never do is offer either one in a request that could
        // commit it while A is refused. So every request that carries them
        // carries A as well, and the narrowing that follows -- which is where
        // a fact is sent on its own -- skips both.
        for (const request of client.requests) {
            if (request.includes("C") || request.includes("D")) {
                expect(request).toContain("A");
            }
        }
        const alone = client.requests.filter(request => request.length === 1).flat();
        expect(alone).not.toContain("C");
        expect(alone).not.toContain("D");
    });

    it.each([
        ["400", () => new HttpError("Bad Request", 400, null)],
        ["413", () => new HttpError("Payload Too Large", 413, null)]
    ])("treats a %s the same way as a 403", async (_status, error) => {
        // Criterion 4. The split is derived from retryability, not from a list
        // of statuses, so every non-retryable status that is not an
        // authentication challenge narrows the batch.
        const queue = new FakeQueue([plain("A"), plain("B")]);
        const client = new RecordingClient(notifier, refusing("A", error));

        await new WebClientSaver(client.asWebClient(), queue).save();

        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["A"]);
        expect(client.requests).toContainEqual(["B"]);
    });

    it.each([
        ["a transient status that outlived its retries", () => new HttpError("Service Unavailable", 503, null)],
        ["an error carrying no status", () => new Error("network error")],
        ["an authentication challenge reauthentication did not cure", () => new HttpError("Unauthorized", 401, null)]
    ])("stops the flush on %s", async (_description, error) => {
        // Criterion 5. Nothing here is a judgment of these facts, and every
        // later request would fail the same way, so the flush stops where it
        // always has.
        const queue = new FakeQueue([plain("A"), plain("B")]);
        const client = new RecordingClient(notifier, refusing("A", error));

        // One fact per batch, so a flush that continued would be visible as a
        // second request.
        await new WebClientSaver(client.asWebClient(), queue, { maxBatchCount: 1 }).save();

        expect(client.requests).toEqual([["A"]]);
        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["A", "B"]);
    });

    it("sends a refused fact again on a later flush, and its descendants with it", async () => {
        // Criterion 6. A refusal is evaluated against the replicator's graph,
        // which may later gain the fact that authorizes it. Nothing is dropped.
        let refused = true;
        const queue = new FakeQueue([plain("A"), descendant("C", ["A"])]);
        const client = new RecordingClient(notifier,
            hashes => refused && hashes.includes("A") ? forbidden() : undefined);
        const saver = new WebClientSaver(client.asWebClient(), queue);

        await saver.save();
        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["A", "C"]);

        refused = false;
        await saver.save();

        expect(queue.envelopes).toHaveLength(0);
        expect(client.requests[client.requests.length - 1]).toEqual(["A", "C"]);
    });

    it("sends the batches it always sent when every request succeeds", async () => {
        // Criterion 7. Narrowing happens only after a refusal, so an ordinary
        // flush is still bounded batches of the queue in order.
        const queue = new FakeQueue(
            Array.from({ length: 5 }, (_, i) => plain(`f${i}`)));
        const client = new RecordingClient(notifier, () => undefined);

        await new WebClientSaver(client.asWebClient(), queue, { maxBatchCount: 2 }).save();

        expect(client.requests).toEqual([["f0", "f1"], ["f2", "f3"], ["f4"]]);
        expect(queue.envelopes).toHaveLength(0);
    });

    it("reports what is still queued at the end of the flush, and nothing once it drains", async () => {
        // Criterion 8.
        const queue = new FakeQueue([plain("A"), plain("B"), descendant("C", ["A"])]);
        let refused = true;
        const client = new RecordingClient(notifier,
            hashes => refused && hashes.includes("A") ? forbidden() : undefined);
        const saver = new WebClientSaver(client.asWebClient(), queue);

        await saver.save();

        // A and C remain, and the count is of facts rather than of requests.
        expect(statuses[statuses.length - 1].warning).toContain("2 fact(s)");
        expect(statuses[statuses.length - 1].sending).toBe(false);

        refused = false;
        await saver.save();

        expect(queue.envelopes).toHaveLength(0);
        expect(statuses[statuses.length - 1].warning).toBe("");
        expect(statuses[statuses.length - 1].sending).toBe(false);
    });
});

// The model from the issue's demonstration. `Answer` is authorized for the
// users of every `Attendee` of its tenant, which is a successor walk: the
// rule's tail reads the store alone, so an `Attendee` in the same request
// cannot authorize it, whatever the order of the request.
class Tenant {
    static Type = "H.Tenant" as const;
    type = Tenant.Type;
    constructor(public creator: User, public identifier: string) { }
}

class Attendee {
    static Type = "H.Attendee" as const;
    type = Attendee.Type;
    constructor(public tenant: Tenant, public user: User) { }
}

class Answer {
    static Type = "H.Answer" as const;
    type = Answer.Type;
    constructor(public tenant: Tenant, public author: User) { }
}

// The same fact as Answer under a type name that sorts *after* "H.Attendee",
// so the queue's key order presents the pair the other way round.
class Reply {
    static Type = "H.Reply" as const;
    type = Reply.Type;
    constructor(public tenant: Tenant, public author: User) { }
}

const holdingModel = buildModel(b => b
    .type(User)
    .type(Tenant, x => x
        .predecessor("creator", User)
    )
    .type(Attendee, x => x
        .predecessor("tenant", Tenant)
        .predecessor("user", User)
    )
    .type(Answer, x => x
        .predecessor("tenant", Tenant)
        .predecessor("author", User)
    )
    .type(Reply, x => x
        .predecessor("tenant", Tenant)
        .predecessor("author", User)
    )
);

const holdingRules = new AuthorizationRules(holdingModel)
    .any(User)
    .type(Tenant, tenant => tenant.creator)
    .type(Attendee, attendee => attendee.user)
    .type(Answer, (answer, facts) => facts.ofType(Attendee)
        .join(attendee => attendee.tenant, answer.tenant)
        .selectMany(attendee => facts.ofType(User)
            .join(user => user, attendee.user)))
    .type(Reply, (reply, facts) => facts.ofType(Attendee)
        .join(attendee => attendee.tenant, reply.tenant)
        .selectMany(attendee => facts.ofType(User)
            .join(user => user, attendee.user)));

const userLiteral = { type: "Jinaga.User", publicKey: "---attendee---" };
const tenantLiteral = { type: "H.Tenant", creator: userLiteral, identifier: "tenant-1" };
const attendeeLiteral = { type: "H.Attendee", tenant: tenantLiteral, user: userLiteral };
const answerLiteral = { type: "H.Answer", tenant: tenantLiteral, author: userLiteral };
const replyLiteral = { type: "H.Reply", tenant: tenantLiteral, author: userLiteral };

function recordOf(literal: {}, type: string): FactRecord {
    return dehydrateFact(literal).find(fact => fact.type === type)!;
}

function envelopeOf(literal: {}, type: string): FactEnvelope {
    return { fact: recordOf(literal, type), signatures: [] };
}

/**
 * A stand-in for `WebClient` that authorizes each request the way the
 * replicator does -- one request is one batch, judged as a unit -- and saves
 * what it accepts. The deadlock this exercises comes from those authorization
 * semantics, so a scripted refusal would not reproduce it.
 */
class AuthorizingClient {
    public readonly requests: string[][] = [];
    private readonly engine: AuthorizationEngine;

    constructor(
        private readonly notifier: SyncStatusNotifier,
        private readonly store: MemoryStore,
        private readonly user: FactRecord
    ) {
        this.engine = new AuthorizationEngine(holdingRules, store);
    }

    notifySyncStatus(status: SyncStatus) {
        this.notifier.notify(status);
    }

    async saveWithRetry(envelopes: FactEnvelope[]): Promise<void> {
        this.requests.push(envelopes.map(e => e.fact.type));
        try {
            await this.engine.authorizeFacts(envelopes, this.user);
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : `${error}`;
            // The replicator answers a batch it refused with 403, and a batch
            // it could not resolve with 400. Both are refusals: the response
            // is about these facts, and it will repeat.
            throw error instanceof Forbidden
                ? new ForbiddenError(reason, null)
                : new HttpError(reason, 400, null);
        }
        // Nothing is saved until the whole batch has been authorized.
        await this.store.save(envelopes);
    }

    asWebClient(): WebClient {
        return this as unknown as WebClient;
    }
}

describe("Save queue flush under the replicator's authorization (issue #395)", () => {
    let notifier: SyncStatusNotifier;
    let statuses: SyncStatus[];
    let store: MemoryStore;
    let client: AuthorizingClient;

    beforeEach(async () => {
        notifier = new SyncStatusNotifier();
        statuses = [];
        notifier.onSyncStatus(status => statuses.push(status));

        // The user and the tenant were committed by earlier requests, as they
        // would have been before an attendee joins.
        store = new MemoryStore();
        const user = recordOf(userLiteral, "Jinaga.User");
        await store.save([
            { fact: user, signatures: [] },
            { fact: recordOf(tenantLiteral, "H.Tenant"), signatures: [] }
        ]);
        client = new AuthorizingClient(notifier, store, user);
    });

    // Between facts that do not reference each other the queue's order is key
    // order, and a key is `type:hash`. So the type names decide which of the
    // pair the replicator sees first, and the flush must drain either way.
    it.each([
        ["H.Answer", answerLiteral],
        ["H.Reply", replyLiteral]
    ])("drains a queue holding an Attendee and a %s, whichever key sorts first", async (answerType, literal) => {
        const queued = [
            envelopeOf(attendeeLiteral, "H.Attendee"),
            envelopeOf(literal, answerType)
        ].sort((a, b) =>
            `${a.fact.type}:${a.fact.hash}`.localeCompare(`${b.fact.type}:${b.fact.hash}`));
        const queue = new FakeQueue(queued);

        // The case this parameter exercises: "H.Answer" sorts before
        // "H.Attendee", so the fact that needs authorizing is offered first;
        // "H.Reply" sorts after it.
        expect(queued[0].fact.type).toBe(
            answerType === "H.Answer" ? "H.Answer" : "H.Attendee");

        await new WebClientSaver(client.asWebClient(), queue).save();

        // Both facts are committed and the queue is empty. Today neither is:
        // every flush sends them as one batch, the batch is refused because a
        // successor-walk rule cannot see the Attendee in its own request, and
        // the queue survives every reload.
        const saved = await store.whichExist(queued.map(e => e.fact));
        expect(saved.map(r => r.type).sort()).toEqual(["H.Attendee", answerType].sort());
        expect(queue.envelopes).toHaveLength(0);
        expect(statuses[statuses.length - 1].warning).toBe("");
    });
});

/**
 * A connection that hands back a scripted sequence of results, so the retry
 * loop can be driven without a replicator. The last entry repeats, which is how
 * a test says "every attempt from here on answers the same way".
 */
class ScriptedConnection implements HttpConnection {
    public readonly paths: string[] = [];

    constructor(private readonly responses: HttpResponse[]) { }

    get(path: string): Promise<{}> {
        throw new Error("not used");
    }

    getStream(): () => void {
        throw new Error("not used");
    }

    async post(path: string, contentType: PostContentType, accept: PostAccept, body: string, timeoutSeconds: number): Promise<HttpResponse> {
        this.paths.push(path);
        return this.responses[Math.min(this.paths.length - 1, this.responses.length - 1)];
    }

    async getAcceptedContentTypes(path: string): Promise<string[]> {
        return [ContentTypeJson];
    }
}

// A result the connection asks the caller to retry, which is what it reports
// for a 5xx, a 429, and -- in `FetchConnection` -- a network error or a timeout
// of its own.
function transient(error: string, statusCode: number): HttpResponse {
    return { result: "retry", error, statusCode, body: null };
}

const succeeded: HttpResponse = { result: "success", response: {} };

// A fetch Response stand-in with the shape `FetchConnection` reads.
function createdResponse() {
    return {
        status: 201,
        statusText: "Created",
        headers: { get: (_header: string): string | null => null },
        json: async () => ({}),
        text: async () => ""
    };
}

// The two ways `FetchConnection.httpPost` learns that the request never reached
// a replicator: the fetch rejected, or its own abort fired.
/**
 * Let every pending microtask run, without advancing any clock. A hundred turns
 * is well past the handful of awaits between a flush starting and the retry
 * loop reaching its first wait, and it is not a delay: nothing here waits on
 * wall-clock time, so the only thing that can still be outstanding afterwards
 * is work blocked on a timer.
 */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 100; turn++) {
        await Promise.resolve();
    }
}

const connectionFailures: [string, () => Error][] = [
    ["a network error", () => new Error("socket hang up")],
    ["a request timeout", () => Object.assign(new Error("aborted"), { name: "AbortError" })]
];

describe("A save that is retrying (issue #399)", () => {
    const realFetch = global.fetch;

    let notifier: SyncStatusNotifier;
    let statuses: SyncStatus[];

    beforeEach(() => {
        notifier = new SyncStatusNotifier();
        statuses = [];
        notifier.onSyncStatus(status => statuses.push(status));
        // The schedule adds jitter so that clients which have all reached the
        // ceiling still spread their attempts. Pinning it makes the wait the
        // loop takes exactly the wait the schedule plans, so a test can name
        // the seconds it expects to be reported.
        jest.spyOn(Math, "random").mockReturnValue(0);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        global.fetch = realFetch;
    });

    function saverOver(connection: HttpConnection, retry: RetryOptions, queue = new FakeQueue([plain("A")])) {
        const client = new WebClient(connection, notifier, { timeoutSeconds: 30, retry });
        return new WebClientSaver(client, queue);
    }

    it("reports the retry, the wait it is about to take, and the error behind it", async () => {
        // Criterion 1. Today the retry is logged and nothing else learns of it,
        // so a consumer watching `onSyncStatus` sees `sending: true,
        // retrying: false` throughout and cannot tell a stalled save from a
        // slow one.
        const connection = new ScriptedConnection([
            transient("Service Unavailable", 503),
            succeeded
        ]);

        await saverOver(connection, { initialDelayMs: 20, maxDelayMs: 20 }).save();

        expect(statuses).toEqual([
            { sending: true, retrying: false, retryInSeconds: 0, warning: "" },
            { sending: true, retrying: true, retryInSeconds: 0.02, warning: "Service Unavailable" },
            { sending: false, retrying: false, retryInSeconds: 0, warning: "" }
        ]);
    });

    it("reports the retry before the wait elapses, not after it", async () => {
        // Criterion 2. A report that arrives once the wait is over names a
        // delay the consumer can no longer act on. Holding the wait open is
        // what makes the difference observable without timing anything: the
        // loop's own `setTimeout` is captured here rather than scheduled, so
        // nothing read below can have happened after the wait, and the attempt
        // the wait precedes has not been made.
        //
        // Jest's fake timers would say the same thing, and cannot be used:
        // under Node's read-only `performance` the modern implementation
        // throws from `useFakeTimers` with the clock half installed, which
        // strands every test after it.
        const connection = new ScriptedConnection([
            transient("Service Unavailable", 503),
            succeeded
        ]);
        const waiting: (() => void)[] = [];
        jest.spyOn(global, "setTimeout").mockImplementation(((callback: () => void) => {
            waiting.push(callback);
            return 0;
        }) as unknown as typeof setTimeout);

        const flush = saverOver(connection, { initialDelayMs: 20, maxDelayMs: 20 }).save();

        // What had been reported, and what had been attempted, at the moment
        // the loop settled into its wait.
        await settle();
        const reportedBeforeTheWait = statuses.filter(status => status.retrying);
        const attemptedBeforeTheWait = [...connection.paths];

        // Release the wait and let the flush finish before asserting, so the
        // test leaves nothing outstanding whichever way it goes.
        expect(waiting).toHaveLength(1);
        waiting[0]();
        await flush;

        expect(reportedBeforeTheWait).toEqual([
            { sending: true, retrying: true, retryInSeconds: 0.02, warning: "Service Unavailable" }
        ]);
        expect(attemptedBeforeTheWait).toEqual(["/save"]);
        expect(connection.paths).toEqual(["/save", "/save"]);
        expect(statuses[statuses.length - 1]).toEqual(
            { sending: false, retrying: false, retryInSeconds: 0, warning: "" });
    });

    it.each(connectionFailures)("reports %s the way FetchConnection maps it", async (_description, failure) => {
        // Criterion 3. An unreachable replicator has to reach the same report,
        // and whether it does depends on the mapping `FetchConnection` applies
        // -- a rejected fetch becomes a 500 and an abort a 408, both of which
        // the loop reads as transient. So this drives that connection rather
        // than restating the mapping here.
        let posts = 0;
        global.fetch = jest.fn(async (_url: any, init?: any) => {
            if (init?.method === "OPTIONS") {
                // What `/save` accepts, which the client asks for first.
                return { headers: { get: (_header: string): string | null => ContentTypeJson } };
            }
            posts++;
            if (posts === 1) {
                throw failure();
            }
            return createdResponse();
        }) as any;

        const connection = new FetchConnection(
            "http://localhost",
            () => Promise.resolve({}),
            () => Promise.resolve(false));

        await saverOver(connection, { initialDelayMs: 20, maxDelayMs: 20 }).save();

        expect(posts).toBe(2);
        expect(statuses).toHaveLength(3);
        expect(statuses[0]).toEqual({ sending: true, retrying: false, retryInSeconds: 0, warning: "" });
        expect(statuses[1].sending).toBe(true);
        expect(statuses[1].retrying).toBe(true);
        expect(statuses[1].retryInSeconds).toBe(0.02);
        // Whatever the connection called it, the transient error reaches the
        // consumer rather than an empty warning.
        expect(statuses[1].warning).not.toBe("");
        expect(statuses[2]).toEqual({ sending: false, retrying: false, retryInSeconds: 0, warning: "" });
    });

    it("reports every retry under an unbounded schedule, each with its own wait", async () => {
        // Criterion 4. `timeoutMs: 0` is the schedule a save that must
        // eventually land wants, and it is the schedule under which the stall
        // warning never arrives at all: these reports are the only account of
        // an unreachable replicator a consumer gets. So `retryInSeconds` has to
        // stay current, which means reporting on each retry rather than once.
        const connection = new ScriptedConnection([
            transient("Service Unavailable", 503),
            transient("Service Unavailable", 503),
            transient("Service Unavailable", 503),
            succeeded
        ]);

        await saverOver(connection, {
            initialDelayMs: 10,
            maxDelayMs: 1000,
            backoffMultiplier: 2,
            timeoutMs: 0
        }).save();

        // The waits the schedule plans, in order, rather than the first one
        // repeated.
        expect(statuses.filter(status => status.retrying).map(status => status.retryInSeconds))
            .toEqual([0.01, 0.02, 0.04]);
        expect(statuses[statuses.length - 1]).toEqual(
            { sending: false, retrying: false, retryInSeconds: 0, warning: "" });
    });

    it("still warns that the save stalled once the schedule runs out", async () => {
        // Criterion 5. The stall warning is what a consumer had before this
        // change, and it arrives after the last retry report rather than in
        // place of it.
        const connection = new ScriptedConnection([transient("Service Unavailable", 503)]);
        const queue = new FakeQueue([plain("A")]);

        await saverOver(connection, { initialDelayMs: 10, maxDelayMs: 10, timeoutMs: 25 }, queue).save();

        // A budget of 25ms admits two waits of 10ms and refuses a third.
        expect(statuses.filter(status => status.retrying).map(status => status.retryInSeconds))
            .toEqual([0.01, 0.01]);
        expect(statuses[statuses.length - 2].retrying).toBe(true);
        const stalled = statuses[statuses.length - 1];
        expect(stalled.sending).toBe(false);
        expect(stalled.retrying).toBe(false);
        expect(stalled.warning).toContain("1 fact(s) could not be sent");
        expect(queue.envelopes.map(e => e.fact.hash)).toEqual(["A"]);
    });

    it("reports nothing for a /load that retries", async () => {
        // Criterion 6. `loadWithRetry` takes the same loop, but `SyncStatus`
        // describes outgoing facts, so a retried read has nothing to say
        // through it.
        const connection = new ScriptedConnection([
            transient("Service Unavailable", 503),
            { result: "success", response: { facts: [] } }
        ]);
        const client = new WebClient(connection, notifier, {
            timeoutSeconds: 30,
            retry: { initialDelayMs: 10, maxDelayMs: 10 }
        });

        const response = await client.loadWithRetry({ references: [] });

        expect(response.facts).toEqual([]);
        expect(connection.paths).toEqual(["/load", "/load"]);
        expect(statuses).toEqual([]);
    });

    it("reports no retry for a save the replicator refused", async () => {
        // Criterion 7. A non-retryable status is the replicator's judgment of
        // these facts, and no wait changes it, so there is no retry to report
        // -- only what is still queued when the flush ends.
        const connection = new ScriptedConnection([
            { result: "failure", error: "Bad Request", statusCode: 400, body: null }
        ]);
        const queue = new FakeQueue([plain("A")]);

        await saverOver(connection, { initialDelayMs: 10, maxDelayMs: 10 }, queue).save();

        expect(statuses.some(status => status.retrying)).toBe(false);
        expect(connection.paths).toEqual(["/save"]);
        expect(statuses[statuses.length - 1].warning).toContain("1 fact(s) could not be sent");
    });
});
