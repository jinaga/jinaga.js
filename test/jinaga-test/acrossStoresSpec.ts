import { Jinaga, User } from "@src";
import { Company, Office, model } from "../companyModel";
import { databaseDeletionsSettled, databasesAllocatedHere, describeAcrossStores } from "../utils/store-factories";

// `describeAcrossStores` is what lifts a read-semantics suite off the
// `MemoryStore` that `JinagaTest.create` used to construct for itself (issue
// #252, step 3). These cases pin what it promises the suites that use it: the
// cases run once per store, each one gets a store of its own, and the databases
// those stores allocate are released.

const officesInCompany = model.given(Company).match((company, facts) =>
    facts.ofType(Office)
        .join(office => office.company, company)
);

function buildInitialState() {
    const creator = new User("--- PUBLIC KEY GOES HERE ---");
    const company = new Company(creator, "TestCo");
    const office = new Office(company, "TestOffice");
    return { creator, company, office, initialState: [creator, company, office] };
}

// Collected from `expect.getState().currentTestName`, which carries the
// enclosing `describe` name and so names the store each run was registered for.
const runsByCase = new Map<string, string[]>();

function recordRun(caseName: string) {
    const suiteName = expect.getState().currentTestName ?? "";
    const runs = runsByCase.get(caseName) ?? [];
    runs.push(suiteName);
    runsByCase.set(caseName, runs);
}

describeAcrossStores("describeAcrossStores", (createInstance) => {
    it("backs the instance with a store that holds the initial state", async () => {
        recordRun("holds the initial state");
        const { company, office, initialState } = buildInitialState();

        const j: Jinaga = await createInstance({ initialState });

        // Read back rather than merely constructed: for a store whose writes
        // complete asynchronously this passes only because the helper routes
        // through `createAsync` and awaits the save.
        const result = await j.query(officesInCompany, company);
        expect(result.map(o => o.identifier)).toEqual([office.identifier]);
    });

    it("leaves a fact written by one case invisible to the next", async () => {
        recordRun("first of the isolation pair");
        const { company, initialState } = buildInitialState();

        const j = await createInstance({ initialState });
        await j.fact(new Office(company, "LeakedOffice"));

        const result = await j.query(officesInCompany, company);
        expect(result.map(o => o.identifier).sort()).toEqual(["LeakedOffice", "TestOffice"]);
    });

    it("starts from a store that holds only its own initial state", async () => {
        recordRun("second of the isolation pair");
        const { company, initialState } = buildInitialState();

        // Same fixture as the case above, which wrote one more office into the
        // store it was given. A helper that shared one store between cases
        // would show that office here.
        const j = await createInstance({ initialState });

        const result = await j.query(officesInCompany, company);
        expect(result.map(o => o.identifier)).toEqual(["TestOffice"]);
    });

    it("releases the store of a test that ends with an observer's tail in flight", async () => {
        recordRun("observer tail");
        const { company, initialState } = buildInitialState();

        const j = await createInstance({ initialState });
        const observed: string[] = [];
        const observer = j.watch(officesInCompany, company, office => {
            observed.push(office.identifier);
        });

        await observer.loaded();
        observer.stop();
        expect(observed).toEqual(["TestOffice"]);

        // `Observer.start` issues `setMruDate` after resolving `loaded()`, so
        // this test ends with a write still in flight and nothing to await it
        // by. The store is released anyway, and the `afterAll` below is where
        // that release is checked: the deletion its teardown could not
        // complete is still queued, and completes when the write does.
    });
});

afterAll(async () => {
    // Every case ran once per store, and the store is named in the suite it ran
    // under. A helper that registered only the default store would leave one
    // run per case.
    for (const [caseName, runs] of runsByCase) {
        expect(runs.length).toBeGreaterThan(1);
        expect(runs.filter(name => name.includes("MemoryStore")).length).toBe(1);
        expect(runs.filter(name => name.includes("IndexedDBStore")).length).toBe(1);
        expect(caseName).toBeTruthy();
    }
    expect(runsByCase.size).toBe(4);

    // Every database this file's runs allocated is gone: the ones teardown
    // deleted outright, and the one whose deletion was blocked by the observer
    // tail above and completed when that write closed its connection. A helper
    // that dropped its stores on the floor would leave one per case.
    //
    // Checked against the names this file allocated rather than against every
    // database present, because Jest can run several test files in one worker
    // process and `indexedDB` is shared across them.
    const allocated = new Set(databasesAllocatedHere());
    expect(allocated.size).toBeGreaterThan(0);

    // Awaited rather than assumed: a deletion blocked at teardown finishes when
    // the connection blocking it closes, and that is later than the test that
    // held it. A deletion that never finishes leaves this pending until the
    // hook times out, which is the report a real leak should produce.
    await databaseDeletionsSettled();

    const databases = await indexedDB.databases();
    expect(databases.filter(database => database.name && allocated.has(database.name))).toEqual([]);
});
