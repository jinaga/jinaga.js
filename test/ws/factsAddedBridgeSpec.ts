import {
    computeHash,
    FactEnvelope,
    FactFeed,
    FactManager,
    FactRecord,
    FactReference,
    GraphSerializer,
    MemoryStore,
    NetworkNoOp,
    ObservableSource,
    PassThroughFork,
    ProjectedResult,
    Specification,
    Storage,
    Trace,
    Tracer,
    WsGraphNetwork
} from '@src';
import { connectFactsAdded } from '../../src/managers/factsAddedBridge';
import { WsGraphClient } from '../../src/ws/ws-graph-client';
import { waitForCondition } from '../utils/async-test-utils';

/**
 * A WebSocket the test drives by hand. `WsGraphClient` reaches for the global
 * constructor, so installing this one lets the test open the socket and
 * deliver each frame at a moment it chooses.
 */
class FakeWebSocket {
    static instances: FakeWebSocket[] = [];

    readyState = 0;
    onopen: ((ev: any) => any) | null = null;
    onclose: ((ev: any) => any) | null = null;
    onerror: ((ev: any) => any) | null = null;
    onmessage: ((ev: { data: string }) => any) | null = null;
    readonly sent: string[] = [];

    constructor(readonly url: string) {
        FakeWebSocket.instances.push(this);
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        this.readyState = 3;
        this.onclose?.({});
    }

    openConnection(): void {
        this.readyState = 1;
        this.onopen?.({});
    }

    deliver(chunk: string): void {
        this.onmessage?.({ data: chunk });
    }
}

/**
 * Records every batch it saves, and can be told to fail the next save or the
 * reads that a notification makes.
 */
class RecordingStore implements Storage {
    readonly savedBatches: FactEnvelope[][] = [];
    failReads = false;
    failNextSave = false;

    constructor(private readonly inner: Storage) {}

    close(): Promise<void> {
        return this.inner.close();
    }

    save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        if (this.failNextSave) {
            this.failNextSave = false;
            return Promise.reject(new Error('Store save failed'));
        }
        this.savedBatches.push(envelopes);
        return this.inner.save(envelopes);
    }

    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        if (this.failReads) {
            return Promise.reject(new Error('Store read failed during notification'));
        }
        return this.inner.read(start, specification);
    }

    feed(feed: Specification, start: FactReference[], bookmark: string): Promise<FactFeed> {
        return this.inner.feed(feed, start, bookmark);
    }

    whichExist(references: FactReference[]): Promise<FactReference[]> {
        return this.inner.whichExist(references);
    }

    load(references: FactReference[]): Promise<FactEnvelope[]> {
        return this.inner.load(references);
    }

    purge(purgeConditions: Specification[]): Promise<number> {
        return this.inner.purge(purgeConditions);
    }

    purgeDescendants(purgeRoot: FactReference, triggers: FactReference[]): Promise<number> {
        return this.inner.purgeDescendants(purgeRoot, triggers);
    }

    loadBookmark(feed: string): Promise<string> {
        return this.inner.loadBookmark(feed);
    }

    saveBookmark(feed: string, bookmark: string): Promise<void> {
        return this.inner.saveBookmark(feed, bookmark);
    }

    getMruDate(specificationHash: string): Promise<Date | null> {
        return this.inner.getMruDate(specificationHash);
    }

    setMruDate(specificationHash: string, mruDate: Date): Promise<void> {
        return this.inner.setMruDate(specificationHash, mruDate);
    }
}

const factType = 'Test.Fact';

// Every Test.Fact, projected to nothing. The observer only has to be notified;
// what it holds is immaterial here.
const everyTestFact: Specification = {
    given: [{ label: { name: 'f', type: factType }, conditions: [] }],
    matches: [],
    projection: { type: 'composite', components: [] }
};

function envelopeOf(fields: {}, predecessors: { [role: string]: FactReference } = {}): FactEnvelope {
    const fact: FactRecord = {
        type: factType,
        hash: computeHash(fields, predecessors),
        fields,
        predecessors
    };
    return { fact, signatures: [] };
}

/**
 * The wire text for one fact, written by the serializer the replicator uses,
 * so the test does not carry a second copy of the graph format.
 */
function frameOf(...envelopes: FactEnvelope[]): string {
    let chunk = '';
    new GraphSerializer(part => chunk += part).serialize(envelopes);
    return chunk;
}

