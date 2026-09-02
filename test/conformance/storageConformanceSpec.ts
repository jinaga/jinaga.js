import { MemoryStore } from "@src";
import { describeStorageConformance } from "../../src/conformance";
import { Storage } from "../../src/storage";

// The kit promises each test a store built by `createStore` and containing only
// the fixture graph, then released by `teardown`. An implementation trusts that
// promise: a kit that quietly reused one store across tests would let a store
// pass on state left behind by an earlier case. These counters pin the promise.
//
// Jest registers `describe` bodies in source order and runs them in that same
// order, so the assertions below observe the counters after the suite above has
// finished. No timing dependency is involved.

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

describe("storage conformance kit", () => {
    it("builds one store per test and releases each one", () => {
        // The suite above registered more than one case.
        expect(createdStores.length).toBeGreaterThan(1);
        expect(releasedStores.length).toBe(createdStores.length);
    });

    it("never hands the same store to two tests", () => {
        const distinct = new Set(createdStores);
        expect(distinct.size).toBe(createdStores.length);
    });

    it("releases the same store instance it created", () => {
        expect(releasedStores).toEqual(createdStores);
    });
});
