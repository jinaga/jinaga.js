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
describe("specification watch", () => {
    let creator;
    let emptyCompany;
    let company;
    let office;
    let closedOffice;
    let closure;
    let j;
    beforeEach(() => {
        creator = new _src_1.User("--- PUBLIC KEY GOES HERE ---");
        emptyCompany = new companyModel_1.Company(creator, "EmptyCo");
        company = new companyModel_1.Company(creator, "TestCo");
        office = new companyModel_1.Office(company, "TestOffice");
        closedOffice = new companyModel_1.Office(company, "ClosedOffice");
        closure = new companyModel_1.OfficeClosed(closedOffice, new Date());
        j = _src_1.JinagaTest.create({
            initialState: [
                creator,
                emptyCompany,
                company,
                office,
                closedOffice,
                closure
            ]
        });
    });
    it("should return no results when empty", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company));
        const offices = [];
        const officeObserver = j.watch(specification, emptyCompany, office => {
            offices.push(j.hash(office));
        });
        yield officeObserver.loaded();
        officeObserver.stop();
        expect(offices).toEqual([]);
    }));
    it("should notify results when they previously existed", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company));
        const offices = [];
        const officeObserver = j.watch(specification, company, office => {
            offices.push(j.hash(office));
        });
        yield officeObserver.loaded();
        officeObserver.stop();
        expect(offices).toEqual([j.hash(office), j.hash(closedOffice)]);
    }));
    it("should notify results when added", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company));
        const offices = [];
        const officeObserver = j.watch(specification, company, office => {
            offices.push(j.hash(office));
        });
        yield officeObserver.loaded();
        const newOffice = new companyModel_1.Office(company, "NewOffice");
        yield j.fact(newOffice);
        officeObserver.stop();
        expect(offices).toEqual([j.hash(office), j.hash(closedOffice), j.hash(newOffice)]);
    }));
    it("should stop notifying results when stopped", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company));
        const offices = [];
        const officeObserver = j.watch(specification, company, office => {
            offices.push(j.hash(office));
        });
        yield officeObserver.loaded();
        officeObserver.stop();
        const newOffice = new companyModel_1.Office(company, "NewOffice");
        yield j.fact(newOffice);
        expect(offices).toEqual([j.hash(office), j.hash(closedOffice)]);
    }));
    it("should not notify if stopped before load finishes", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company));
        const offices = [];
        const officeObserver = j.watch(specification, company, office => {
            offices.push(j.hash(office));
        });
        officeObserver.stop();
        const newOffice = new companyModel_1.Office(company, "NewOffice");
        yield j.fact(newOffice);
        yield officeObserver.loaded();
        expect(offices).toEqual([]);
    }));
    it("should not notify results related to a different starting point", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company));
        const offices = [];
        const officeObserver = j.watch(specification, company, office => {
            offices.push(j.hash(office));
        });
        yield officeObserver.loaded();
        const newOfficeInOtherCompany = new companyModel_1.Office(emptyCompany, "OfficeInOtherCompany");
        yield j.fact(newOfficeInOtherCompany);
        officeObserver.stop();
        // The array does not contain the new office.
        expect(offices).toEqual([j.hash(office), j.hash(closedOffice)]);
    }));
    it("should notify results when removed", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .notExists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)));
        const offices = [];
        const officeObserver = j.watch(specification, company, office => {
            const hash = j.hash(office);
            offices.push(hash);
            return () => {
                offices.splice(offices.indexOf(hash), 1);
            };
        });
        yield officeObserver.loaded();
        yield j.fact(new companyModel_1.OfficeClosed(office, new Date()));
        officeObserver.stop();
        expect(offices).toEqual([]);
    }));
    it("should execute nested existential conditions", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .notExists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)
            .notExists(officeClosed => facts.ofType(companyModel_1.OfficeReopened)
            .join(officeReopened => officeReopened.officeClosed, officeClosed))));
        const offices = [];
        const officeObserver = j.watch(specification, company, office => {
            const hash = j.hash(office);
            offices.push(hash);
            return () => {
                offices.splice(offices.indexOf(hash), 1);
            };
        });
        yield officeObserver.loaded();
        officeObserver.stop();
        expect(offices).toEqual([j.hash(office)]);
    }));
    it("should notify results when re-added", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .notExists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)
            .notExists(officeClosed => facts.ofType(companyModel_1.OfficeReopened)
            .join(officeReopened => officeReopened.officeClosed, officeClosed))));
        const offices = [];
        const officeObserver = j.watch(specification, company, office => {
            const hash = j.hash(office);
            offices.push(hash);
            return () => {
                offices.splice(offices.indexOf(hash), 1);
            };
        });
        yield officeObserver.loaded();
        yield j.fact(new companyModel_1.OfficeReopened(closure));
        officeObserver.stop();
        expect(offices).toEqual([j.hash(office), j.hash(closedOffice)]);
    }));
    it("should notify child results when added", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .notExists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)
            .notExists(officeClosed => facts.ofType(companyModel_1.OfficeReopened)
            .join(officeReopened => officeReopened.officeClosed, officeClosed)))
            .select(office => ({
            identifier: office.identifier,
            president: facts.ofType(companyModel_1.President)
                .join(president => president.office, office)
        })));
        const offices = [];
        const officeObserver = j.watch(specification, company, office => {
            const model = {
                identifier: office.identifier,
                president: undefined
            };
            offices.push(model);
            office.president.onAdded(president => {
                model.president = j.hash(president);
            });
        });
        yield officeObserver.loaded();
        expect(offices).toEqual([
            {
                identifier: office.identifier,
                president: undefined
            }
        ]);
        const newPresident = new companyModel_1.President(office, new _src_1.User("--- PRESIDENT PUBLIC KEY ---"));
        yield j.fact(newPresident);
        officeObserver.stop();
        expect(offices).toEqual([
            {
                identifier: office.identifier,
                president: j.hash(newPresident)
            }
        ]);
    }));
    it("should notify child results when existing", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .notExists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)
            .notExists(officeClosed => facts.ofType(companyModel_1.OfficeReopened)
            .join(officeReopened => officeReopened.officeClosed, officeClosed)))
            .select(office => ({
            identifier: office.identifier,
            president: facts.ofType(companyModel_1.President)
                .join(president => president.office, office)
        })));
        // Add the president before beginning the watch
        const newPresident = new companyModel_1.President(office, new _src_1.User("--- PRESIDENT PUBLIC KEY ---"));
        yield j.fact(newPresident);
        const offices = [];
        const officeObserver = j.watch(specification, company, office => {
            const model = {
                identifier: office.identifier,
                president: undefined
            };
            offices.push(model);
            office.president.onAdded(president => {
                model.president = j.hash(president);
            });
        });
        yield officeObserver.loaded();
        expect(offices).toEqual([
            {
                identifier: office.identifier,
                president: j.hash(newPresident)
            }
        ]);
        officeObserver.stop();
    }));
    it("should notify grandchild results when existing", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .notExists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)
            .notExists(officeClosed => facts.ofType(companyModel_1.OfficeReopened)
            .join(officeReopened => officeReopened.officeClosed, officeClosed)))
            .select(office => ({
            identifier: office.identifier,
            president: facts.ofType(companyModel_1.President)
                .join(president => president.office, office)
                .select(president => ({
                hash: j.hash(president),
                name: facts.ofType(companyModel_1.UserName)
                    .join(userName => userName.user, president.user)
                    .notExists(userName => facts.ofType(companyModel_1.UserName)
                    .join(next => next.prior, userName))
            }))
        })));
        // Add the president and their name before beginning the watch
        const presidentUser = new _src_1.User("--- PRESIDENT PUBLIC KEY ---");
        const newPresident = new companyModel_1.President(office, presidentUser);
        yield j.fact(newPresident);
        const presidentName = new companyModel_1.UserName(presidentUser, "Mr. President", []);
        yield j.fact(presidentName);
        const offices = [];
        const officeObserver = j.watch(specification, company, office => {
            const model = {
                identifier: office.identifier,
                presidentHash: undefined,
                presidentName: undefined
            };
            offices.push(model);
            office.president.onAdded(president => {
                model.presidentHash = president.hash;
                president.name.onAdded(name => {
                    model.presidentName = name.value;
                });
            });
        });
        yield officeObserver.loaded();
        expect(offices).toEqual([
            {
                identifier: office.identifier,
                presidentHash: j.hash(newPresident),
                presidentName: "Mr. President"
            }
        ]);
        officeObserver.stop();
    }));
    it("should notify when manager and name added", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .notExists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office))
            .select(office => ({
            office: office,
            managers: facts.ofType(companyModel_1.Manager)
                .join(manager => manager.office, office)
                .notExists(manager => facts.ofType(companyModel_1.ManagerTerminated)
                .join(managerTerminated => managerTerminated.manager, manager))
                .select(manager => ({
                manager: manager,
                name: facts.ofType(companyModel_1.ManagerName)
                    .join(managerName => managerName.manager, manager)
                    .notExists(managerName => facts.ofType(companyModel_1.ManagerName)
                    .join(next => next.prior, managerName))
            }))
        })));
        const offices = [];
        const officeObserver = j.watch(specification, company, office => {
            const model = {
                identifier: office.office.identifier,
                managers: []
            };
            offices.push(model);
            office.managers.onAdded(manager => {
                const managerModel = {
                    employeeNumber: manager.manager.employeeNumber,
                    name: undefined
                };
                model.managers.push(managerModel);
                manager.name.onAdded(name => {
                    managerModel.name = name.value;
                });
            });
        });
        yield officeObserver.loaded();
        expect(offices).toEqual([
            {
                identifier: "TestOffice",
                managers: []
            }
        ]);
        const manager = yield j.fact(new companyModel_1.Manager(office, 123));
        expect(offices).toEqual([
            {
                identifier: "TestOffice",
                managers: [
                    {
                        employeeNumber: 123,
                        name: undefined
                    }
                ]
            }
        ]);
        yield j.fact(new companyModel_1.ManagerName(manager, "Test Manager", []));
        expect(offices).toEqual([
            {
                identifier: "TestOffice",
                managers: [
                    {
                        employeeNumber: 123,
                        name: "Test Manager"
                    }
                ]
            }
        ]);
        officeObserver.stop();
    }));
    it("should notify children of identity when added", () => __awaiter(void 0, void 0, void 0, function* () {
        // Given an office, select an object returning both the presidents and the managers
        const specification = companyModel_1.model.given(companyModel_1.Office).select((office, facts) => ({
            id: j.hash(office),
            presidents: facts.ofType(companyModel_1.President)
                .join(president => president.office, office)
                .select(president => j.hash(president)),
            managers: facts.ofType(companyModel_1.Manager)
                .join(manager => manager.office, office)
                .select(manager => j.hash(manager))
        }));
        // Watch the office for changes
        const offices = [];
        const officeObserver = j.watch(specification, office, projection => {
            const model = {
                id: projection.id,
                presidents: [],
                managers: []
            };
            offices.push(model);
            // When a president is added, add it to the list
            projection.presidents.onAdded(president => {
                model.presidents.push(president);
            });
            // When a manager is added, add it to the list
            projection.managers.onAdded(manager => {
                model.managers.push(manager);
            });
        });
        // Wait for the initial load to complete
        yield officeObserver.loaded();
        // Add a president
        const president = yield j.fact(new companyModel_1.President(office, creator));
        // Add a manager
        const manager = yield j.fact(new companyModel_1.Manager(office, 123));
        // Stop watching
        officeObserver.stop();
        // Verify that the office was loaded
        expect(offices).toEqual([
            {
                id: j.hash(office),
                presidents: [j.hash(president)],
                managers: [j.hash(manager)]
            }
        ]);
    }));
    it("should execute inverse when first step is a predecessor", () => __awaiter(void 0, void 0, void 0, function* () {
        // Find all presidents of other offices
        const specification = companyModel_1.model.given(companyModel_1.Office).match((office, facts) => office.company.predecessor().selectMany(company => facts.ofType(companyModel_1.President)
            .join(president => president.office.company, company)
            .select(president => _src_1.Jinaga.hash(president))));
        // Set up test data
        const user = new _src_1.User("--- PUBLIC KEY GOES HERE ---");
        const company = new companyModel_1.Company(user, "TestCo");
        const office = new companyModel_1.Office(company, "TestOffice");
        const otherOffice = new companyModel_1.Office(company, "OtherOffice");
        const otherUser = new _src_1.User("--- OTHER PUBLIC KEY GOES HERE ---");
        const otherPresident = new companyModel_1.President(otherOffice, otherUser);
        const j = _src_1.JinagaTest.create({
            initialState: [user, company, otherOffice, otherPresident]
        });
        // Test the execution using watch
        const results = [];
        const observer = j.watch(specification, office, hash => {
            results.push(hash);
        });
        yield observer.loaded();
        // Add the starting office
        yield j.fact(office);
        observer.stop();
        // Verify the inverse execution works correctly
        expect(results).toEqual([j.hash(otherPresident)]);
    }));
    it("should execute inverse when first step is a predecessor and include new president", () => __awaiter(void 0, void 0, void 0, function* () {
        // Find all presidents of other offices
        const specification = companyModel_1.model.given(companyModel_1.Office).match((office, facts) => office.company.predecessor().selectMany(company => facts.ofType(companyModel_1.President)
            .join(president => president.office.company, company)
            .select(president => _src_1.Jinaga.hash(president))));
        // Set up test data
        const user = new _src_1.User("--- PUBLIC KEY GOES HERE ---");
        const company = new companyModel_1.Company(user, "TestCo");
        const office = new companyModel_1.Office(company, "TestOffice");
        const otherOffice = new companyModel_1.Office(company, "OtherOffice");
        const otherUser = new _src_1.User("--- OTHER PUBLIC KEY GOES HERE ---");
        const otherPresident = new companyModel_1.President(otherOffice, otherUser);
        const j = _src_1.JinagaTest.create({
            initialState: [user, company, otherOffice, otherPresident]
        });
        // Test the execution using watch
        const results = [];
        const observer = j.watch(specification, office, hash => {
            results.push(hash);
        });
        yield observer.loaded();
        // Add the starting office
        yield j.fact(office);
        // Add a president to the starting office after observer is loaded
        const newUser = new _src_1.User("--- NEW PRESIDENT KEY GOES HERE ---");
        const newPresident = new companyModel_1.President(office, newUser);
        yield j.fact(newUser);
        yield j.fact(newPresident);
        observer.stop();
        // Verify both the existing president and the new president are included
        expect(results).toEqual(expect.arrayContaining([
            j.hash(otherPresident),
            j.hash(newPresident)
        ]));
        expect(results).toHaveLength(2);
    }));
    // High-priority tests for additional unpersisted given scenarios
    it("should execute inverse when first step is a successor", () => __awaiter(void 0, void 0, void 0, function* () {
        // Find all managers of this office
        const specification = companyModel_1.model.given(companyModel_1.Office).match((office, facts) => office.successors(companyModel_1.Manager, manager => manager.office)
            .select(manager => _src_1.Jinaga.hash(manager)));
        // Set up test data - manager exists but office is not persisted yet
        const user = new _src_1.User("--- PUBLIC KEY GOES HERE ---");
        const company = new companyModel_1.Company(user, "TestCo");
        const office = new companyModel_1.Office(company, "TestOffice");
        const manager = new companyModel_1.Manager(office, 12345);
        const j = _src_1.JinagaTest.create({
            initialState: [user, company, manager] // office NOT included initially
        });
        // Test the execution using watch
        const results = [];
        const observer = j.watch(specification, office, hash => {
            results.push(hash);
        });
        yield observer.loaded();
        // Add the starting office
        yield j.fact(office);
        observer.stop();
        // Verify the inverse execution works correctly
        expect(results).toEqual([j.hash(manager)]);
    }));
    it("should execute inverse when first step is a successor and include new manager", () => __awaiter(void 0, void 0, void 0, function* () {
        // Find all managers of this office
        const specification = companyModel_1.model.given(companyModel_1.Office).match((office, facts) => office.successors(companyModel_1.Manager, manager => manager.office)
            .select(manager => _src_1.Jinaga.hash(manager)));
        // Set up test data - existing manager
        const user = new _src_1.User("--- PUBLIC KEY GOES HERE ---");
        const company = new companyModel_1.Company(user, "TestCo");
        const office = new companyModel_1.Office(company, "TestOffice");
        const existingManager = new companyModel_1.Manager(office, 12345);
        const j = _src_1.JinagaTest.create({
            initialState: [user, company, existingManager] // office NOT included initially
        });
        // Test the execution using watch
        const results = [];
        const observer = j.watch(specification, office, hash => {
            results.push(hash);
        });
        yield observer.loaded();
        // Add the starting office
        yield j.fact(office);
        // Add a new manager after office is persisted
        const newManager = new companyModel_1.Manager(office, 67890);
        yield j.fact(newManager);
        observer.stop();
        // Verify both managers are found
        expect(results).toEqual(expect.arrayContaining([
            j.hash(existingManager),
            j.hash(newManager)
        ]));
        expect(results).toHaveLength(2);
    }));
    it("should handle simple fact query with unpersisted given", () => __awaiter(void 0, void 0, void 0, function* () {
        // Simple query that just returns the given fact itself when it exists
        const specification = companyModel_1.model.given(companyModel_1.Office).match((office, facts) => facts.ofType(companyModel_1.Office)
            .join(o => o, office)
            .select(o => _src_1.Jinaga.hash(o)));
        // Set up test data
        const user = new _src_1.User("--- PUBLIC KEY GOES HERE ---");
        const company = new companyModel_1.Company(user, "TestCo");
        const office = new companyModel_1.Office(company, "TestOffice");
        const j = _src_1.JinagaTest.create({
            initialState: [user, company] // office NOT included initially
        });
        // Test the execution using watch
        const results = [];
        const observer = j.watch(specification, office, hash => {
            results.push(hash);
        });
        yield observer.loaded();
        // Add the starting office
        yield j.fact(office);
        observer.stop();
        // Verify the office itself is found
        expect(results).toEqual([j.hash(office)]);
    }));
    it("should handle multiple unpersisted givens", () => __awaiter(void 0, void 0, void 0, function* () {
        // Find employees that match both office and user
        const specification = companyModel_1.model.given(companyModel_1.Office, _src_1.User).match((office, user, facts) => facts.ofType(companyModel_1.Employee)
            .join(employee => employee.office, office)
            .join(employee => employee.user, user)
            .select(employee => _src_1.Jinaga.hash(employee)));
        // Set up test data - employee exists but both givens are unpersisted
        const user = new _src_1.User("--- PUBLIC KEY GOES HERE ---");
        const company = new companyModel_1.Company(user, "TestCo");
        const office = new companyModel_1.Office(company, "TestOffice");
        const employee = new companyModel_1.Employee(office, user);
        const j = _src_1.JinagaTest.create({
            initialState: [company, employee] // user and office NOT included initially
        });
        // Test the execution using watch
        const results = [];
        const observer = j.watch(specification, office, user, hash => {
            results.push(hash);
        });
        yield observer.loaded();
        // Add the given facts
        yield j.fact(office);
        yield j.fact(user);
        observer.stop();
        // Verify the employee is found
        expect(results).toEqual([j.hash(employee)]);
    }));
    it("should handle mixed predecessor-successor chains", () => __awaiter(void 0, void 0, void 0, function* () {
        // Find managers in other offices of the same company's predecessors
        const specification = companyModel_1.model.given(companyModel_1.Office).match((office, facts) => office.company.predecessor().selectMany(company => company.successors(companyModel_1.Office, o => o.company)
            .selectMany(otherOffice => otherOffice.successors(companyModel_1.Manager, m => m.office))
            .select(manager => _src_1.Jinaga.hash(manager))));
        // Set up test data
        const user = new _src_1.User("--- PUBLIC KEY GOES HERE ---");
        const company = new companyModel_1.Company(user, "TestCo");
        const office = new companyModel_1.Office(company, "TestOffice");
        // Other office and manager in same company
        const otherOffice = new companyModel_1.Office(company, "OtherOffice");
        const manager = new companyModel_1.Manager(otherOffice, 12345);
        const j = _src_1.JinagaTest.create({
            initialState: [user, company, otherOffice, manager] // office NOT included initially
        });
        // Test the execution using watch
        const results = [];
        const observer = j.watch(specification, office, hash => {
            results.push(hash);
        });
        yield observer.loaded();
        // Add the starting office
        yield j.fact(office);
        observer.stop();
        // Verify the manager is found through the mixed chain
        expect(results).toEqual([j.hash(manager)]);
    }));
    it("should handle simple predecessor access with unpersisted given", () => __awaiter(void 0, void 0, void 0, function* () {
        // Simple predecessor access - single match, no selectMany - CURRENTLY FAILS!
        const specification = companyModel_1.model.given(companyModel_1.Office).match((office, facts) => office.company.predecessor());
        // Set up test data
        const user = new _src_1.User("--- PUBLIC KEY GOES HERE ---");
        const company = new companyModel_1.Company(user, "TestCo");
        const office = new companyModel_1.Office(company, "TestOffice");
        const j = _src_1.JinagaTest.create({
            initialState: [user, company] // office NOT included initially
        });
        // Test the execution using watch
        const results = [];
        const observer = j.watch(specification, office, result => {
            results.push(result);
        });
        yield observer.loaded();
        // Add the starting office
        yield j.fact(office);
        observer.stop();
        // This SHOULD work but currently doesn't due to matches.length <= 1 constraint
        expect(results.length).toBeGreaterThan(0);
    }));
});
//# sourceMappingURL=watchSpec.js.map