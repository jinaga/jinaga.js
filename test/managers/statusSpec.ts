import {
    AuthenticationNoOp,
    FactEnvelope,
    FactManager,
    FactReference,
    FeedResponse,
    FeedsResponse,
    HttpConnection,
    HttpResponse,
    Jinaga,
    MemoryStore,
    ObservableSource,
    PassThroughFork,
    PersistentFork,
    Queue,
    Specification,
    SyncStatusNotifier,
    User,
    WebClient,
} from "@src";
import { ContentTypeJson, PostAccept, PostContentType } from "../../src/http/ContentType";
import { DistributionIntersectionBranch } from "../../src/distribution/distribution-engine";
import { Network } from "../../src/managers/NetworkManager";
import { Blog, Post, model } from "../blogModel";
import { waitForCondition } from "../utils/async-test-utils";

/**
 * A promise a test resolves when it chooses to. Both fixtures below are built
 * from these rather than from delays, so every wait in this file is on the
 * event it is waiting for.
 */
interface Gate {
    readonly opened: Promise<void>;
    open(): void;
    fail(error: Error): void;
}

function gate(): Gate {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const opened = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return {
        opened,
        open: () => resolve(),
        fail: (error: Error) => reject(error)
    };
}

const FEED = "status-feed";

/**
 * A Network whose `fetchFeed` stays open until the test releases it, so a load
 * can be observed while it is still in flight. `entered` resolves the first time
 * `fetchFeed` is called.
 */
class GatedNetwork implements Network {
    private readonly entry = gate();
    private readonly release = gate();
    public fetchFeedCalls = 0;

    get entered(): Promise<void> {
        return this.entry.opened;
    }

    releaseFetchFeed(): void {
        this.release.open();
    }

    failFetchFeed(error: Error): void {
        this.release.fail(error);
    }

    feeds(): Promise<FeedsResponse> {
        return Promise.resolve({ feeds: [FEED] });
    }

    async fetchFeed(_feed: string, bookmark: string): Promise<FeedResponse> {
        this.fetchFeedCalls++;
        this.entry.open();
        await this.release.opened;
        return { references: [], bookmark };
    }

    streamFeed(): () => void {
        throw new Error("not used");
    }

    load(_factReferences: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve([]);
    }

    intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
        return Promise.resolve([{ start, specification }]);
    }
}

/**
 * A connection whose `POST /save` stays open until the test releases it, so the
 * outgoing queue can be observed while it still holds facts.
 */
class GatedConnection implements HttpConnection {
    private readonly release = gate();
    private released = false;

    releaseSave(): void {
        this.released = true;
        this.release.open();
    }

    get(): Promise<{}> {
        throw new Error("not used");
    }

    getStream(): () => void {
        throw new Error("not used");
    }

    async post(_path: string, _contentType: PostContentType, _accept: PostAccept, _body: string): Promise<HttpResponse> {
        if (!this.released) {
            await this.release.opened;
        }
        return { result: "success", response: {} };
    }

    async getAcceptedContentTypes(): Promise<string[]> {
        return [ContentTypeJson];
    }
}

/**
 * A queue that keys facts by identity, as IndexedDBQueue does, so a fact queued
 * twice is one fact waiting to be sent.
 */
class FakeQueue implements Queue {
    private envelopes: FactEnvelope[] = [];

    async peek(): Promise<FactEnvelope[]> {
        return [...this.envelopes];
    }

    async enqueue(envelopes: FactEnvelope[]): Promise<void> {
        for (const envelope of envelopes) {
            const index = this.envelopes.findIndex(e =>
                e.fact.type === envelope.fact.type && e.fact.hash === envelope.fact.hash);
            if (index < 0) {
                this.envelopes.push(envelope);
            }
            else {
                this.envelopes[index] = envelope;
            }
        }
    }

    async dequeue(envelopes: FactEnvelope[]): Promise<void> {
        const removed = new Set(envelopes.map(e => `${e.fact.type}:${e.fact.hash}`));
        this.envelopes = this.envelopes.filter(e => !removed.has(`${e.fact.type}:${e.fact.hash}`));
    }
}

class Root {
    static Type = "Status.Root" as const;
    type = Root.Type;

    constructor(
        public identifier: string
    ) { }
}

describe("client status reporting (issue #306)", () => {
    const blog = new Blog(new User("creator"), "domain");
    const blogPosts = model.given(Blog).match((blog, facts) =>
        facts.ofType(Post).join(post => post.blog, blog)
    );

    function createClient(network: Network): Jinaga {
        const store = new MemoryStore();
        const factManager = new FactManager(
            new PassThroughFork(store), new ObservableSource(store), store, network, []);
        return new Jinaga(new AuthenticationNoOp(), factManager, null);
    }

    it("reports loading while a fetch is in flight, and not loading once it resolves", async () => {
        const network = new GatedNetwork();
        const j = createClient(network);
        const loading: boolean[] = [];
        j.onLoading(state => loading.push(state));

        const query = j.query(blogPosts, blog);
        await network.entered;

        expect(loading).toEqual([true]);

        network.releaseFetchFeed();
        await query;

        expect(loading).toEqual([true, false]);
    });

    it("reports one loading transition for two overlapping fetches", async () => {
        const network = new GatedNetwork();
        const j = createClient(network);
        const loading: boolean[] = [];
        j.onLoading(state => loading.push(state));

        const first = j.query(blogPosts, blog);
        await network.entered;
        const second = j.query(blogPosts, blog);

        expect(loading).toEqual([true]);

        network.releaseFetchFeed();
        await Promise.all([first, second]);

        expect(loading).toEqual([true, false]);
    });

    it("reports a failed fetch to the error handler, and stops loading", async () => {
        const network = new GatedNetwork();
        const j = createClient(network);
        const loading: boolean[] = [];
        const errors: unknown[] = [];
        j.onLoading(state => loading.push(state));
        j.onError(error => errors.push(error));

        const query = j.query(blogPosts, blog);
        await network.entered;
        network.failFetchFeed(new Error("the replicator is unreachable"));

        await expect(query).rejects.toThrow("the replicator is unreachable");

        expect(errors).toHaveLength(1);
        expect(`${errors[0]}`).toContain("the replicator is unreachable");
        expect(loading).toEqual([true, false]);
    });

    it("reports the number of facts waiting to be sent, and zero once the queue drains", async () => {
        const store = new MemoryStore();
        const queue = new FakeQueue();
        const connection = new GatedConnection();
        const webClient = new WebClient(connection, new SyncStatusNotifier(), { timeoutSeconds: 30 });
        // No delay before a flush, so the only thing holding facts in the queue
        // is the gated save.
        const fork = new PersistentFork(store, queue, webClient, 0);
        const factManager = new FactManager(fork, new ObservableSource(store), store, new GatedNetwork(), []);
        const j = new Jinaga(new AuthenticationNoOp(), factManager, null);

        const progress: number[] = [];
        j.onProgress(count => progress.push(count));

        await j.fact(new Root("first"));
        await j.fact(new Root("second"));
        await j.fact(new Root("third"));

        expect(progress).toEqual([1, 2, 3]);
        expect(await queue.peek()).toHaveLength(3);

        connection.releaseSave();
        await waitForCondition(() => progress[progress.length - 1] === 0);

        expect(progress[progress.length - 1]).toBe(0);
        expect(await queue.peek()).toHaveLength(0);
    });
});
