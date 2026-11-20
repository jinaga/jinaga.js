import {
    Authentication,
    AuthenticationCurrentUser,
    FactEnvelope,
    FactRecord,
    FactReference,
    MemoryStore,
    PersistentFork,
    PersistentForkOptions,
    Queue,
    QueuedEnvelope,
    SyncStatusNotifier,
    WebClient
} from "@src";
import { ContentTypeJson, PostAccept, PostContentType } from "../../src/http/ContentType";
import { LoginResponse } from "../../src/http/messages";
import { HttpConnection, HttpResponse } from "../../src/http/web-client";

/**
 * The bearer token the connection carries, which is the whole of what the
 * replicator reads to decide whose write a fact is: `/save` authorizes the
 * batch against the user on the request's token, and signs the facts it accepts
 * with that user's key where a rule requires a signature.
 *
 * A browser keeps one of these, so logging in replaces it.
 */
class Session {
    public token: string | null = null;
}

/**
 * The token that names a user to the replicator. The double derives it from the
 * user's own fact, so a request's token can be read back as a user.
 */
function tokenOf(user: FactRecord): string {
    return `token-for-${user.hash}`;
}

function referenceTo(fact: FactRecord): FactReference {
    return { type: fact.type, hash: fact.hash };
}

/** One `POST /save` the client made. */
interface SaveRequest {
    /** The token it carried, which is the user it would be attributed to. */
    token: string | null;
    /** The hashes of the facts in its body, in the order it carried them. */
    hashes: string[];
}

/**
 * A connection that records the token of each `POST /save`, and accepts
 * everything.
 *
 * The token is read when the request is made rather than when the fact was
 * written, which is what a real authentication provider's header does and is
 * the whole of the defect: the queue outlives the session whose token it would
 * be drained under.
 */
class RecordingConnection implements HttpConnection {
    public readonly saves: SaveRequest[] = [];
    /**
     * Run after a `POST /save` is recorded, so a test can have something happen
     * between two of a flush's requests.
     */
    public onSave: (() => Promise<void>) | undefined = undefined;

    constructor(
        private readonly session: Session
    ) { }

    async get(path: string): Promise<{}> {
        return {};
    }

    getStream(): () => void {
        throw new Error("not used");
    }

    async post(path: string, contentType: PostContentType, accept: PostAccept, body: string): Promise<HttpResponse> {
        if (path === "/save") {
            const message = JSON.parse(body) as { facts: FactRecord[] };
            this.saves.push({
                token: this.session.token,
                hashes: message.facts.map(fact => fact.hash)
            });
            if (this.onSave) {
                await this.onSave();
            }
        }
        return { result: "success", response: {} };
    }

    async getAcceptedContentTypes(path: string): Promise<string[]> {
        return [ContentTypeJson];
    }

    /** Every fact sent so far, in the order the requests carried them. */
    get sentHashes(): string[] {
        return this.saves.reduce<string[]>((all, save) => all.concat(save.hashes), []);
    }
}

/**
 * An authentication whose `login()` resolves with whichever user the test
 * chooses, and which replaces the session's token with that user's, as a
 * browser login does.
 *
 * It is wrapped in the real `AuthenticationCurrentUser`, so what the fork reads
 * is the production record of who is current rather than anything this double
 * asserts.
 */
class FakeAuthentication implements Authentication {
    private user: FactRecord | null = null;

    constructor(
        private readonly session: Session
    ) { }

    /** Who the next `login()` resolves with. */
    willResolveWith(user: FactRecord): void {
        this.user = user;
    }

    async login(): Promise<LoginResponse> {
        const user = this.user;
        if (!user) {
            throw new Error("No user was chosen for this login.");
        }
        this.session.token = tokenOf(user);
        return {
            userFact: user,
            profile: { displayName: user.hash }
        };
    }

    async local(): Promise<FactRecord> {
        throw new Error("not used");
    }

    async authorize(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        return envelopes;
    }
}

function sameFact(a: FactReference, b: FactReference): boolean {
    return a.type === b.type && a.hash === b.hash;
}

/**
 * An in-memory queue that records the user with each fact, as the IndexedDB
 * queue does: a fact already queued keeps the user it was written with, because
 * a later write that names it as a predecessor enqueues it again.
 */
class FakeQueue implements Queue {
    constructor(
        public envelopes: QueuedEnvelope[] = []
    ) { }

    async peek(): Promise<QueuedEnvelope[]> {
        return this.envelopes;
    }

    async enqueue(envelopes: FactEnvelope[], user?: FactReference): Promise<void> {
        for (const envelope of envelopes) {
            if (this.envelopes.some(queued => sameFact(queued.fact, envelope.fact))) {
                continue;
            }
            this.envelopes = [
                ...this.envelopes,
                user ? { ...envelope, user } : envelope
            ];
        }
    }

    async dequeue(envelopes: FactEnvelope[]): Promise<void> {
        this.envelopes = this.envelopes.filter(queued =>
            !envelopes.some(envelope => sameFact(queued.fact, envelope.fact)));
    }