/**
 * A BOOK control frame, as the replicator writes it: the keyword, the feed and
 * the bookmark as JSON lines, then a blank terminator.
 */
function bookFrame(feed: string, bookmark: string): string {
    return `BOOK\n${JSON.stringify(feed)}\n${JSON.stringify(bookmark)}\n\n`;
}

/**
 * Let every queued microtask and macrotask run. No wall-clock wait: each cycle
 * is one turn of the event loop, so the reader gets every chance to run ahead
 * of the notification if it is going to.
 */
async function drainTasks(cycles = 20): Promise<void> {
    for (let i = 0; i < cycles; i++) {
        await new Promise<void>(resolve => setImmediate(resolve));
    }
}

function deferred(): { promise: Promise<void>, resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    return { promise, resolve };
}

describe('WebSocket facts-added bridge', () => {
    let originalTracer: Tracer;
    let originalWebSocket: any;
    let store: RecordingStore;
    let factManager: FactManager;
    let network: WsGraphNetwork;
    let unsubscribe: () => void;
    let errors: Error[];
    let notifications: number;
    // Each bookmark the client handed up, with the number of batches the store
    // had saved at that moment. The pair is the invariant under test: a
    // bookmark must never be reported while a frame ahead of it is unsaved.
    let bookmarks: { bookmark: string, savedBatches: number }[];

    beforeEach(() => {
        originalTracer = Trace.getTracer();
        Trace.off();
        originalWebSocket = (globalThis as any).WebSocket;
        (globalThis as any).WebSocket = FakeWebSocket;
        FakeWebSocket.instances = [];
        errors = [];
        notifications = 0;
        bookmarks = [];

        store = new RecordingStore(new MemoryStore());
        const observableSource = new ObservableSource(store);
        factManager = new FactManager(
            new PassThroughFork(store),
            observableSource,
            store,
            new NetworkNoOp(),
            []
        );
        const httpStub: any = {
            feeds: async () => ({ feeds: ['feed1'] }),
            fetchFeed: async () => ({ references: [], bookmark: '' }),
            load: async () => []
        };
        network = new WsGraphNetwork(httpStub, store, 'ws://127.0.0.1:1/');

        // The wiring under test: the same call JinagaBrowser.create makes.
        connectFactsAdded(network, factManager);
    });

    afterEach(() => {
        unsubscribe?.();
        for (const socket of FakeWebSocket.instances) {
            if (socket.readyState !== 3) socket.close();
        }
        (globalThis as any).WebSocket = originalWebSocket;
        Trace.configure(originalTracer);
    });

    async function openSocket(): Promise<FakeWebSocket> {
        unsubscribe = network.streamFeed(
            'feed1',
            '',
            async (_references, nextBookmark) => {
                bookmarks.push({ bookmark: nextBookmark, savedBatches: store.savedBatches.length });
            },
            err => errors.push(err),
            60
        );
        await waitForCondition(() => FakeWebSocket.instances.length > 0);
        const socket = FakeWebSocket.instances[0];
        socket.openConnection();
        await drainTasks(2);
        return socket;
    }

    it('holds the next frame until the previous frame has been notified', async () => {
        const firstNotification = deferred();
        factManager.addSpecificationListener(everyTestFact, async () => {
            notifications++;
            if (notifications === 1) {
                await firstNotification.promise;
            }
        });

        const first = envelopeOf({ n: 1 });
        const second = envelopeOf({ n: 2 });

        const socket = await openSocket();
        socket.deliver(frameOf(first));
        socket.deliver(frameOf(second));

        // The first frame's notification is now running, and holding.
        await waitForCondition(() => notifications === 1);
        await drainTasks();

        expect(store.savedBatches).toHaveLength(1);
        expect(store.savedBatches[0].map(e => e.fact.hash)).toEqual([first.fact.hash]);

        firstNotification.resolve();

        await waitForCondition(() => store.savedBatches.length === 2);
        expect(store.savedBatches[1].map(e => e.fact.hash)).toEqual([second.fact.hash]);
    });

    it('hands a failed notification to the client instead of leaving it unhandled', async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        try {
            factManager.addSpecificationListener(everyTestFact, async () => {
                notifications++;
            });
            // The notification reads the store to project its results, and
            // this read fails. ObservableSource contains a listener's own
            // failure by design (issue #246), so the rejection a bridge has to
            // carry is one raised by the notification itself.
            store.failReads = true;

            const socket = await openSocket();
            socket.deliver(frameOf(envelopeOf({ n: 3 })));

            await waitForCondition(() => errors.length > 0);
            expect(errors[0].message).toContain('Store read failed during notification');
            await drainTasks();
            expect(unhandled).toEqual([]);
        }
        finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });

    it('holds a bookmark until the frames that arrived before it are saved', async () => {
        const firstNotification = deferred();
        factManager.addSpecificationListener(everyTestFact, async () => {
            notifications++;
            if (notifications === 1) {
                await firstNotification.promise;
            }
        });

        const first = envelopeOf({ n: 4 });
        const second = envelopeOf({ n: 5 });

        const socket = await openSocket();
        socket.deliver(frameOf(first));
        socket.deliver(frameOf(second));
        socket.deliver(bookFrame('feed1', 'bm2'));

        // The first frame's notification is now running, and holding.
        await waitForCondition(() => notifications === 1);
        await drainTasks();

        // The second frame is still queued behind that notification, and the
        // BOOK arrived behind the second frame. Reporting the bookmark now
        // would let a replica resubscribe past a frame it never saved.
        expect(store.savedBatches).toHaveLength(1);
        expect(bookmarks).toEqual([]);

        firstNotification.resolve();

        await waitForCondition(() => bookmarks.length > 0);
        expect(bookmarks).toEqual([{ bookmark: 'bm2', savedBatches: 2 }]);
        expect(store.savedBatches.map(batch => batch.map(e => e.fact.hash))).toEqual([
            [first.fact.hash],
            [second.fact.hash]
        ]);
    });

    it('reads on after a failed notification, and advances the bookmark over the frames that follow', async () => {
        factManager.addSpecificationListener(everyTestFact, async () => {
            notifications++;
        });
        // The first frame's notification fails in its own store read, so the
        // facts are saved and only the notification is lost.
        store.failReads = true;

        const first = envelopeOf({ n: 6 });
        const second = envelopeOf({ n: 7 });

        const socket = await openSocket();
        socket.deliver(frameOf(first));

        await waitForCondition(() => errors.length > 0);
        expect(errors[0].message).toContain('Store read failed during notification');

        store.failReads = false;
        socket.deliver(frameOf(second));
        socket.deliver(bookFrame('feed1', 'bm7'));

        await waitForCondition(() => bookmarks.length > 0);

        // Ingestion continued: the second frame was saved and notified, and
        // the bookmark behind it was reported only once it had been.
        expect(store.savedBatches.map(batch => batch.map(e => e.fact.hash))).toEqual([
            [first.fact.hash],
            [second.fact.hash]
        ]);
        expect(notifications).toBe(1);
        expect(bookmarks).toEqual([{ bookmark: 'bm7', savedBatches: 2 }]);
    });
});

