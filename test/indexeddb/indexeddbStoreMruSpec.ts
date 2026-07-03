import { IndexedDBStore } from "../../src/indexeddb/indexeddb-store";

const isIndexedDBAvailable = typeof indexedDB !== "undefined";
const describeFunc = isIndexedDBAvailable ? describe : describe.skip;

describeFunc("IndexedDBStore MRU cleanup", () => {
  let store: IndexedDBStore;
  let dbName: string;

  beforeEach(() => {
    dbName = `test-indexeddb-mru-${Date.now()}-${Math.random()}`;
    store = new IndexedDBStore(dbName);
  });

  afterEach(async () => {
    await store.close();

    const deleteRequest = indexedDB.deleteDatabase(dbName);
    await new Promise<void>((resolve, reject) => {
      deleteRequest.onsuccess = _ => resolve();
      deleteRequest.onerror = _ => reject(deleteRequest.error);
      deleteRequest.onblocked = _ => reject(new Error("Database deletion blocked"));
    });
  });

  it("should remove specifications not used in 30 days", async () => {
    const now = new Date("2026-07-01T00:00:00.000Z");
    const staleDate = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 40);

    await store.setMruDate("specA", staleDate);
    await store.setMruDate("specB", now);

    expect(await store.getMruDate("specA")).toBeNull();
    expect(await store.getMruDate("specB")).toEqual(now);
  });

  it("should keep specifications used within 30 days", async () => {
    const now = new Date("2026-07-01T00:00:00.000Z");
    const recentDate = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10);

    await store.setMruDate("specRecent", recentDate);
    await store.setMruDate("specCurrent", now);

    expect(await store.getMruDate("specRecent")).toEqual(recentDate);
    expect(await store.getMruDate("specCurrent")).toEqual(now);
  });
});