    /** The user recorded with a queued fact, or undefined if it is not queued. */
    userOf(hash: string): FactReference | undefined {
        return this.envelopes.find(queued => queued.fact.hash === hash)?.user;
    }

    get hashes(): string[] {
        return this.envelopes.map(queued => queued.fact.hash);
    }
}

/**
 * A queue that knows nothing about users: `enqueue` ignores the one it is
 * given, and `peek` returns plain envelopes. A `Queue` written before the user
 * was recorded, such as a replicator's own, is this one, and it must still both
 * compile against the interface and flush as it always did.
 */
class PlainQueue implements Queue {
    constructor(
        public envelopes: FactEnvelope[] = []
    ) { }

    async peek(): Promise<FactEnvelope[]> {
        return this.envelopes;
    }

    async enqueue(envelopes: FactEnvelope[]): Promise<void> {
        this.envelopes = [...this.envelopes, ...envelopes];
    }

    async dequeue(envelopes: FactEnvelope[]): Promise<void> {
        this.envelopes = this.envelopes.filter(queued =>
            !envelopes.some(envelope => sameFact(queued.fact, envelope.fact)));
    }
}

function userFact(name: string): FactRecord {
    return {
        type: "Jinaga.User",
        hash: `public-key-of-${name}`,
        predecessors: {},
        fields: { publicKey: `-----${name}-----` }
    };
}

function envelopeFor(hash: string, predecessors: FactRecord[] = []): FactEnvelope {
    return {
        fact: {
            type: "Test.Fact",
            hash,
            predecessors: predecessors.length === 0
                ? {}
                : { prior: predecessors.map(referenceTo) },
            fields: {}
        },
        signatures: []
    };
}

