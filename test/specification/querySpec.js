"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
const companyModel_1 = require("../companyModel");
describe("specification query", () => {
    let creator;
    let company;
    let office;
    let closedOffice;
    let reopenedOffice;
    let president;
    let employee;
    let otherEmployee;
    let j;
    beforeEach(() => {
        creator = new _src_1.User("--- PUBLIC KEY GOES HERE ---");
        company = new companyModel_1.Company(creator, "TestCo");
        office = new companyModel_1.Office(company, "TestOffice");
        president = new companyModel_1.President(office, new _src_1.User("--- PRESIDENT PUBLIC KEY ---"));
        employee = new companyModel_1.Employee(office, new _src_1.User("--- EMPLOYEE PUBLIC KEY ---"));
        otherEmployee = new companyModel_1.Employee(office, new _src_1.User("--- OTHER EMPLOYEE PUBLIC KEY ---"));
        closedOffice = new companyModel_1.Office(company, "ClosedOffice");
        const closed = new companyModel_1.OfficeClosed(closedOffice, new Date());
        reopenedOffice = new companyModel_1.Office(closedOffice.company, "ReopenedOffice");
        const reopened = new companyModel_1.OfficeReopened(new companyModel_1.OfficeClosed(reopenedOffice, new Date()));
        j = _src_1.JinagaTest.create({
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
    it("should query for successors using join", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company));
        const result = yield j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(office),
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
    }));
    it("should query for successors using successors", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match(company => company.successors(companyModel_1.Office, office => office.company));
        const result = yield j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(office),
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
    }));
    it("should query for predecessors", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Office).match((office, facts) => facts.ofType(companyModel_1.Company)
            .join(company => company, office.company));
        const result = yield j.query(specification, office);
        expect(result.length).toBe(1);
        expect(j.hash(result[0])).toBe(j.hash(company));
    }));
    it("should query for multiple predecessors", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Office).match((office, facts) => facts.ofType(_src_1.User)
            .join(user => user, office.company.creator));
        const result = yield j.query(specification, office);
        expect(result.length).toBe(1);
        expect(j.hash(result[0])).toBe(j.hash(creator));
    }));
    it("should query for zig zag", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Employee).match((employee, facts) => facts.ofType(companyModel_1.President)
            .join(president => president.office, employee.office));
        const result = yield j.query(specification, employee);
        expect(result.length).toBe(1);
        expect(j.hash(result[0])).toBe(j.hash(president));
    }));
    it("should execute negative existential condition using successors", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => company.successors(companyModel_1.Office, office => office.company)
            .notExists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)));
        const result = yield j.query(specification, company);
        expect(result.length).toBe(1);
        expect(j.hash(result[0])).toBe(j.hash(office));
    }));
    it("should execute negative existential condition using join", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .notExists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)));
        const result = yield j.query(specification, company);
        expect(result.length).toBe(1);
        expect(j.hash(result[0])).toBe(j.hash(office));
    }));
    it("should execute positive existential condition using successors", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => company.successors(companyModel_1.Office, office => office.company)
            .exists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)));
        const result = yield j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
    }));
    it("should execute positive existential condition using join", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .exists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)));
        const result = yield j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
    }));
    it("should execute nested existential conditions using successors", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => company.successors(companyModel_1.Office, office => office.company)
            .notExists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)
            .notExists(officeClosed => facts.ofType(companyModel_1.OfficeReopened)
            .join(officeReopened => officeReopened.officeClosed, officeClosed))));
        const result = yield j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(office),
            j.hash(reopenedOffice)
        ]);
    }));
    it("should execute nested existential conditions using join", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .notExists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)
            .notExists(officeClosed => facts.ofType(companyModel_1.OfficeReopened)
            .join(officeReopened => officeReopened.officeClosed, officeClosed))));
        const result = yield j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(office),
            j.hash(reopenedOffice)
        ]);
    }));
    it("should match all employees using successors", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => company.successors(companyModel_1.Office, office => office.company)
            .selectMany(office => facts.ofType(companyModel_1.Employee)
            .join(employee => employee.office, office)));
        const result = yield j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(employee),
            j.hash(otherEmployee)
        ]);
    }));
    it("should match all employees using join", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Employee)
            .join(employee => employee.office.company, company));
        const result = yield j.query(specification, company);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(employee),
            j.hash(otherEmployee)
        ]);
    }));
    it("should execute multiple path conditions using successors", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company, _src_1.User).match((company, user, facts) => company.successors(companyModel_1.Office, office => office.company)
            .selectMany(office => facts.ofType(companyModel_1.Employee)
            .join(employee => employee.office, office)
            .join(employee => employee.user, user)));
        const result = yield j.query(specification, company, employee.user);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(employee)
        ]);
    }));
    it("should execute multiple path conditions using join", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company, _src_1.User).match((company, user, facts) => facts.ofType(companyModel_1.Employee)
            .join(employee => employee.office.company, company)
            .join(employee => employee.user, user));
        const result = yield j.query(specification, company, employee.user);
        expect(result.map(r => j.hash(r))).toEqual([
            j.hash(employee)
        ]);
    }));
    it("should execute a field projection using successors", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match(company => company.successors(companyModel_1.Office, office => office.company)
            .select(office => office.identifier));
        const result = yield j.query(specification, company);
        expect(result).toEqual([
            "TestOffice",
            "ClosedOffice",
            "ReopenedOffice"
        ]);
    }));
    it("should execute a field projection using join", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .select(office => office.identifier));
        const result = yield j.query(specification, company);
        expect(result).toEqual([
            "TestOffice",
            "ClosedOffice",
            "ReopenedOffice"
        ]);
    }));
    it("should execute a composite projection using successors", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match(company => company.successors(companyModel_1.Office, office => office.company)
            .select(office => ({
            identifier: office.identifier,
            company: company.identifier
        })));
        const result = yield j.query(specification, company);
        expect(result).toEqual([
            { identifier: "TestOffice", company: "TestCo" },
            { identifier: "ClosedOffice", company: "TestCo" },
            { identifier: "ReopenedOffice", company: "TestCo" }
        ]);
    }));
    it("should execute a composite projection using join", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .select(office => ({
            identifier: office.identifier,
            company: company.identifier
        })));
        const result = yield j.query(specification, company);
        expect(result).toEqual([
            { identifier: "TestOffice", company: "TestCo" },
            { identifier: "ClosedOffice", company: "TestCo" },
            { identifier: "ReopenedOffice", company: "TestCo" }
        ]);
    }));
    it("should execute a specification projection using successors", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match(company => company.successors(companyModel_1.Office, office => office.company)
            .select(office => ({
            identifier: office.identifier,
            employees: office.successors(companyModel_1.Employee, employee => employee.office)
        })));
        const result = yield j.query(specification, company);
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
    }));
    it("should execute a specification projection using join", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .select(office => ({
            identifier: office.identifier,
            employees: facts.ofType(companyModel_1.Employee)
                .join(employee => employee.office, office)
        })));
        const result = yield j.query(specification, company);
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
    }));
    it("should execute a hash projection using join", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .select(office => j.hash(office)));
        const result = yield j.query(specification, company);
        expect(result).toEqual([
            j.hash(office),
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
    }));
    it("should execute a hash projection using successors", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match(company => company.successors(companyModel_1.Office, office => office.company)
            .select(office => j.hash(office)));
        const result = yield j.query(specification, company);
        expect(result).toEqual([
            j.hash(office),
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
    }));
    it("should execute a hash projection using query method", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match(company => company.successors(companyModel_1.Office, office => office.company)
            .select(office => ({
            id: j.hash(office)
        })));
        const result = yield j.query(specification, company);
        const resultIds = result.map((r) => r.id);
        expect(resultIds).toEqual([
            j.hash(office),
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
    }));
    it("should execute a hash projection using watch method", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match(company => company.successors(companyModel_1.Office, office => office.company)
            .select(office => ({
            id: j.hash(office)
        })));
        // Use the watch method to receive the results
        const results = [];
        const observer = j.watch(specification, company, result => {
            results.push(result);
        });
        // Wait for the results to be processed
        yield new Promise(resolve => setTimeout(resolve, 0));
        // Verify the results
        expect(results.map(r => r.id)).toEqual([
            j.hash(office),
            j.hash(closedOffice),
            j.hash(reopenedOffice)
        ]);
        // Clean up
        observer.stop();
    }));
});
//# sourceMappingURL=querySpec.js.map