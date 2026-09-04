import { Jinaga, User } from "@src";
import { Company, Office, model } from "../companyModel";
import { describeAcrossStores } from "../utils/store-factories";

// What a read returns for a given that the store has never seen is a semantic
// every implementation has to agree on, so these cases run against each one
// rather than against the `MemoryStore` that `JinagaTest.create` used to
// construct for itself (issue #252, step 3).
describeAcrossStores("missing fact handling", (createInstance) => {
    let creator: User;
    let company: Company;
    let office: Office;
    let j: Jinaga;

    beforeEach(async () => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        company = new Company(creator, "TestCo");
        office = new Office(company, "TestOffice");
        j = await createInstance({
            initialState: [
                creator,
                company,
                office
            ]
        });
    });

    it("should return empty result when querying with non-persisted given", async () => {
        // Create a company that is not persisted
        const nonPersistedCompany = new Company(creator, "NonPersistedCo");
        
        // Create a specification that uses the non-persisted company as given
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        // This should return an empty result instead of throwing an error
        const result = await j.query(specification, nonPersistedCompany);
        expect(result).toEqual([]);
    });

    it("should return empty result when fact projection references missing fact", async () => {
        // Create a company that is not persisted
        const nonPersistedCompany = new Company(creator, "NonPersistedCo");
        
        // Create a specification that selects the company fact itself
        const specification = model.given(Company).select((company, facts) => company);

        // This should return an empty result instead of throwing an error
        const result = await j.query(specification, nonPersistedCompany);
        expect(result).toEqual([]);
    });

    it("should return empty result when querying with fact that has persisted predecessors", async () => {
        // Create a specification that looks for offices belonging to a given company
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        // This should work for the persisted company
        const persistedResult = await j.query(specification, company);
        expect(persistedResult.length).toBe(1);
        expect(persistedResult[0].identifier).toBe(office.identifier);
        expect(persistedResult[0].type).toBe(office.type);

        // Create a company that was not in initial state
        const newCompany = new Company(creator, "NewCo");
        
        // Querying with a company that wasn't persisted should return empty result
        const newCompanyResult = await j.query(specification, newCompany);
        expect(newCompanyResult).toEqual([]);
    });
});