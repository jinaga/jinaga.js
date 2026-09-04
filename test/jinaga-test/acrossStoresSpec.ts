import { Jinaga, User } from "@src";
import { Company, Office, model } from "../companyModel";
import { describeAcrossStores } from "../utils/store-factories";

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
    expect(runsByCase.size).toBe(3);

    // The databases the IndexedDB runs allocated were deleted by teardown. A
    // helper that dropped its stores on the floor would leave one per case.
    const databases = await indexedDB.databases();
    expect(databases.filter(database => database.name?.startsWith("test-across-stores-"))).toEqual([]);
});
