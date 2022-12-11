import { Jinaga, JinagaTest } from "../../src";
import { Company, model, Office, User } from "./model";

describe("specification watch", () => {
    let creator: User;
    let emptyCompany: Company;
    let j: Jinaga;

    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        emptyCompany = new Company(creator, "EmptyCo");
        j = JinagaTest.create({
            initialState: [
                creator,
                emptyCompany
            ]
        });
    });

    it("should return no results when empty", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const offices: Office[] = [];
        const officeObserver = j.watch2(specification, emptyCompany, office => {
            offices.push(office);
        });

        await officeObserver.initialized();
        await officeObserver.stop();

        expect(offices).toEqual([]);
    });
});