import { Jinaga, JinagaTest } from "../../src";
import { Company, Manager, ManagerName, ManagerTerminated, model, Office, OfficeClosed, OfficeReopened, President, User } from "./model";

describe("specification watch", () => {
    let creator: User;
    let emptyCompany: Company;
    let company: Company;
    let office: Office;
    let closedOffice: Office;
    let closure: OfficeClosed;
    let j: Jinaga;

    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        emptyCompany = new Company(creator, "EmptyCo");
        company = new Company(creator, "TestCo");
        office = new Office(company, "TestOffice");
        closedOffice = new Office(company, "ClosedOffice");
        closure = new OfficeClosed(closedOffice, new Date());
        j = JinagaTest.create({
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

    it("should return no results when empty", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const offices: string[] = [];
        const officeObserver = j.watch(specification, emptyCompany, office => {
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
        const officeObserver = j.watch(specification, company, office => {
            offices.push(j.hash(office));
        });

        await officeObserver.initialized();
        await officeObserver.stop();

        expect(offices).toEqual([j.hash(office), j.hash(closedOffice)]);
    });

    it("should notify results when added", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const offices: string[] = [];
        const officeObserver = j.watch(specification, company, office => {
            offices.push(j.hash(office));
        });

        await officeObserver.initialized();
        const newOffice = new Office(company, "NewOffice");
        await j.fact(newOffice);
        
        await officeObserver.stop();

        expect(offices).toEqual([j.hash(office), j.hash(closedOffice), j.hash(newOffice)]);
    });

    it("should not notify results related to a different starting point", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const offices: string[] = [];
        const officeObserver = j.watch(specification, company, office => {
            offices.push(j.hash(office));
        });

        await officeObserver.initialized();
        const newOfficeInOtherCompany = new Office(emptyCompany, "OfficeInOtherCompany");
        await j.fact(newOfficeInOtherCompany);

        await officeObserver.stop();

        // The array does not contain the new office.
        expect(offices).toEqual([j.hash(office), j.hash(closedOffice)]);
    });

    it("should notify results when removed", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .notExists(office =>
                    facts.ofType(OfficeClosed)
                        .join(officeClosed => officeClosed.office, office)
                )
        );

        const offices: string[] = [];
        const officeObserver = j.watch(specification, company, office => {
            const hash = j.hash(office);
            offices.push(hash);
            return () => {
                offices.splice(offices.indexOf(hash), 1);
            }
        });

        await officeObserver.initialized();
        await j.fact(new OfficeClosed(office, new Date()));
        
        await officeObserver.stop();

        expect(offices).toEqual([]);
    });

    it("should execute nested existial conditions", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .notExists(office =>
                    facts.ofType(OfficeClosed)
                        .join(officeClosed => officeClosed.office, office)
                        .notExists(officeClosed =>
                            facts.ofType(OfficeReopened)
                                .join(officeReopened => officeReopened.officeClosed, officeClosed)
                        )
                )
        );

        const offices: string[] = [];
        const officeObserver = j.watch(specification, company, office => {
            const hash = j.hash(office);
            offices.push(hash);
            return () => {
                offices.splice(offices.indexOf(hash), 1);
            }
        });

        await officeObserver.initialized();

        await officeObserver.stop();

        expect(offices).toEqual([j.hash(office)]);
    });

    it("should notify results when re-added", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .notExists(office =>
                    facts.ofType(OfficeClosed)
                        .join(officeClosed => officeClosed.office, office)
                        .notExists(officeClosed =>
                            facts.ofType(OfficeReopened)
                                .join(officeReopened => officeReopened.officeClosed, officeClosed)
                        )
                )
        );

        const offices: string[] = [];
        const officeObserver = j.watch(specification, company, office => {
            const hash = j.hash(office);
            offices.push(hash);
            return () => {
                offices.splice(offices.indexOf(hash), 1);
            }
        });

        await officeObserver.initialized();
        await j.fact(new OfficeReopened(closure));

        await officeObserver.stop();

        expect(offices).toEqual([j.hash(office), j.hash(closedOffice)]);
    });

    it("should notify child results when added", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .notExists(office =>
                    facts.ofType(OfficeClosed)
                        .join(officeClosed => officeClosed.office, office)
                        .notExists(officeClosed =>
                            facts.ofType(OfficeReopened)
                                .join(officeReopened => officeReopened.officeClosed, officeClosed)
                        )
                )
                .select(office => ({
                    identifier: office.identifier,
                    president: facts.ofType(President)
                        .join(president => president.office, office)
                }))
        );

        const offices: {
            identifier: string,
            president?: string
        }[] = [];
        const officeObserver = j.watch(specification, company, office => {
            const model = {
                identifier: office.identifier,
                president: undefined as string | undefined
            };
            offices.push(model);
            office.president.onAdded(president => {
                model.president = j.hash(president);
            });
        });

        await officeObserver.initialized();
        expect(offices).toEqual([
            {
                identifier: office.identifier,
                president: undefined
            }
        ]);

        const newPresident = new President(office, new User("--- PRESIDENT PUBLIC KEY ---"));
        await j.fact(newPresident);
        await officeObserver.stop();

        expect(offices).toEqual([
            {
                identifier: office.identifier,
                president: j.hash(newPresident)
            }
        ]);
    });

    it("should notify when manager and name added", async () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .notExists(office =>
                    facts.ofType(OfficeClosed)
                        .join(officeClosed => officeClosed.office, office)
                )
                .select(office => ({
                    office: office,
                    managers: facts.ofType(Manager)
                        .join(manager => manager.office, office)
                        .notExists(manager =>
                            facts.ofType(ManagerTerminated)
                                .join(managerTerminated => managerTerminated.manager, manager)
                        )
                        .select(manager => ({
                            manager: manager,
                            name: facts.ofType(ManagerName)
                                .join(managerName => managerName.manager, manager)
                                .notExists(managerName =>
                                    facts.ofType(ManagerName)
                                        .join(next => next.prior, managerName)
                                )
                        }))
                }))
        );

        interface ManagerModel {
            employeeNumber: number;
            name?: string;
        }

        interface OfficeModel {
            identifier: string;
            managers: ManagerModel[];
        }

        const offices: OfficeModel[] = [];
        const officeObserver = j.watch(specification, company, office => {
            const model: OfficeModel = {
                identifier: office.office.identifier,
                managers: []
            };
            offices.push(model);
            office.managers.onAdded(manager => {
                const managerModel: ManagerModel = {
                    employeeNumber: manager.manager.employeeNumber,
                    name: undefined
                };
                model.managers.push(managerModel);
                manager.name.onAdded(name => {
                    managerModel.name = name.value;
                });
            });
        });

        await officeObserver.initialized();
        expect(offices).toEqual([
            {
                identifier: "TestOffice",
                managers: []
            }
        ]);
        const manager = await j.fact(new Manager(office, 123));
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
        await j.fact(new ManagerName(manager, "Test Manager", []));
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

        await officeObserver.stop();
    });
});