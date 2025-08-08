import { Jinaga, JinagaTest, User } from "../../src";
import { Company, Employee, Office, OfficeClosed, OfficeReopened, President, model } from "../companyModel";

describe("specification query", () => {
    let creator: User;
    let company: Company;
    let office: Office;
    let closedOffice: Office;
    let reopenedOffice: Office;
    let president: President;
    let employee: Employee;
    let otherEmployee: Employee;
    let j: Jinaga;
    
    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        company = new Company(creator, "TestCo");
        office = new Office(company, "TestOffice");
        president = new President(office, new User("--- PRESIDENT PUBLIC KEY ---"));
        employee = new Employee(office, new User("--- EMPLOYEE PUBLIC KEY ---"));
        otherEmployee = new Employee(office, new User("--- OTHER EMPLOYEE PUBLIC KEY ---"));
        closedOffice = new Office(company, "ClosedOffice");
        const closed = new OfficeClosed(closedOffice, new Date());
        reopenedOffice = new Office(closedOffice.company, "ReopenedOffice");
        const reopened = new OfficeReopened(new OfficeClosed(reopenedOffice, new Date()));
        j = JinagaTest.create({
            initialState: [
                creator,
                company,
                office,
                president,
                employee,
                otherEmployee,
                closedOffice,
                closed,
                reopenedOffice,
                reopened
            ]
        });
    });

    it("should query for successors using join", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const result = await j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(office),
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
    });

    it("should query for successors using successors", async () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
        );

        const result = await j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(office),
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
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

    it("should execute negative existential condition using successors", async () => {
        const specification = model.given(Company).match((company, facts) =>
            company.successors(Office, office => office.company)
                .notExists(office => facts.ofType(OfficeClosed)
                    .join(officeClosed => officeClosed.office, office)
                )
        );

        const result = await j.query(specification, company);
        expect(result.length).toBe(1);
        expect(j.hash(result[0])).toBe(j.hash(office));
    });

    it("should execute negative existential condition using join", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .notExists(office => facts.ofType(OfficeClosed)
                    .join(officeClosed => officeClosed.office, office)
                )
        );

        const result = await j.query(specification, company);
        expect(result.length).toBe(1);
        expect(j.hash(result[0])).toBe(j.hash(office));
    });

    it("should execute positive existential condition using successors", async () => {
        const specification = model.given(Company).match((company, facts) =>
            company.successors(Office, office => office.company)
                .exists(office => facts.ofType(OfficeClosed)
                    .join(officeClosed => officeClosed.office, office)
                )
        );

        const result = await j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
    });

    it("should execute positive existential condition using join", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .exists(office => facts.ofType(OfficeClosed)
                    .join(officeClosed => officeClosed.office, office)
                )
        );

        const result = await j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
    });

    it("should execute nested existential conditions using successors", async () => {
        const specification = model.given(Company).match((company, facts) =>
            company.successors(Office, office => office.company)
                .notExists(office => facts.ofType(OfficeClosed)
                    .join(officeClosed => officeClosed.office, office)
                    .notExists(officeClosed => facts.ofType(OfficeReopened)
                        .join(officeReopened => officeReopened.officeClosed, officeClosed)
                    )
                )
        );

        const result = await j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(office),
            j.hash(reopenedOffice)
        ]);
    });

    it("should execute nested existential conditions using join", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .notExists(office => facts.ofType(OfficeClosed)
                    .join(officeClosed => officeClosed.office, office)
                    .notExists(officeClosed => facts.ofType(OfficeReopened)
                        .join(officeReopened => officeReopened.officeClosed, officeClosed)
                    )
                )
        );

        const result = await j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(office),
            j.hash(reopenedOffice)
        ]);
    });

    it("should match all employees using successors", async () => {
        const specification = model.given(Company).match((company, facts) =>
            company.successors(Office, office => office.company)
                .selectMany(office => facts.ofType(Employee)
                    .join(employee => employee.office, office)
                )
        );

        const result = await j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(employee),
            j.hash(otherEmployee)
        ]);
    });

    it("should match all employees using join", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Employee)
                .join(employee => employee.office.company, company)
        );

        const result = await j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(employee),
            j.hash(otherEmployee)
        ]);
    });

    it("should execute multiple path conditions using successors", async () => {
        const specification = model.given(Company, User).match((company, user, facts) =>
            company.successors(Office, office => office.company)
                .selectMany(office => facts.ofType(Employee)
                    .join(employee => employee.office, office)
                    .join(employee => employee.user, user)
                )
        );

        const result = await j.query(specification, company, employee.user);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(employee)
        ]);
    });

    it("should execute multiple path conditions using join", async () => {
        const specification = model.given(Company, User).match((company, user, facts) =>
            facts.ofType(Employee)
                .join(employee => employee.office.company, company)
                .join(employee => employee.user, user)
        );

        const result = await j.query(specification, company, employee.user);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(employee)
        ]);
    });

    it("should execute a field projection using successors", async () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
                .select(office => office.identifier)
        );

        const result = await j.query(specification, company);
        expect(result).toEqual([
            "TestOffice",
            "ClosedOffice",
            "ReopenedOffice"
        ]);
    });

    it("should execute a field projection using join", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .select(office => office.identifier)
        );

        const result = await j.query(specification, company);
        expect(result).toEqual([
            "TestOffice",
            "ClosedOffice",
            "ReopenedOffice"
        ]);
    });

    it("should execute a composite projection using successors", async () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
                .select(office => ({
                    identifier: office.identifier,
                    company: company.identifier
                }))
        );

        const result = await j.query(specification, company);
        expect(result).toEqual([
            { identifier: "TestOffice", company: "TestCo" },
            { identifier: "ClosedOffice", company: "TestCo" },
            { identifier: "ReopenedOffice", company: "TestCo" }
        ]);
    });

    it("should execute a composite projection using join", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .select(office => ({
                    identifier: office.identifier,
                    company: company.identifier
                }))
        );

        const result = await j.query(specification, company);
        expect(result).toEqual([
            { identifier: "TestOffice", company: "TestCo" },
            { identifier: "ClosedOffice", company: "TestCo" },
            { identifier: "ReopenedOffice", company: "TestCo" }
        ]);
    });

    it("should execute a specification projection using successors", async () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
                .select(office => ({
                    identifier: office.identifier,
                    employees: office.successors(Employee, employee => employee.office)
                }))
        );

        const result = await j.query(specification, company);
        expect(result.map(result => ({
            identifier: result.identifier,
            employeeHashes: result.employees.map(employee => j.hash(employee))
        }))).toEqual([
            {
                identifier: "TestOffice",
                employeeHashes: [
                    j.hash(employee),
                    j.hash(otherEmployee)
                ]
            },
            {
                identifier: "ClosedOffice",
                employeeHashes: []
            },
            {
                identifier: "ReopenedOffice",
                employeeHashes: []
            }
        ]);
    });

    it("should execute a specification projection using join", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .select(office => ({
                    identifier: office.identifier,
                    employees: facts.ofType(Employee)
                        .join(employee => employee.office, office)
                }))
        );

        const result = await j.query(specification, company);
        expect(result.map(result => ({
            identifier: result.identifier,
            employeeHashes: result.employees.map(employee => j.hash(employee))
        }))).toEqual([
            {
                identifier: "TestOffice",
                employeeHashes: [
                    j.hash(employee),
                    j.hash(otherEmployee)
                ]
            },
            {
                identifier: "ClosedOffice",
                employeeHashes: []
            },
            {
                identifier: "ReopenedOffice",
                employeeHashes: []
            }
        ]);
    });

    it("should execute a hash projection using join", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .select(office => j.hash(office))
        );

        const result = await j.query(specification, company);
        expect(result).toEqual([
            j.hash(office),
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
    });

    it("should execute a hash projection using successors", async () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
                .select(office => j.hash(office))
        );
    
        const result = await j.query(specification, company);
        expect(result).toEqual([
            j.hash(office),
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
    });

    it("should execute a hash projection using query method", async () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
                .select(office => ({
                    id: j.hash(office)
                }))
        );

        const result = await j.query(specification, company);
        const resultIds = result.map((r: any) => r.id);
        expect(resultIds).toEqual([
            j.hash(office),
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
    });

    it("should execute a hash projection using watch method", async () => {
        const specification = model.given(Company).match(company =>
            company.successors(Office, office => office.company)
                .select(office => ({
                    id: j.hash(office)
                }))
        );
        
        // Use the watch method to receive the results
        const results: { id: string }[] = [];
        const observer = j.watch(specification, company, result => {
            results.push(result);
        });
        
        // Wait for the results to be processed
        await new Promise(resolve => setTimeout(resolve, 0));
        
        // Verify the results
        expect(results.map(r => r.id)).toEqual([
            j.hash(office),
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
        
        // Clean up
        observer.stop();
    });
});
