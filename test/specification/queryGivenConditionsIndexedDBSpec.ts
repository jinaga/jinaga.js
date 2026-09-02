import { describeStorageConformance } from "../../src/conformance";
import { IndexedDBStore } from "../../src/indexeddb/indexeddb-store";

const isIndexedDBAvailable = typeof indexedDB !== 'undefined';

if (isIndexedDBAvailable) {
    // Each test gets its own database, so nothing survives from the previous one.
    let dbName: string;

    describeStorageConformance("IndexedDBStore", () => {
        dbName = `test-storage-conformance-${Date.now()}-${Math.random()}`;
        return new IndexedDBStore(dbName);
    }, async store => {
        await store.close();
        const deleteRequest = indexedDB.deleteDatabase(dbName);
        await new Promise((resolve, reject) => {
            deleteRequest.onsuccess = () => resolve(undefined);
            deleteRequest.onerror = () => reject(deleteRequest.error);
            deleteRequest.onblocked = () => reject(new Error('Database deletion blocked'));
        });
    });
}
else {
    describe.skip("storage conformance: IndexedDBStore", () => {
        it("requires an indexedDB implementation", () => { /* not reached */ });
    });
}
