import { JinagaTest } from "../../src";
import { Company, model, Office, User } from "./model";

describe("specification query", () => {
    it("should query for successors", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const creator = new User("--- PUBLIC KEY GOES HERE ---");
        const company = new Company(creator, "TestCo");
        const office = new Office(company, "TestOffice");
        const j = JinagaTest.create({
            initialState: [
                creator,
                company,
                office
            ]
        });

        const result = await j.query2(specification, company);
        expect(result).toEqual([office]);
    });
});