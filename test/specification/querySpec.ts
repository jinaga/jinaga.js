import { Jinaga, JinagaTest } from "../../src";
import { Company, Employee, model, Office, President, User } from "./model";

describe("specification query", () => {
    let creator: User;
    let company: Company;
    let office: Office;
    let president: President;
    let employee: Employee;
    let j: Jinaga;
    
    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        company = new Company(creator, "TestCo");
        office = new Office(company, "TestOffice");
        president = new President(office, new User("--- PRESIDENT PUBLIC KEY ---"));
        employee = new Employee(office, new User("--- EMPLOYEE PUBLIC KEY ---"));
        j = JinagaTest.create({
            initialState: [
                creator,
                company,
                office,
                president,
                employee
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

    it("should query for zig zag", async () => {
        const specification = model.given(Employee).match((employee, facts) =>
            facts.ofType(President)
                .join(president => president.office, employee.office)
        );

        const result = await j.query(specification, employee);
        expect(result.length).toBe(1);
        expect(j.hash(result[0])).toBe(j.hash(president));
    });
});