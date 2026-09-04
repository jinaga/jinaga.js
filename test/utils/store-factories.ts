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

let databaseCount = 0;

function deleteDatabase(name: string): Promise<void> {
    const request = indexedDB.deleteDatabase(name);
    return new Promise<void>((resolve, reject) => {
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        // A test that leaves an observer running — `watch` without awaiting
        // `loaded()` — still has a connection open when its store is released,
        // and the deletion blocks on it. Waiting for that connection would hang
        // the run, and failing would report a teardown detail as a test
        // failure. Each store here is given a database name of its own, so one
        // left undeleted is unreachable by any later test either way; the
        // deletion stays queued and completes when the connection closes.
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
                const databaseName = `test-across-stores-${process.pid}-${databaseCount++}`;
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
