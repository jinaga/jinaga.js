import { FactEnvelope, Jinaga, JinagaTest, MemoryStore, Storage, Trace, Tracer, User } from "@src";
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

/**
 * A store whose `save` rejects, standing in for one that cannot reach its
 * backing medium — an aborted IndexedDB transaction, a SQL connection that
 * cannot be opened.
 */
class RejectingSaveStore extends MemoryStore {
    save(): Promise<FactEnvelope[]> {
        return Promise.reject(new Error("save failed asynchronously"));
    }
}

/**
 * Captures what `Trace.error` is handed. Restores the default tracer on
 * `stop`, so a failing assertion cannot leave tracing configured for the rest
 * of the suite.
 */
function captureTraceErrors() {
    const errors: any[] = [];
    const tracer: Tracer = {
        info: () => { },
        warn: () => { },
        error: error => { errors.push(error); },
        dependency: (name, data, operation) => operation(),
        metric: () => { },
        counter: () => { }
    };
    Trace.configure(tracer);
    return {
        errors,
        stop: () => Trace.off()
    };
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
        // `createAsync`, not `create`: a supplied store carrying initial state
        // goes through the entry point that awaits the save (issue #274).
        const j = await JinagaTest.createAsync({
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

    it("should propagate a synchronous throw out of create", () => {
        // `create` does not await `saveInitialState`, so making that method
        // `async` would convert this throw into a rejected promise that
        // `create` drops — an unhandled rejection in place of a failure the
        // caller can see. This is the default MemoryStore path, not an edge of
        // the store factory: `dehydrate` rejects the malformed fact before any
        // store is touched.
        expect(() => JinagaTest.create({
            initialState: [{ identifier: "no type here" }]
        })).toThrow("Specify the type of the fact and all of its predecessors.");
    });

    it("should refuse initial state through create when a store is supplied", () => {
        const { initialState } = buildInitialState();

        // `create` cannot await the save, so a supplied store carrying initial
        // state is a misuse: an asynchronous writer returns an instance that
        // does not hold the state yet, and a failed save is detached from this
        // call site (issue #274). Refuse it here rather than downstream.
        expect(() => JinagaTest.create({
            initialState,
            store: () => new MemoryStore()
        })).toThrow(/createAsync/);
    });

    it("should still honour the factory in create when there is no initial state", () => {
        const stores: MemoryStore[] = [];
        const j = JinagaTest.create({
            store: () => {
                const store = new MemoryStore();
                stores.push(store);
                return store;
            }
        });

        // Nothing to save, so nothing to await: `create` remains available for
        // a suite that seeds its facts through the instance.
        expect(stores.length).toBe(1);
        expect(j).toBeInstanceOf(Jinaga);
    });

    it("should trace an asynchronous save failure in create rather than dropping it", async () => {
        // An empty `initialState` still reaches `store.save`, and it is the one
        // combination the refusal above lets through with a supplied store. The
        // rejection has nowhere to be reported to — `create` has already
        // returned — so it must at least reach `Trace` instead of surfacing as
        // an unhandled rejection in an unrelated test (issue #274).
        const trace = captureTraceErrors();
        try {
            JinagaTest.create({
                initialState: [],
                store: () => new RejectingSaveStore()
            });

            await flushPending();
            expect(trace.errors.length).toBe(1);
            expect(trace.errors[0].message).toBe("save failed asynchronously");
        }
        finally {
            trace.stop();
        }
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
