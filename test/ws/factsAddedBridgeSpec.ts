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
 * Records every batch handed to `save`, and can be told to fail the reads that
 * a notification makes.
 */
class RecordingStore implements Storage {
    readonly savedBatches: FactEnvelope[][] = [];
    failReads = false;

    constructor(private readonly inner: Storage) {}

    close(): Promise<void> {
        return this.inner.close();
    }

    save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
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

function envelopeOf(fields: {}): FactEnvelope {
    const predecessors = {};
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
function frameOf(envelope: FactEnvelope): string {
    let chunk = '';
    new GraphSerializer(part => chunk += part).serialize([envelope]);
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
