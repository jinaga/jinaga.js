import { Dehydration, dehydrateReference, HashMap } from "../../src/fact/hydrate";
import { IndexedDBStore } from "../../src/indexeddb/indexeddb-store";
import { MemoryStore } from "../../src/memory/memory-store";
import { Specification } from "../../src/specification/specification";
import { SpecificationParser } from "../../src/specification/specification-parser";
import { FactEnvelope, Storage } from "../../src/storage";

// Reading a fact the store does not hold, at the level of `Storage` rather than
// through `Jinaga`. Both divergences fixed here were found by running one
// read-semantics suite against both stores (issue #252), and both are invisible
// to a suite that only ever runs against `MemoryStore`.

const isIndexedDBAvailable = typeof indexedDB !== "undefined";
const describeFunc = isIndexedDBAvailable ? describe : describe.skip;

function parse(specificationText: string): Specification {
    const parser = new SpecificationParser(specificationText);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

function buildFixture() {
    const creator: HashMap = {
        type: "Jinaga.User",
        publicKey: "--- PUBLIC KEY GOES HERE ---"
    };
    const company: HashMap = {
        type: "Company",
        creator,
        identifier: "TestCo"
    };
    const office: HashMap = {
        type: "Office",
        company,
        identifier: "TestOffice"
    };
    const unsavedCompany: HashMap = {
        type: "Company",
        creator,
        identifier: "UnsavedCo"
    };

    const dehydration = new Dehydration();
    for (const fact of [creator, company, office]) {
        dehydration.dehydrate(fact);
    }
    const envelopes = dehydration.factRecords().map(fact => <FactEnvelope>({
        fact,
        signatures: []
    }));

    return { company, unsavedCompany, envelopes };
}

const officesOfCompany = parse(`
    (company: Company) {
        office: Office [
            office->company: Company = company
        ]
    } => office
`);

const companyItself = parse(`
    (company: Company) {
    } => company
`);

describeFunc("IndexedDBStore read", () => {
    let store: IndexedDBStore;
    let databaseName: string;
    let fixture: ReturnType<typeof buildFixture>;

    beforeEach(async () => {
        databaseName = `test-indexeddb-read-${Date.now()}-${Math.random()}`;
        store = new IndexedDBStore(databaseName);
        fixture = buildFixture();
        await store.save(fixture.envelopes);
    });

    afterEach(async () => {
        await store.close();
        const request = indexedDB.deleteDatabase(databaseName);
        await new Promise<void>((resolve, reject) => {
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error("Database deletion blocked"));
        });
    });

    it("returns no results for a given it does not hold", async () => {
        // `findFact` used to answer `undefined` here rather than `null`, so the
        // runner's short circuit for an absent given never fired. The read then
        // carried on to project the given itself, and `hydrate` failed with a
        // TypeError on the ancestor entry that a fact it does not hold has not
        // got. The successor query does not reach that far, so it takes both
        // specifications to show the difference.
        const start = [dehydrateReference(fixture.unsavedCompany)];

        expect(await store.read(start, officesOfCompany)).toEqual([]);
        expect(await store.read(start, companyItself)).toEqual([]);
    });

    it("agrees with MemoryStore on a given it does not hold", async () => {
        const memoryStore: Storage = new MemoryStore();
        await memoryStore.save(fixture.envelopes);
        const start = [dehydrateReference(fixture.unsavedCompany)];

        // The interpreter is the reference semantics, so agreement with it is
        // the assertion — not merely that the read did not throw.
        for (const specification of [officesOfCompany, companyItself]) {
            expect(await store.read(start, specification))
                .toEqual(await memoryStore.read(start, specification));
        }
    });

    it("closes the database when a read fails", async () => {
        // A read that fails used to leave the connection open, because the
        // close came after the awaited action rather than in a `finally`. The
        // next attempt to delete or upgrade the database then blocked on it, so
        // one failing read took the database down for everything after it.
        await expect(store.read([], officesOfCompany)).rejects.toThrow();

        const request = indexedDB.deleteDatabase(databaseName);
        const outcome = await new Promise<string>((resolve, reject) => {
            request.onsuccess = () => resolve("deleted");
            request.onerror = () => reject(request.error);
            // Reported rather than awaited: a blocked deletion never completes
            // while the connection is open, so waiting for it would hang.
            request.onblocked = () => resolve("blocked");
        });

        expect(outcome).toBe("deleted");
    });
});
