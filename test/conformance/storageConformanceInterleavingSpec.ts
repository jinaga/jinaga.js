import { MemoryStore } from "@src";
import { runInterleavingCase } from "../../src/conformance/storage-conformance";
import { describeStorageConformance } from "../../src/conformance";
import { Specification } from "../../src/specification/specification";
import { FactEnvelope, FactFeed, FactReference, ProjectedResult, Storage } from "../../src/storage";

// The interleaving case pins what a read may return while a save lands during
// it. `MemoryStore` is the only store this repository can run the kit against,
// and it reserves its snapshot synchronously, so it demonstrates one answer and
// nothing about the boundary. These two stores sit on either side of it: one
// returns the later graph, which the kit must accept, and one returns a mixture
// of both, which the kit must reject.

/**
 * Delegates every member of `Storage` to an inner store, so that each store
 * below overrides only `read`. Written here rather than shared, as
 * `DelegatingStore` is in `test/authorization/batchAuthorizationSpec.ts`.
 */
class DelegatingStore implements Storage {
    constructor(
        protected readonly inner: Storage
    ) { }

    close(): Promise<void> {
        return this.inner.close();
    }

    save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        return this.inner.save(envelopes);
    }

    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
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

/**
 * Resumes once every pending microtask has run.
 *
 * The interleaving case walks its concurrent save across a range of microtask
 * yields. Microtasks queued while microtasks are draining run before the next
 * macrotask does, so a store that waits for this boundary resumes after the
 * case's whole yield loop and after the `save` that follows it, whichever
 * yield count the case is on. Each store below therefore behaves the same way
 * on all forty-one iterations instead of depending on where a yield fell.
 *
 * This is not an arbitrary timeout. `setImmediate` is a macrotask boundary, and
 * the boundary is the thing being waited for, so there is no interval to choose
 * and nothing to tune.
 */
function afterPendingMicrotasks(): Promise<void> {
    return new Promise<void>(resolve => setImmediate(resolve));
}

/**
 * Takes its graph after an await rather than at the instant of the call.
 *
 * That is the shape of a store which has to acquire a pooled connection before
 * its first statement, as `PostgresStore` does. A save issued after the read
 * begins commits first, so the read answers from the graph after the save. That
 * graph is one of the two the call is concurrent with, so the kit accepts it.
 */
class LateSnapshotStore extends DelegatingStore {
    constructor() {
        super(new MemoryStore());
    }

    async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        await afterPendingMicrotasks();
        return super.read(start, specification);
    }
}

/**
 * Answers one read from two graphs: `a` from the graph at the instant of the
 * call and `b` from the graph after the concurrent save. Its rows belong to
 * neither graph, which is the hazard of issue #346.
 *
 * The mixture is fixed by which graph answers which label, not by where a
 * microtask lands, so it is the same on every iteration. It answers the
 * interleaving specification and nothing else, which is why it is only ever
 * handed to `runInterleavingCase` rather than registered as a suite.
 */
class MixingStore extends DelegatingStore {
    private readonly saved: FactEnvelope[] = [];

    /**
     * The rows each read returned, so a test can assert on the mixture itself
     * rather than on how a runner formats a failure.
     */
    readonly rowsReturned: string[][] = [];

    constructor() {
        super(new MemoryStore());
    }

    save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        this.saved.push(...envelopes);
        return super.save(envelopes);
    }

    async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        // Captured before the first await, so it names the graph the call
        // found rather than one a later save has moved.
        const atCall = [ ...this.saved ];
        await afterPendingMicrotasks();

        const before = new MemoryStore();
        await before.save(atCall);
        const earlyRows = await before.read(start, specification);
        const lateRows = await super.read(start, specification);

        // Rows of the later graph whose `a` the earlier graph also held: `a`
        // from the one, `b` from the other. The specification's given scopes
        // both reads to a single root, so one iteration's identifiers never
        // reach another's.
        const aAtCall = new Set<string>(earlyRows.map(r => r.result.a.identifier));
        const mixed = lateRows.filter(r => aAtCall.has(r.result.a.identifier));
        this.rowsReturned.push(mixed.map(r => `${r.result.a.identifier} ${r.result.b.identifier}`));
        return mixed;
    }
}

// A store that returns the later graph passes the whole kit, the interleaving
// case included. Before issue #423 this case failed, on all forty-one
// iterations, with the four rows of the final graph against the one row of the
// initial graph.
describeStorageConformance("late-snapshot store", () => new LateSnapshotStore());

describe("storage conformance: the interleaving case", () => {
    it("rejects a read answered partly from one graph and partly from the next", async () => {
        const store = new MixingStore();

        const error = await runInterleavingCase(store).then(() => null, (e: Error) => e);

        // The store returned `A1` from the graph at the call and both `B`s from
        // the graph after the save. Two rows, belonging to neither graph.
        expect(store.rowsReturned[0]).toEqual([ "A1 B1", "A1 B2" ]);
        // So the case has to reject it. Accepting either graph did not cost the
        // kit the teeth it has for a mixture.
        expect(error).not.toBeNull();
    });
});
