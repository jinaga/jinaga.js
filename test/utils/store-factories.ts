import { Jinaga, JinagaTest, JinagaTestConfig, MemoryStore, Storage } from "@src";
import { IndexedDBStore } from "../../src/indexeddb/indexeddb-store";

/**
 * Creates a test instance backed by the store the surrounding
 * `describeAcrossStores` block is running against.
 *
 * Always asynchronous, and always routed through `JinagaTest.createAsync`, even
 * for a store whose writes complete synchronously: a suite that reads the
 * initial state cannot know which store it is running against, and `create`
 * refuses the combination of a store factory and initial state precisely
 * because it cannot await the save (issue #274).
 */
export type CreateTestInstance = (config: Omit<JinagaTestConfig, "store">) => Promise<Jinaga>;

interface StoreUnderTest {
    name: string;
    createStore: () => Storage;
    teardown: (store: Storage) => Promise<void>;
}

// Names every IndexedDB database this file's suites have allocated. Jest gives
// each test file its own module registry but can run several files in one
// worker process, and `indexedDB` is per process — so the names are drawn with
// a random component to keep two files apart, and a check on what survives has
// to be made against this list rather than against every database in sight.
const allocatedDatabaseNames: string[] = [];

/**
 * The IndexedDB databases the suites in this file have allocated, in the order
 * they were created. Exposed so `acrossStoresSpec` can check that none of them
 * outlives the file.
 */
export function databasesAllocatedHere(): readonly string[] {
    return allocatedDatabaseNames;
}

function allocateDatabaseName(): string {
    const name = `test-across-stores-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    allocatedDatabaseNames.push(name);
    return name;
}

// One entry per deletion this file has started, each settling when that
// deletion actually finishes — which is later than teardown for a deletion that
// was blocked. `databaseDeletionsSettled` is how a suite waits for all of them.
const deletionsFinished: Promise<void>[] = [];

/**
 * Resolves when every database deletion started by this file's suites has
 * finished, including one that was blocked at teardown and completed later.
 * Rejects if any of them failed.
 *
 * A deletion whose connection never closes leaves this pending, so a suite that
 * awaits it fails on the hook timeout rather than passing over a leak.
 */
export function databaseDeletionsSettled(): Promise<void> {
    return Promise.all(deletionsFinished).then(() => { });
}

function deleteDatabase(name: string): Promise<void> {
    const request = indexedDB.deleteDatabase(name);
    let finish: () => void;
    let fail: (error: unknown) => void;
    const finished = new Promise<void>((resolveFinished, rejectFinished) => {
        finish = resolveFinished;
        fail = rejectFinished;
    });
    // Held so a failure that nothing awaits before `databaseDeletionsSettled`
    // does not surface as an unhandled rejection. The rejection is still there
    // for whoever does await it.
    finished.catch(() => { });
    deletionsFinished.push(finished);

    return new Promise<void>((resolve, reject) => {
        request.onsuccess = () => { finish(); resolve(); };
        request.onerror = () => { fail(request.error); reject(request.error); };
        // Blocked means a connection is still open, and for an observer that
        // is not something the test can wait out: `Observer.start` issues
        // `setMruDate` *after* resolving `loaded()`, so a test that awaits
        // `loaded()` and stops the observer still leaves that write in flight,
        // with no public signal to await. Measured against a store that counts
        // its operations: `["read start", "read end", "setMruDate start"]`,
        // one outstanding, at the moment `stop()` returns.
        //
        // So failing here would report the observer's own tail as a failure of
        // whichever test used `watch`. Resolving does not lose the deletion:
        // the request stays queued and completes when that write closes its
        // connection, which `acrossStoresSpec` asserts at the end of its file.
        // Each store is given a database name of its own, so a deletion still
        // outstanding is unreachable by any later test in the meantime.
        request.onblocked = () => resolve();
    });
}

/**
 * The store implementations a read-semantics suite runs against.
 *
 * `MemoryStore.read` delegates to `SpecificationRunner`, the interpreter that
 * defines the reference semantics; `IndexedDBStore` answers the same reads from
 * its own indexes. Running one suite against both is what turns agreement
 * between them into an assertion rather than an assumption (issue #252).
 */
function storesUnderTest(): StoreUnderTest[] {
    const databaseNames = new Map<Storage, string>();

    return [
        {
            name: "MemoryStore",
            createStore: () => new MemoryStore(),
            teardown: async () => { }
        },
        {
            name: "IndexedDBStore",
            createStore: () => {
                const databaseName = allocateDatabaseName();
                const store = new IndexedDBStore(databaseName);
                databaseNames.set(store, databaseName);
                return store;
            },
            teardown: async store => {
                await store.close();
                const databaseName = databaseNames.get(store);
                if (databaseName) {
                    databaseNames.delete(store);
                    await deleteDatabase(databaseName);
                }
            }
        }
    ];
}

/**
 * Registers a suite once per store implementation, so the same cases assert the
 * same semantics against each one.
 *
 * The suite body receives a `createInstance` function in place of a direct
 * `JinagaTest.create` call. Every instance it creates is backed by a store this
 * block owns, and every such store is released after the test that created it,
 * so no case observes another's writes.
 *
 * ```ts
 * describeAcrossStores("specification query", createInstance => {
 *     let j: Jinaga;
 *     beforeEach(async () => {
 *         j = await createInstance({ initialState: [ ... ] });
 *     });
 *     it("should query for successors", async () => { ... });
 * });
 * ```
 *
 * @param name Names the suite; the store's name is appended to it.
 * @param defineSuite Registers the cases, in a `describe` block of its own.
 */
export function describeAcrossStores(
    name: string,
    defineSuite: (createInstance: CreateTestInstance) => void
): void {
    for (const storeUnderTest of storesUnderTest()) {
        describe(`${name} (${storeUnderTest.name})`, () => {
            const created: Storage[] = [];

            afterEach(async () => {
                // Drained rather than iterated, so a teardown that throws still
                // leaves the list empty for the next test instead of releasing
                // the same store twice.
                while (created.length > 0) {
                    await storeUnderTest.teardown(created.pop()!);
                }
            });

            defineSuite(config => JinagaTest.createAsync({
                ...config,
                store: () => {
                    const store = storeUnderTest.createStore();
                    created.push(store);
                    return store;
                }
            }));
        });
    }
}
