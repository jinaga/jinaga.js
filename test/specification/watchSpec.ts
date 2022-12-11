import { Jinaga, JinagaTest } from "../../src";
import { Company, model, Office, User } from "./model";

describe("specification watch", () => {
    let creator: User;
    let emptyCompany: Company;
    let company: Company;
    let office: Office;
    let j: Jinaga;

    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        emptyCompany = new Company(creator, "EmptyCo");
        company = new Company(creator, "TestCo");
        office = new Office(company, "TestOffice");
        j = JinagaTest.create({
            initialState: [
                creator,
                emptyCompany,
                company,
                office
            ]
        });
    });

    it("should return no results when empty", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const offices: string[] = [];
        const officeObserver = j.watch2(specification, emptyCompany, office => {
            offices.push(j.hash(office));
        });

        await officeObserver.initialized();
        await officeObserver.stop();

        expect(offices).toEqual([]);
    });

    it("should notify results when they previously existed", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const offices: string[] = [];
        const officeObserver = j.watch2(specification, company, office => {
            offices.push(j.hash(office));
        });

        await officeObserver.initialized();
        await officeObserver.stop();

        expect(offices).toEqual([j.hash(office)]);
    });
});