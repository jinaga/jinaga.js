/**
 * Tests for the bug: observer.loaded() never settles when a subscriber
 * connection error occurs or when observer.stop() is called while the
 * subscription is pending.
 *
 * Hypotheses (ranked by likelihood):
 *
 * H1 (HIGH): ObserverImpl.stop() does not settle loadedPromise.
 *   - loadReject is a local variable inside the Promise constructor; stop() has no reference to it.
 *   - Experiment: call stop() while fetch is pending; assert loaded() rejects promptly.
 *
 * H2 (HIGH): Subscriber.stop() does not settle the Promise from start().
 *   - The reject callback from new Promise() is never stored on the Subscriber instance.
 *   - Experiment: call subscriber.stop() while start() is awaiting; assert start() rejects.
 *
 * H3 (MEDIUM): After a late-resolving fetch(), this.feeds is populated but never
 *   unsubscribed when stop() was already called before fetch() returned.
 *   - Experiment: stop() before fetch returns; verify subscriber is eventually cleaned up.
 */

import {
    buildModel,
    FactEnvelope,
    FactManager,
    FactReference,
    FeedResponse,
    MemoryStore,
    Network,
    NetworkNoOp,
    ObservableSource,
    PassThroughFork,
    Specification,
    Subscriber,
} from "@src";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A Network whose streamFeed appears to hang briefly, then delivers an empty
 *  response after a short delay. This simulates a slow connection while still
 *  allowing the subscriber's internal timers to be cleaned up, avoiding open
 *  handles in tests.
 *
 *  The cleanup function returned by streamFeed cancels the pending response if
 *  stop() is called before the delay fires (e.g. via subscriber.stop()).
 */
class HangingNetwork implements Network {
    feeds(_start: FactReference[], _spec: Specification): Promise<string[]> {
        // Return one synthetic feed so subscribe() actually creates a Subscriber.
        return Promise.resolve(["test-feed"]);
    }

    fetchFeed(_feed: string, bookmark: string): Promise<FeedResponse> {
        return Promise.resolve({ references: [], bookmark });
    }

    streamFeed(
        _feed: string,
        bookmark: string,
        onResponse: (refs: FactReference[], next: string) => Promise<void>,
        _onError: (err: Error) => void,
        _interval: number
    ): () => void {
        // Deliver an empty response after a short delay so the subscriber's
        // start() promise eventually resolves and its setInterval is cleaned up.
        let cancelled = false;
        const timeoutId = setTimeout(() => {
            if (!cancelled) {
                onResponse([], bookmark);
            }
        }, 100);
        return () => {
            cancelled = true;
            clearTimeout(timeoutId);
        };
    }

    load(_refs: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve([]);
    }
}

/** Builds a FactManager wired to the given network, sharing a MemoryStore. */
function makeFactManager(store: MemoryStore, network: Network): FactManager {
    const observableSource = new ObservableSource(store);
    const fork = new PassThroughFork(store);
    return new FactManager(fork, observableSource, store, network, [], 90);
}

/**
 * Race a promise against a short timeout, cancelling the timer when done.
 * Returns the promise's value, or `fallback` if the timeout fires first.
 */
function raceWithTimeout<T>(promise: Promise<T>, fallback: T, ms: number): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;
    return Promise.race([
        promise,
        new Promise<T>(res => { timeoutId = setTimeout(() => res(fallback), ms); })
    ]).finally(() => clearTimeout(timeoutId));
}

/**
 * Race loaded() against a short timeout. Returns 'settled' or 'timed-out'.
 * The timeout is always cancelled after the race resolves to avoid open handles.
 */
function raceLoaded(
    loadedPromise: Promise<void>,
    ms = 500
): Promise<"settled" | "timed-out"> {
    return raceWithTimeout(
        loadedPromise.then(() => "settled" as const, () => "settled" as const),
        "timed-out" as const,
        ms
    );
}

// ---------------------------------------------------------------------------
// Simple fact model for test subscriptions
// ---------------------------------------------------------------------------

class TestRoot {
    static Type = "Test.Root" as const;
    type = TestRoot.Type;
    constructor(public identifier: string) {}
}

class TestItem {
    static Type = "Test.Item" as const;
    type = TestItem.Type;
    constructor(public root: TestRoot, public name: string) {}
}

const testModel = buildModel(b => b
    .type(TestRoot)
    .type(TestItem, m => m.predecessor("root", TestRoot))
);

const itemsSpec = testModel.given(TestRoot).match((root, facts) =>
    facts.ofType(TestItem).join(item => item.root, root)
);

const GIVEN = [{ type: TestRoot.Type, hash: "fake-hash-abc123" }];

// ---------------------------------------------------------------------------
// H2: Subscriber.stop() should settle the pending start() promise
// ---------------------------------------------------------------------------