/**
 * The same client, built directly so the test can hold its reconnect. The
 * client schedules a reconnect through the function it is given; this one
 * keeps the callback for the test to run when it chooses, so no wall clock is
 * involved.
 */
describe('WebSocket graph client across a reconnect', () => {
    let originalTracer: Tracer;
    let originalWebSocket: any;
    let store: RecordingStore;
    let factManager: FactManager;
    let client: WsGraphClient;
    let unsubscribe: () => void;
    let errors: Error[];
    let notifications: number;
    let bookmarks: { bookmark: string, savedBatches: number }[];
    let pendingReconnects: (() => void)[];

    beforeEach(() => {
        originalTracer = Trace.getTracer();
        Trace.off();
        originalWebSocket = (globalThis as any).WebSocket;
        (globalThis as any).WebSocket = FakeWebSocket;
        FakeWebSocket.instances = [];
        errors = [];
        notifications = 0;
        bookmarks = [];
        pendingReconnects = [];

        store = new RecordingStore(new MemoryStore());
        factManager = new FactManager(
            new PassThroughFork(store),
            new ObservableSource(store),
            store,
            new NetworkNoOp(),
            []
        );
        client = new WsGraphClient(
            async () => 'ws://127.0.0.1:1/',
            store,
            (_feed, bookmark) => {
                bookmarks.push({ bookmark, savedBatches: store.savedBatches.length });
            },
            err => errors.push(err),
            undefined,
            // The browser's bridge, without the network in between.
            envelopes => factManager.notifyFactsAdded(envelopes),
            callback => { pendingReconnects.push(callback); }
        );
    });

    afterEach(() => {
        unsubscribe?.();
        for (const socket of FakeWebSocket.instances) {
            if (socket.readyState !== 3) socket.close();
        }
        (globalThis as any).WebSocket = originalWebSocket;
        Trace.configure(originalTracer);
    });

    async function openFirstSocket(): Promise<FakeWebSocket> {
        unsubscribe = client.subscribe('feed1', '', 60);
        await waitForCondition(() => FakeWebSocket.instances.length === 1);
        const socket = FakeWebSocket.instances[0];
        socket.openConnection();
        await drainTasks(2);
        return socket;
    }

    /**
     * Close the socket, run the reconnect the client scheduled, and open the
     * socket it creates.
     */
    async function reconnect(socket: FakeWebSocket): Promise<FakeWebSocket> {
        const count = FakeWebSocket.instances.length;
        socket.close();
        expect(pendingReconnects).toHaveLength(1);
        pendingReconnects.shift()!();
        await waitForCondition(() => FakeWebSocket.instances.length === count + 1);
        const next = FakeWebSocket.instances[count];
        next.openConnection();
        await drainTasks(2);
        return next;
    }

    it('reads the new socket with a fresh reader, after a notification held across the reconnect', async () => {
        const firstNotification = deferred();
        factManager.addSpecificationListener(everyTestFact, async () => {
            notifications++;
            if (notifications === 1) {
                await firstNotification.promise;
            }
        });

        const old = envelopeOf({ n: 8 });
        const a = envelopeOf({ n: 9 });
        const b = envelopeOf({ n: 10 }, { prior: { type: a.fact.type, hash: a.fact.hash } });

        const first = await openFirstSocket();
        first.deliver(frameOf(old));
        await waitForCondition(() => notifications === 1);

        // The socket drops while the old stream's notification is still held,
        // and the client reconnects. The new socket's stream starts over: its
        // fact indexes count from zero again.
        const second = await reconnect(first);

        // The old stream's notification finishes only now, after the new
        // socket's reader has started.
        firstNotification.resolve();
        await drainTasks();

        second.deliver(frameOf(a, b));
        second.deliver(bookFrame('feed1', 'bm9'));

        await waitForCondition(() => bookmarks.length > 0 || errors.length > 0);

        // B names A by its index in the new stream. Read against the old
        // stream's indexes, it would name the old fact and be saved under a
        // hash that is not B's.
        expect(errors).toEqual([]);
        expect(store.savedBatches.map(batch => batch.map(e => e.fact.hash))).toEqual([
            [old.fact.hash],
            [a.fact.hash],
            [b.fact.hash]
        ]);
        expect(bookmarks).toEqual([{ bookmark: 'bm9', savedBatches: 3 }]);
    });

    it('does not carry frames queued behind a failed save over to the next socket', async () => {
        factManager.addSpecificationListener(everyTestFact, async () => {
            notifications++;
        });

        const lost = envelopeOf({ n: 11 });
        const stale = envelopeOf({ n: 12 });
        const fresh = envelopeOf({ n: 13 });

        const first = await openFirstSocket();
        store.failNextSave = true;
        first.deliver(frameOf(lost));
        await waitForCondition(() => errors.length > 0);
        expect(errors[0].message).toContain('Store save failed');

        // The save failed, so this socket's reader has ended. What arrives
        // behind it waits, and its bookmark must not be applied: it would pass
        // the fact that was never saved.
        first.deliver(frameOf(stale));
        first.deliver(bookFrame('feed1', 'bm-stale'));
        await drainTasks();

        const second = await reconnect(first);
        second.deliver(frameOf(fresh));
        second.deliver(bookFrame('feed1', 'bm-fresh'));

        await waitForCondition(() => bookmarks.length > 0);
        await drainTasks();

        expect(bookmarks).toEqual([{ bookmark: 'bm-fresh', savedBatches: 1 }]);
        expect(store.savedBatches.map(batch => batch.map(e => e.fact.hash))).toEqual([
            [fresh.fact.hash]
        ]);
    });
});
