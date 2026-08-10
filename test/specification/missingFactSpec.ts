import { GivenNotFoundError, Jinaga, JinagaTest, ReadDiagnostic, User } from "@src";
import { Administrator, Company, Office, model } from "../companyModel";
import { asGivenNotFound } from "../distribution/diagnosticNarrowing";

/**
 * Issue #232. A given that is not in the local store used to read back as an
 * empty result, indistinguishable from a specification that legitimately
 * matches nothing. `JinagaTest` runs on a local-only network, so nothing could
 * ever have supplied the missing fact and the condition is terminal.
 */
describe("missing fact handling", () => {
    let creator: User;
    let company: Company;
    let office: Office;
    let j: Jinaga;

    const officesOfCompany = model.given(Company).match((company, facts) =>
        facts.ofType(Office)
            .join(office => office.company, company)
    );

    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        company = new Company(creator, "TestCo");
        office = new Office(company, "TestOffice");
        j = JinagaTest.create({
            initialState: [
                creator,
                company,
                office
            ]
        });
    });

    it("should throw when querying with a non-persisted given", async () => {
        const nonPersistedCompany = new Company(creator, "NonPersistedCo");

        await expect(j.query(officesOfCompany, nonPersistedCompany))
            .rejects.toBeInstanceOf(GivenNotFoundError);
    });

    it("should name the missing given on the error", async () => {
        const nonPersistedCompany = new Company(creator, "NonPersistedCo");

        const error: GivenNotFoundError = await j.query(officesOfCompany, nonPersistedCompany)
            .then(() => { throw new Error("Expected the query to reject."); })
            .catch(e => e);

        expect(error).toBeInstanceOf(GivenNotFoundError);
        expect(error.references).toHaveLength(1);
        expect(error.references[0].type).toBe(Company.Type);
        expect(error.references[0].hash).toBe(j.hash(nonPersistedCompany));
    });

    it("should throw when the projection selects the missing given itself", async () => {
        const nonPersistedCompany = new Company(creator, "NonPersistedCo");
        const specification = model.given(Company).select((company, facts) => company);

        await expect(j.query(specification, nonPersistedCompany))
            .rejects.toBeInstanceOf(GivenNotFoundError);
    });

    it("should return results for a persisted given", async () => {
        const persistedResult = await j.query(officesOfCompany, company);

        expect(persistedResult.length).toBe(1);
        expect(persistedResult[0].identifier).toBe(office.identifier);
        expect(persistedResult[0].type).toBe(office.type);
    });

    it("should throw for a given that was not in the initial state", async () => {
        const newCompany = new Company(creator, "NewCo");

        await expect(j.query(officesOfCompany, newCompany))
            .rejects.toBeInstanceOf(GivenNotFoundError);
    });

    it("should still return empty for a persisted given with no matches", async () => {
        // The distinction the issue is about: this given exists, so an empty
        // result is a real answer rather than a failed read.
        const emptyCompany = await j.fact(new Company(creator, "EmptyCo"));

        const result = await j.query(officesOfCompany, emptyCompany);

        expect(result).toEqual([]);
    });

    it("should report rather than throw through queryWithDiagnostics", async () => {
        const nonPersistedCompany = new Company(creator, "NonPersistedCo");

        const { results, diagnostics } = await j.queryWithDiagnostics(
            officesOfCompany, nonPersistedCompany);

        expect(results).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        const diagnostic = asGivenNotFound(diagnostics[0]);
        expect(diagnostic.operation).toBe("query");
        expect(diagnostic.references).toHaveLength(1);
        expect(diagnostic.references[0].hash).toBe(j.hash(nonPersistedCompany));
        expect(diagnostic.cleared).toBeFalsy();
    });

    it("should report no diagnostic through queryWithDiagnostics for a persisted given", async () => {
        const emptyCompany = await j.fact(new Company(creator, "EmptyCo"));

        const { results, diagnostics } = await j.queryWithDiagnostics(
            officesOfCompany, emptyCompany);

        expect(results).toEqual([]);
        expect(diagnostics).toEqual([]);
    });

    it("should drive the instance diagnostic hook when query throws", async () => {
        const nonPersistedCompany = new Company(creator, "NonPersistedCo");
        const received: ReadDiagnostic[] = [];
        j.onDistributionDiagnostic(d => received.push(d));

        await expect(j.query(officesOfCompany, nonPersistedCompany)).rejects.toBeInstanceOf(GivenNotFoundError);

        expect(received).toHaveLength(1);
        expect(asGivenNotFound(received[0]).references[0].hash).toBe(j.hash(nonPersistedCompany));
    });

    it("should report every missing given, not only the first", async () => {
        const missingCompany = new Company(creator, "MissingCo");
        const missingUser = new User("--- ABSENT USER KEY ---");
        const administrators = model.given(Company, User).match((c, user, facts) =>
            facts.ofType(Administrator)
                .join(a => a.company, c)
                .join(a => a.user, user)
        );

        const error: GivenNotFoundError = await j.query(administrators, missingCompany, missingUser)
            .then(() => { throw new Error("Expected the query to reject."); })
            .catch(e => e);

        expect(error).toBeInstanceOf(GivenNotFoundError);
        expect(error.references.map(r => r.hash).sort()).toEqual(
            [j.hash(missingCompany), j.hash(missingUser)].sort());
    });
});