describe("H2 — Subscriber.stop() settles the pending start() promise", () => {
    it("start() promise should reject when stop() is called while waiting for the first connection", async () => {
        // Arrange: a network that never responds
        const store = new MemoryStore();
        const network = new HangingNetwork();
        const subscriber = new Subscriber(
            "test-feed",
            network,
            store,
            async () => {},
            90 // refreshIntervalSeconds
        );

        // Act: start() hangs; stop() should unblock it
        let startSettled = false;
        const startPromise = subscriber.start().then(
            () => { startSettled = true; },
            () => { startSettled = true; }
        );

        // Give start() a moment to enter the pending state
        await new Promise(res => setTimeout(res, 10));
        expect(startSettled).toBe(false); // confirms the test is in the bug scenario

        subscriber.stop();

        // Assert: start() must settle within a short time after stop()
        const outcome = await Promise.race([
            startPromise.then(() => "settled"),
            new Promise<string>(res => setTimeout(() => res("timed-out"), 500))
        ]);

        expect(outcome).toBe("settled"); // H2 confirmed broken if "timed-out"
    });
});

// ---------------------------------------------------------------------------
// H1: ObserverImpl.stop() should settle loaded() — cold-cache path
// ---------------------------------------------------------------------------

describe("H1 — ObserverImpl.stop() settles loaded() in the cold-cache path", () => {
    it("loaded() should settle when stop() is called before the first connection completes", async () => {
        const store = new MemoryStore();
        // HangingNetwork: feeds() returns a feed, streamFeed never resolves
        const factManager = makeFactManager(store, new HangingNetwork());

        const observer = factManager.startObserver(
            GIVEN,
            itemsSpec.specification,
            () => {},
            true // keepAlive=true → subscribe (streaming) path
        );

        // Give the async start() a moment to reach the hanging fetch()
        await new Promise(res => setTimeout(res, 20));

        // Act: stop() while loaded() is still pending
        observer.stop();

        // Assert: loaded() must settle within a short time
        const result = await raceLoaded(observer.loaded());
        expect(result).toBe("settled");
    });
});

// ---------------------------------------------------------------------------
// H1: ObserverImpl.stop() should settle loaded() — warm-cache path
//
// Warm-cache means getMruDate() returns a non-null date, so start() does:
//   read() → cacheResolve(true) → fetch() [hangs] → loadResolve() [never reached]
//
// Phase 1: prime the MRU date by running a successful observer with NetworkNoOp
//          (NetworkNoOp.feeds() returns [], so subscribe() returns [] immediately,
//           loaded() resolves, and setMruDate() is called for this spec hash).
// Phase 2: run a new observer on the same store with HangingNetwork.
//          cached() should now resolve to true; loaded() should hang until stop().
// ---------------------------------------------------------------------------

describe("H1 — ObserverImpl.stop() settles loaded() in the warm-cache path", () => {
    it("loaded() should settle when stop() is called after cached() resolves but before fetch completes", async () => {
        const store = new MemoryStore();

        // --- Phase 1: cold start with NetworkNoOp to prime the MRU cache ---
        // NetworkNoOp.feeds() returns [], so subscribe() finds no feeds and
        // resolves immediately — loaded() settles and setMruDate() is called.
        const factManager1 = makeFactManager(store, new NetworkNoOp());
        const observer1 = factManager1.startObserver(
            GIVEN, itemsSpec.specification, () => {}, true
        );
        await observer1.loaded(); // resolves fast; primes MRU date in store
        observer1.stop();

        // --- Phase 2: warm-cache observer with HangingNetwork ---
        const factManager2 = makeFactManager(store, new HangingNetwork());
        const observer2 = factManager2.startObserver(
            GIVEN, itemsSpec.specification, () => {}, true
        );

        // cached() should resolve to true — MRU date was set in phase 1
        const cacheResult = await raceWithTimeout(observer2.cached(), false, 1000);
        expect(cacheResult).toBe(true); // confirms warm-cache path is active

        // loaded() is still pending (fetch is hanging)
        const immediateResult = await raceLoaded(observer2.loaded(), 30);
        expect(immediateResult).toBe("timed-out"); // confirms loaded() was pending

        // Act: stop the observer
        observer2.stop();

        // Assert: loaded() must now settle
        const result = await raceLoaded(observer2.loaded());
        expect(result).toBe("settled");
    });
});

// ---------------------------------------------------------------------------
// H1 variant: stop() called immediately (before start() async work runs)
// ---------------------------------------------------------------------------

describe("H1 — ObserverImpl.stop() settles loaded() when called immediately", () => {
    it("loaded() should settle even if stop() is called synchronously after startObserver", async () => {
        const store = new MemoryStore();
        const factManager = makeFactManager(store, new HangingNetwork());

        const observer = factManager.startObserver(
            GIVEN, itemsSpec.specification, () => {}, true
        );

        // Stop immediately — before any async work in start() has a chance to run
        observer.stop();

        const result = await raceLoaded(observer.loaded());
        expect(result).toBe("settled");
    });
});