describe("Attributing a queued fact to the user who wrote it (issue #412)", () => {
    const alice = userFact("alice");
    const bob = userFact("bob");

    /**
     * The debounce, long enough that no flush happens on its own during a test.
     * Every flush here is one the test asked for, so "sent" and "not sent" are
     * properties of the whole recording rather than of a window inside it. No
     * test waits for this to elapse.
     */
    const noAutomaticFlush = 60_000;

    let session: Session;
    let connection: RecordingConnection;
    let inner: FakeAuthentication;
    let authentication: AuthenticationCurrentUser;
    let fork: PersistentFork;
    let warnings: string[];

    function createFork(queue: Queue, options: PersistentForkOptions = {}): void {
        session = new Session();
        connection = new RecordingConnection(session);
        const syncStatusNotifier = new SyncStatusNotifier();
        warnings = [];
        syncStatusNotifier.onSyncStatus(status => warnings.push(status.warning));
        const client = new WebClient(connection, syncStatusNotifier, {
            timeoutSeconds: 30
        });
        inner = new FakeAuthentication(session);
        authentication = new AuthenticationCurrentUser(inner);
        fork = new PersistentFork(new MemoryStore(), queue, client, noAutomaticFlush, options,
            authentication);
    }

    /** Log in, through the wrapper the client uses in production. */
    async function loginAs(user: FactRecord): Promise<void> {
        inner.willResolveWith(user);
        await authentication.login();
    }

    beforeEach(() => {
        // The debounce is never meant to elapse, so the clock is held still
        // rather than left to schedule a flush behind an assertion. Every
        // flush in this suite is an explicit one, and no test waits on a timer.
        jest.useFakeTimers();
    });

    afterEach(async () => {
        await fork.close();
        jest.useRealTimers();
    });

    it("holds a fact written by a user who is no longer logged in", async () => {
        // Criterion 1. Alice writes while offline, Bob logs in on the same
        // device before the queue drains, and the flush that follows must not
        // send Alice's write under Bob's token.
        const queue = new FakeQueue();
        createFork(queue);
        await loginAs(alice);
        await fork.save([envelopeFor("written-by-alice")]);

        await loginAs(bob);
        await fork.processQueueNow();

        expect(connection.saves).toEqual([]);
        expect(queue.hashes).toEqual(["written-by-alice"]);
    });

    it("sends a held fact under its own user's token once that user is current again", async () => {
        // Criterion 2. Nothing is dropped: the wait ends when the user who
        // wrote the fact is the one the replicator would attribute it to.
        const queue = new FakeQueue();
        createFork(queue);
        await loginAs(alice);
        await fork.save([envelopeFor("written-by-alice")]);
        await loginAs(bob);
        await fork.processQueueNow();

        await loginAs(alice);
        await fork.processQueueNow();

        expect(connection.saves).toEqual([
            { token: tokenOf(alice), hashes: ["written-by-alice"] }
        ]);
        expect(queue.hashes).toEqual([]);
    });

    it("sends the current user's facts while another user's wait", async () => {
        // Criterion 3. One held fact must not hold up the user who is actually
        // logged in.
        const queue = new FakeQueue();
        createFork(queue);
        await loginAs(alice);
        await fork.save([envelopeFor("written-by-alice")]);
        await loginAs(bob);
        await fork.save([envelopeFor("written-by-bob")]);

        await fork.processQueueNow();

        expect(connection.saves).toEqual([
            { token: tokenOf(bob), hashes: ["written-by-bob"] }
        ]);
        expect(queue.hashes).toEqual(["written-by-alice"]);
    });

    it("holds the queued descendants of a held fact", async () => {
        // Criterion 4. A successor cannot be sent while its predecessor is
        // still queued, so it waits with it rather than arriving with a
        // dangling reference.
        const queue = new FakeQueue();
        createFork(queue);
        await loginAs(alice);
        const ancestor = envelopeFor("written-by-alice");
        await fork.save([ancestor]);
        await fork.save([envelopeFor("descends-from-alice", [ancestor.fact])]);

        await loginAs(bob);
        await fork.processQueueNow();

        expect(connection.saves).toEqual([]);
        expect(queue.hashes).toEqual(["written-by-alice", "descends-from-alice"]);
    });

    it("holds the current user's own fact when it descends from a held one", async () => {
        // Still criterion 4, from the other side: the descendant is Bob's, and
        // Bob is logged in, but its predecessor is Alice's and is waiting.
        // Sending it would reference a fact the replicator does not have.
        const queue = new FakeQueue();
        createFork(queue);
        await loginAs(alice);
        const ancestor = envelopeFor("written-by-alice");
        await fork.save([ancestor]);

        await loginAs(bob);
        // A write sends the facts its prototype names as predecessors, so an
        // already-queued fact is enqueued again by whoever writes a successor.
        // The user recorded is the one who wrote it, not the one writing now.
        await fork.save([ancestor, envelopeFor("written-by-bob", [ancestor.fact])]);
        await fork.processQueueNow();

        expect(connection.saves).toEqual([]);
        expect(queue.userOf("written-by-alice")).toEqual(referenceTo(alice));
    });

    it("sends a fact written before any login resolved", async () => {
        // Criterion 5. A client that has not logged in records no user, so its
        // facts go out as they always have.
        const queue = new FakeQueue();
        createFork(queue);
        await fork.save([envelopeFor("written-by-nobody")]);

        await fork.processQueueNow();

        expect(connection.saves).toEqual([
            { token: null, hashes: ["written-by-nobody"] }
        ]);
        expect(queue.hashes).toEqual([]);
    });

    it("holds a fact queued by an earlier session until that user logs in", async () => {
        // Criterion 6. The startup flush runs before any login has resolved, so
        // without this a fact queued yesterday goes out under whatever token
        // the connection happens to hold today.
        const queue = new FakeQueue([
            { ...envelopeFor("written-by-alice"), user: referenceTo(alice) }
        ]);
        createFork(queue);

        fork.initialize();
        await fork.processQueueNow();

        expect(connection.saves).toEqual([]);

        await loginAs(alice);
        await fork.processQueueNow();

        expect(connection.saves).toEqual([
            { token: tokenOf(alice), hashes: ["written-by-alice"] }
        ]);
    });

    it("sends a queued entry that recorded no user", async () => {
        // Criterion 7. An entry written by a client from before the user was
        // recorded has none, and must not be stranded by a rule it predates.
        const queue = new FakeQueue([envelopeFor("queued-in-the-old-shape")]);
        createFork(queue);

        await loginAs(bob);
        await fork.processQueueNow();

        expect(connection.saves).toEqual([
            { token: tokenOf(bob), hashes: ["queued-in-the-old-shape"] }
        ]);
        expect(queue.hashes).toEqual([]);
    });

    it("stops sending a user's facts when the user changes during the flush", async () => {
        // A flush is a sequence of requests, and the token each one carries is
        // read when that request starts, from the application's own
        // authentication provider. So the choice of what to send can be stale
        // by the time a later request is composed, and the rest of Alice's
        // facts would go out under Bob's token.
        const queue = new FakeQueue();
        createFork(queue, { maxBatchCount: 1 });
        await loginAs(alice);
        await fork.save([envelopeFor("first-by-alice")]);
        await fork.save([envelopeFor("second-by-alice")]);

        connection.onSave = async () => {
            // Once, between the two requests this flush makes.
            connection.onSave = undefined;
            await loginAs(bob);
        };
        await fork.processQueueNow();

        expect(connection.saves).toEqual([
            { token: tokenOf(alice), hashes: ["first-by-alice"] }
        ]);
        expect(queue.hashes).toEqual(["second-by-alice"]);
        // It is waiting for Alice, not failing, so the flush reports no
        // warning about it.
        expect(warnings.filter(warning => warning !== "")).toEqual([]);
    });

    it("flushes a queue that ignores the user exactly as before", async () => {
        // Criterion 8. A Queue implementation that does not record the user
        // returns plain envelopes, and the flush reads them as facts with no
        // user: it keeps the behavior it has today, exposure included.
        const queue = new PlainQueue();
        createFork(queue);
        await loginAs(alice);
        await fork.save([envelopeFor("written-by-alice")]);

        await loginAs(bob);
        await fork.processQueueNow();

        expect(connection.saves).toEqual([
            { token: tokenOf(bob), hashes: ["written-by-alice"] }
        ]);
        expect(queue.envelopes).toEqual([]);
    });
});
