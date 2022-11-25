import { Jinaga, JinagaTest } from "../../src";
import { Company, model, Office, User } from "./model";

describe("specification query", () => {
    let creator: User;
    let company: Company;
    let office: Office;
    let j: Jinaga;
    
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

    it("should query for successors", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const result = await j.query(specification, company);
        expect(result.length).toBe(1);
        expect(j.hash(result[0])).toBe(j.hash(office));
    });

    it("should query for predecessors", async () => {
        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(Company)
                .join(company => company, office.company)
        );

        const result = await j.query(specification, office);
        expect(result.length).toBe(1);
        expect(j.hash(result[0])).toBe(j.hash(company));
    });

    it("should query for multiple predecessors", async () => {
        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(User)
                .join(user => user, office.company.creator)
        );

        const result = await j.query(specification, office);
        expect(result.length).toBe(1);
        expect(j.hash(result[0])).toBe(j.hash(creator));
    });
});