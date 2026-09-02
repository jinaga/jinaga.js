import { MemoryStore } from "@src";
import { describeStorageConformance } from "../../src/conformance";
import { Storage } from "../../src/storage";

// The kit promises each test a store built by `createStore` and containing only
// the fixture graph, then released by `teardown`. An implementation trusts that
// promise: a kit that quietly reused one store across tests would let a store
// pass on state left behind by an earlier case. These counters pin the promise.
//
// The counters are checked in a file-level `afterAll` rather than in an `it`.
// An `it` in a later sibling `describe` would only observe a finished suite
// because Jest happens to run top-level blocks in source order, and that
// ordering is scheduling behaviour rather than a contract. `afterAll` runs
// after every test in the file by definition, so the check does not depend on
// it.

const createdStores: Storage[] = [];
const releasedStores: Storage[] = [];

describeStorageConformance("MemoryStore (kit self-test)", () => {
    const store = new MemoryStore();
    createdStores.push(store);
    return store;
}, store => {
    releasedStores.push(store);
});

// `teardown` is optional, for a store with no resources to release. Registering
// and running the suite without one must work; these cases passing is the proof.
describeStorageConformance("MemoryStore (no teardown)", () => new MemoryStore());

afterAll(() => {
    // The suite registered more than one case, and each one got its own store.
    expect(createdStores.length).toBeGreaterThan(1);

    // Never the same instance twice, so no test can observe another's writes.
    const distinct = new Set(createdStores);
    expect(distinct.size).toBe(createdStores.length);

    // Every store created was released, and it was the one that was released.
    expect(releasedStores).toEqual(createdStores);
});
