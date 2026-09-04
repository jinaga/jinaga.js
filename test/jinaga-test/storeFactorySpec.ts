import { FactEnvelope, Jinaga, JinagaTest, MemoryStore, Storage, User } from "@src";
import { IndexedDBStore } from "../../src/indexeddb/indexeddb-store";
import { Company, Office, OfficeClosed, OfficeReopened, model } from "../companyModel";

// `JinagaTest.create` used to construct `new MemoryStore()` itself, so the
// specification suites that go through it could only ever exercise one store
// (issue #252, step 2). These cases pin the factory that lifts that
// restriction, and the async entry point a store with asynchronous writes
// needs in order to use it.

function buildInitialState() {
    const creator = new User("--- PUBLIC KEY GOES HERE ---");
    const company = new Company(creator, "TestCo");
    const office = new Office(company, "TestOffice");
    const closedOffice = new Office(company, "ClosedOffice");
    const closed = new OfficeClosed(closedOffice, new Date("2026-01-01T00:00:00.000Z"));
    const reopenedOffice = new Office(company, "ReopenedOffice");
    const reopened = new OfficeReopened(new OfficeClosed(reopenedOffice, new Date("2026-01-01T00:00:00.000Z")));

    return {
        company,
        office,
        reopenedOffice,
        initialState: [
            creator, company, office, closedOffice, closed, reopenedOffice, reopened
        ]
    };
}

// A specification with a nested negative existential, so the comparison below
// exercises more of the read surface than a bare successor join would.
const openOffices = model.given(Company).match((company, facts) =>
    Office.inCompany(facts, company)
);

/**
 * A store whose `save` completes only when the test releases it. Stands in for
 * any implementation that does not apply writes synchronously, without needing
 * one to be present.
 */
class DeferredSaveStore extends MemoryStore {
    private release: (() => void) | undefined;

    save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        return new Promise<void>(resolve => {
            this.release = resolve;
        }).then(() => super.save(envelopes));
    }

    completeSave(): void {
        if (!this.release) {
            throw new Error("`save` has not been called yet.");
        }
        this.release();
    }
}

/**
 * A store whose `save` throws before returning a promise, standing in for any
 * failure that reaches `saveInitialState` synchronously.
 */
class ThrowingSaveStore extends MemoryStore {
    save(): Promise<FactEnvelope[]> {
        throw new Error("save failed synchronously");
    }
}

// Yields to the macrotask queue. Everything already resolvable has resolved by
// the time this returns, so a `createAsync` that failed to await its save would
// have settled. This is a scheduling boundary rather than an arbitrary delay:
// no duration is being guessed at, and lengthening it would not change the
// outcome.
function flushPending(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

describe("JinagaTest store factory", () => {
    it("should default to a MemoryStore when no factory is given", async () => {
        const { company, office, reopenedOffice, initialState } = buildInitialState();
        const j = JinagaTest.create({ initialState });

        const result = await j.query(openOffices, company);
        expect(result.map(o => o.identifier).sort()).toEqual(
            [office, reopenedOffice].map(o => o.identifier).sort());
    });

    it("should back the instance with the store the factory returns", async () => {
        const { company, initialState } = buildInitialState();
        const stores: MemoryStore[] = [];
        const j = JinagaTest.create({
            initialState,
            store: () => {
                const store = new MemoryStore();
                stores.push(store);
                return store;
            }
        });

        // Called once, and the instance reads through that store rather than
        // through one it constructed for itself: the initial state landed in
        // the store the factory handed back.
        expect(stores.length).toBe(1);
        const envelopes = await stores[0].load([
            { type: Company.Type, hash: j.hash(company) }
        ]);
        expect(envelopes.length).toBeGreaterThan(0);

        const viaJinaga = await j.query(openOffices, company);
        expect(viaJinaga.length).toBe(2);
    });

    it("should not resolve createAsync until the initial state is saved", async () => {
        const { company, initialState } = buildInitialState();
        const store = new DeferredSaveStore();

        let settled = false;
        const pending = JinagaTest.createAsync({ initialState, store: () => store })
            .then(j => { settled = true; return j; });

        // The save is still outstanding, so `createAsync` must not have
        // settled. Without the await it would have, and the caller would hold
        // an instance whose store has none of the initial state.
        await flushPending();
        expect(settled).toBe(false);

        store.completeSave();
        const j: Jinaga = await pending;
        expect(settled).toBe(true);

        const result = await j.query(openOffices, company);
        expect(result.length).toBe(2);
    });

    it("should propagate a synchronous save failure out of create", () => {
        const { initialState } = buildInitialState();

        // `create` does not await `saveInitialState`, so making that method
        // `async` would convert this throw into a rejected promise that
        // `create` drops — an unhandled rejection in place of a failure the
        // caller can see. The same conversion would swallow a throw from
        // `dehydrate` on malformed initial state, which is the default
        // MemoryStore path rather than an edge of the new factory.
        expect(() => JinagaTest.create({
            initialState,
            store: () => new ThrowingSaveStore()
        })).toThrow("save failed synchronously");
    });

    it("should reject createAsync when the save fails synchronously", async () => {
        const { initialState } = buildInitialState();

        // The same failure through the async entry point is a rejection, not a
        // synchronous throw: `createAsync` awaits the save.
        await expect(JinagaTest.createAsync({
            initialState,
            store: () => new ThrowingSaveStore()
        })).rejects.toThrow("save failed synchronously");
    });

    it("should agree with MemoryStore when backed by IndexedDBStore", async () => {
        const { company, initialState } = buildInitialState();

        const memoryResult = await JinagaTest.create({ initialState })
            .query(openOffices, company);

        const dbName = `test-jinaga-test-store-factory-${Date.now()}-${Math.random()}`;
        let store: Storage | undefined;
        try {
            // `createAsync`, not `create`: IndexedDBStore's writes complete
            // asynchronously, so the initial state is not readable until the
            // save has been awaited.
            const j = await JinagaTest.createAsync({
                initialState,
                store: () => {
                    store = new IndexedDBStore(dbName);
                    return store;
                }
            });

            const indexedDbResult = await j.query(openOffices, company);
            expect(indexedDbResult.map(o => o.identifier).sort())
                .toEqual(memoryResult.map(o => o.identifier).sort());
            expect(indexedDbResult.length).toBe(2);
        }
        finally {
            if (store) {
                await store.close();
            }
            const deleteRequest = indexedDB.deleteDatabase(dbName);
            await new Promise((resolve, reject) => {
                deleteRequest.onsuccess = () => resolve(undefined);
                deleteRequest.onerror = () => reject(deleteRequest.error);
                deleteRequest.onblocked = () => reject(new Error("Database deletion blocked"));
            });
        }
    });
});
