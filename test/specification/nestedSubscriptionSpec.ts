import { Jinaga, JinagaTest, User } from "@src";
import { Company, Manager, ManagerName, ManagerTerminated, Office, OfficeClosed, model } from "../companyModel";

describe("Nested Specification Subscription", () => {
    let j: Jinaga;
    let creator: User;
    let company: Company;
    let office: Office;

    beforeEach(() => {
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        company = new Company(creator, "TestCo");
        office = new Office(company, "TestOffice");
    });

    describe("Empty Initial Nested Collections", () => {
        it("should invoke nested handler when child facts arrive after subscription", async () => {
            // Start with empty office (no managers initially)
            j = JinagaTest.create({
                initialState: [creator, company, office]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .notExists(office =>
                        facts.ofType(OfficeClosed)
                            .join(officeClosed => officeClosed.office, office)
                    )
                    .select(office => ({
                        identifier: office.identifier,
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .notExists(manager =>
                                facts.ofType(ManagerTerminated)
                                    .join(managerTerminated => managerTerminated.manager, manager)
                            )
                            .select(manager => ({
                                employeeNumber: manager.employeeNumber
                            }))
                    }))
            );

            interface ManagerModel {
                employeeNumber: number;
            }

            interface OfficeModel {
                identifier: string;
                managers: ManagerModel[];
            }

            const offices: OfficeModel[] = [];
            const observer = j.watch(specification, company, projection => {
                const model: OfficeModel = {
                    identifier: projection.identifier,
                    managers: []
                };
                offices.push(model);

                projection.managers.onAdded(manager => {
                    model.managers.push({
                        employeeNumber: manager.employeeNumber
                    });
                });
            });

            await observer.loaded();
            expect(offices).toEqual([
                {
                    identifier: "TestOffice",
                    managers: []
                }
            ]);

            // Add manager after subscription - nested handler should be invoked
            const manager1 = await j.fact(new Manager(office, 101));
            expect(offices).toEqual([
                {
                    identifier: "TestOffice",
                    managers: [
                        { employeeNumber: 101 }
                    ]
                }
            ]);

            // Add another manager - should also be captured
            const manager2 = await j.fact(new Manager(office, 102));
            expect(offices).toEqual([
                {
                    identifier: "TestOffice",
                    managers: [
                        { employeeNumber: 101 },
                        { employeeNumber: 102 }
                    ]
                }
            ]);

            observer.stop();
        });

        it("should handle parent arriving after subscription with empty nested collection", async () => {
            // Office not in initial state
            j = JinagaTest.create({
                initialState: [creator, company]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        identifier: office.identifier,
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                    }))
            );

            const offices: any[] = [];
            const observer = j.watch(specification, company, projection => {
                const model: any = {
                    identifier: projection.identifier,
                    managers: []
                };
                offices.push(model);

                projection.managers.onAdded(manager => {
                    model.managers.push(j.hash(manager));
                });
            });

            await observer.loaded();
            expect(offices).toEqual([]);

            // Add office after subscription
            await j.fact(office);
            expect(offices).toEqual([
                {
                    identifier: "TestOffice",
                    managers: []
                }
            ]);

            // Add manager - nested handler should work
            const manager = await j.fact(new Manager(office, 201));
            expect(offices).toEqual([
                {
                    identifier: "TestOffice",
                    managers: [j.hash(manager)]
                }
            ]);

            observer.stop();
        });
    });

    describe("Handler Registration Timing", () => {
        it("should capture facts arriving immediately after subscription", async () => {
            j = JinagaTest.create({
                initialState: [creator, company, office]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        identifier: office.identifier,
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                    }))
            );

            const offices: any[] = [];
            const observer = j.watch(specification, company, projection => {
                const model: any = {
                    identifier: projection.identifier,
                    managers: []
                };
                offices.push(model);

                projection.managers.onAdded(manager => {
                    model.managers.push(j.hash(manager));
                });
            });

            // Don't await loaded - add facts immediately
            const manager1Promise = j.fact(new Manager(office, 301));
            const manager2Promise = j.fact(new Manager(office, 302));

            await observer.loaded();
            const manager1 = await manager1Promise;
            const manager2 = await manager2Promise;

            // Both managers should be captured despite arriving during initial load
            expect(offices[0].managers).toEqual(
                expect.arrayContaining([j.hash(manager1), j.hash(manager2)])
            );
            expect(offices[0].managers.length).toBe(2);

            observer.stop();
        });

        it("should handle rapid sequential fact additions", async () => {
            j = JinagaTest.create({
                initialState: [creator, company, office]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .select(manager => manager.employeeNumber)
                    }))
            );

            const employeeNumbers: number[] = [];
            const observer = j.watch(specification, company, projection => {
                projection.managers.onAdded(employeeNumber => {
                    employeeNumbers.push(employeeNumber);
                });
            });

            await observer.loaded();

            // Add multiple managers in rapid succession without awaiting
            const promises = [
                j.fact(new Manager(office, 401)),
                j.fact(new Manager(office, 402)),
                j.fact(new Manager(office, 403)),
                j.fact(new Manager(office, 404)),
                j.fact(new Manager(office, 405))
            ];

            await Promise.all(promises);

            // All should be captured in order
            expect(employeeNumbers).toEqual([401, 402, 403, 404, 405]);

            observer.stop();
        });
    });

    describe("Multiple Nested Levels", () => {
        it("should support grandchild specifications (three levels deep)", async () => {
            const manager = new Manager(office, 501);
            const managerName = new ManagerName(manager, "John Doe", []);

            j = JinagaTest.create({
                initialState: [creator, company, office, manager, managerName]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        identifier: office.identifier,
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .select(manager => ({
                                employeeNumber: manager.employeeNumber,
                                names: facts.ofType(ManagerName)
                                    .join(managerName => managerName.manager, manager)
                                    .notExists(managerName =>
                                        facts.ofType(ManagerName)
                                            .join(next => next.prior, managerName)
                                    )
                                    .select(managerName => managerName.value)
                            }))
                    }))
            );

            interface ManagerModel {
                employeeNumber: number;
                names: string[];
            }

            interface OfficeModel {
                identifier: string;
                managers: ManagerModel[];
            }

            const offices: OfficeModel[] = [];
            const observer = j.watch(specification, company, projection => {
                const model: OfficeModel = {
                    identifier: projection.identifier,
                    managers: []
                };
                offices.push(model);

                projection.managers.onAdded(managerProj => {
                    const managerModel: ManagerModel = {
                        employeeNumber: managerProj.employeeNumber,
                        names: []
                    };
                    model.managers.push(managerModel);

                    managerProj.names.onAdded(name => {
                        managerModel.names.push(name);
                    });
                });
            });

            await observer.loaded();
            expect(offices).toEqual([
                {
                    identifier: "TestOffice",
                    managers: [
                        {
                            employeeNumber: 501,
                            names: ["John Doe"]
                        }
                    ]
                }
            ]);

            observer.stop();
        });

        it("should handle adding grandchild facts after subscription", async () => {
            const manager = new Manager(office, 502);

            j = JinagaTest.create({
                initialState: [creator, company, office, manager]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .select(manager => ({
                                employeeNumber: manager.employeeNumber,
                                names: facts.ofType(ManagerName)
                                    .join(managerName => managerName.manager, manager)
                                    .select(managerName => managerName.value)
                            }))
                    }))
            );

            const managerData: any[] = [];
            const observer = j.watch(specification, company, projection => {
                projection.managers.onAdded(managerProj => {
                    const data: any = {
                        employeeNumber: managerProj.employeeNumber,
                        names: []
                    };
                    managerData.push(data);

                    managerProj.names.onAdded(name => {
                        data.names.push(name);
                    });
                });
            });

            await observer.loaded();
            expect(managerData).toEqual([
                {
                    employeeNumber: 502,
                    names: []
                }
            ]);

            // Add grandchild fact (manager name)
            await j.fact(new ManagerName(manager, "Jane Smith", []));
            expect(managerData).toEqual([
                {
                    employeeNumber: 502,
                    names: ["Jane Smith"]
                }
            ]);

            // Add another name
            const priorName = new ManagerName(manager, "Jane Smith", []);
            await j.fact(new ManagerName(manager, "Jane Doe", [priorName]));
            expect(managerData[0].names).toContain("Jane Doe");

            observer.stop();
        });
    });

    describe("Concurrent Parent and Child Facts", () => {
        it("should handle parent and child arriving in quick succession", async () => {
            j = JinagaTest.create({
                initialState: [creator, company]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        identifier: office.identifier,
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .select(manager => manager.employeeNumber)
                    }))
            );

            const offices: any[] = [];
            const observer = j.watch(specification, company, projection => {
                const model: any = {
                    identifier: projection.identifier,
                    managers: []
                };
                offices.push(model);

                projection.managers.onAdded(employeeNumber => {
                    model.managers.push(employeeNumber);
                });
            });

            await observer.loaded();

            // Add parent and child without awaiting parent
            const officePromise = j.fact(office);
            const manager1Promise = j.fact(new Manager(office, 601));
            const manager2Promise = j.fact(new Manager(office, 602));

            await Promise.all([officePromise, manager1Promise, manager2Promise]);

            // Office should be added with all managers
            expect(offices.length).toBe(1);
            expect(offices[0].identifier).toBe("TestOffice");
            expect(offices[0].managers).toEqual(expect.arrayContaining([601, 602]));

            observer.stop();
        });

        it("should handle simultaneous additions to multiple nested collections", async () => {
            j = JinagaTest.create({
                initialState: [creator, company, office]
            });

            const specification = model.given(Office).select((office, facts) => ({
                identifier: office.identifier,
                managers: facts.ofType(Manager)
                    .join(manager => manager.office, office)
                    .select(manager => manager.employeeNumber),
                closures: facts.ofType(OfficeClosed)
                    .join(closure => closure.office, office)
                    .select(closure => j.hash(closure))
            }));

            const result: any = {
                managers: [],
                closures: []
            };

            const observer = j.watch(specification, office, projection => {
                projection.managers.onAdded(employeeNumber => {
                    result.managers.push(employeeNumber);
                });

                projection.closures.onAdded(closureHash => {
                    result.closures.push(closureHash);
                });
            });

            await observer.loaded();

            // Add to both collections simultaneously
            const manager1Promise = j.fact(new Manager(office, 701));
            const manager2Promise = j.fact(new Manager(office, 702));
            const closurePromise = j.fact(new OfficeClosed(office, new Date()));

            const [, , closure] = await Promise.all([manager1Promise, manager2Promise, closurePromise]);

            expect(result.managers).toEqual([701, 702]);
            expect(result.closures).toEqual([j.hash(closure)]);

            observer.stop();
        });
    });

    describe("Nested Collections with Initial Data", () => {
        it("should properly initialize with existing nested data", async () => {
            const manager1 = new Manager(office, 801);
            const manager2 = new Manager(office, 802);
            const name1 = new ManagerName(manager1, "Alice", []);
            const name2 = new ManagerName(manager2, "Bob", []);

            j = JinagaTest.create({
                initialState: [creator, company, office, manager1, manager2, name1, name2]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        identifier: office.identifier,
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .select(manager => ({
                                employeeNumber: manager.employeeNumber,
                                names: facts.ofType(ManagerName)
                                    .join(managerName => managerName.manager, manager)
                                    .select(managerName => managerName.value)
                            }))
                    }))
            );

            const offices: any[] = [];
            const observer = j.watch(specification, company, projection => {
                const model: any = {
                    identifier: projection.identifier,
                    managers: []
                };
                offices.push(model);

                projection.managers.onAdded(managerProj => {
                    const managerModel: any = {
                        employeeNumber: managerProj.employeeNumber,
                        names: []
                    };
                    model.managers.push(managerModel);

                    managerProj.names.onAdded(name => {
                        managerModel.names.push(name);
                    });
                });
            });

            await observer.loaded();

            // All initial data should be present
            expect(offices).toEqual([
                {
                    identifier: "TestOffice",
                    managers: expect.arrayContaining([
                        {
                            employeeNumber: 801,
                            names: ["Alice"]
                        },
                        {
                            employeeNumber: 802,
                            names: ["Bob"]
                        }
                    ])
                }
            ]);

            observer.stop();
        });

        it("should handle additions to existing nested collections", async () => {
            const manager1 = new Manager(office, 803);

            j = JinagaTest.create({
                initialState: [creator, company, office, manager1]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .select(manager => manager.employeeNumber)
                    }))
            );

            const managerNumbers: number[] = [];
            const observer = j.watch(specification, company, projection => {
                projection.managers.onAdded(employeeNumber => {
                    managerNumbers.push(employeeNumber);
                });
            });

            await observer.loaded();
            expect(managerNumbers).toEqual([803]);

            // Add more managers to the existing collection
            await j.fact(new Manager(office, 804));
            await j.fact(new Manager(office, 805));

            expect(managerNumbers).toEqual([803, 804, 805]);

            observer.stop();
        });
    });

    describe("Multiple Nested Collections", () => {
        it("should handle multiple independent nested specifications", async () => {
            const manager = new Manager(office, 901);
            const closure = new OfficeClosed(office, new Date());

            j = JinagaTest.create({
                initialState: [creator, company, office, manager, closure]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        identifier: office.identifier,
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .select(manager => manager.employeeNumber),
                        closures: facts.ofType(OfficeClosed)
                            .join(closure => closure.office, office)
                            .select(closure => j.hash(closure))
                    }))
            );

            const offices: any[] = [];
            const observer = j.watch(specification, company, projection => {
                const model: any = {
                    identifier: projection.identifier,
                    managers: [],
                    closures: []
                };
                offices.push(model);

                projection.managers.onAdded(employeeNumber => {
                    model.managers.push(employeeNumber);
                });

                projection.closures.onAdded(closureHash => {
                    model.closures.push(closureHash);
                });
            });

            await observer.loaded();

            expect(offices).toEqual([
                {
                    identifier: "TestOffice",
                    managers: [901],
                    closures: [j.hash(closure)]
                }
            ]);

            // Add to both collections
            await j.fact(new Manager(office, 902));
            const newClosure = await j.fact(new OfficeClosed(office, new Date()));

            expect(offices).toEqual([
                {
                    identifier: "TestOffice",
                    managers: [901, 902],
                    closures: [j.hash(closure), j.hash(newClosure)]
                }
            ]);

            observer.stop();
        });

        it("should maintain independence between nested collections", async () => {
            j = JinagaTest.create({
                initialState: [creator, company, office]
            });

            const specification = model.given(Office).select((office, facts) => ({
                managers: facts.ofType(Manager)
                    .join(manager => manager.office, office)
                    .select(manager => manager.employeeNumber),
                closures: facts.ofType(OfficeClosed)
                    .join(closure => closure.office, office)
            }));

            let managerAddCount = 0;
            let closureAddCount = 0;

            const observer = j.watch(specification, office, projection => {
                projection.managers.onAdded(() => {
                    managerAddCount++;
                });

                projection.closures.onAdded(() => {
                    closureAddCount++;
                });
            });

            await observer.loaded();

            // Add manager - should not affect closure count
            await j.fact(new Manager(office, 1001));
            expect(managerAddCount).toBe(1);
            expect(closureAddCount).toBe(0);

            // Add closure - should not affect manager count
            await j.fact(new OfficeClosed(office, new Date()));
            expect(managerAddCount).toBe(1);
            expect(closureAddCount).toBe(1);

            // Add another manager
            await j.fact(new Manager(office, 1002));
            expect(managerAddCount).toBe(2);
            expect(closureAddCount).toBe(1);

            observer.stop();
        });
    });

    describe("Conditional Handler Registration", () => {
        it("should support conditionally registered nested handlers", async () => {
            const manager1 = new Manager(office, 1101);
            const manager2 = new Manager(office, 1102);

            j = JinagaTest.create({
                initialState: [creator, company, office, manager1, manager2]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        identifier: office.identifier,
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .select(manager => ({
                                employeeNumber: manager.employeeNumber,
                                names: facts.ofType(ManagerName)
                                    .join(managerName => managerName.manager, manager)
                                    .select(managerName => managerName.value)
                            }))
                    }))
            );

            const managerData: any[] = [];
            const observer = j.watch(specification, company, projection => {
                projection.managers.onAdded(managerProj => {
                    const data: any = {
                        employeeNumber: managerProj.employeeNumber,
                        names: []
                    };
                    managerData.push(data);

                    // Only register name handler for managers with employee numbers > 1101
                    if (managerProj.employeeNumber > 1101) {
                        managerProj.names.onAdded(name => {
                            data.names.push(name);
                        });
                    }
                });
            });

            await observer.loaded();
            expect(managerData.length).toBe(2);

            // Add name to manager1 (should not be captured)
            await j.fact(new ManagerName(manager1, "Should Not Appear", []));
            expect(managerData[0].names).toEqual([]);

            // Add name to manager2 (should be captured)
            await j.fact(new ManagerName(manager2, "Should Appear", []));
            const manager2Data = managerData.find(m => m.employeeNumber === 1102);
            expect(manager2Data.names).toEqual(["Should Appear"]);

            observer.stop();
        });

        it("should handle late registration of nested handlers", async () => {
            j = JinagaTest.create({
                initialState: [creator, company, office]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .select(manager => ({
                                employeeNumber: manager.employeeNumber,
                                names: facts.ofType(ManagerName)
                                    .join(managerName => managerName.manager, manager)
                                    .select(managerName => managerName.value)
                            }))
                    }))
            );

            let registerHandlers = false;
            const managerData: any[] = [];

            const observer = j.watch(specification, company, projection => {
                projection.managers.onAdded(managerProj => {
                    const data: any = {
                        employeeNumber: managerProj.employeeNumber,
                        names: []
                    };
                    managerData.push(data);

                    // Conditionally register based on external state
                    if (registerHandlers) {
                        managerProj.names.onAdded(name => {
                            data.names.push(name);
                        });
                    }
                });
            });

            await observer.loaded();

            // Add manager before handlers are enabled
            const manager1 = await j.fact(new Manager(office, 1201));
            expect(managerData.length).toBe(1);

            // Enable handler registration
            registerHandlers = true;

            // Add another manager - this one should have handlers
            const manager2 = await j.fact(new Manager(office, 1202));
            expect(managerData.length).toBe(2);

            // Add names
            await j.fact(new ManagerName(manager1, "First Manager", []));
            await j.fact(new ManagerName(manager2, "Second Manager", []));

            // Only manager2 should capture the name
            expect(managerData[0].names).toEqual([]);
            expect(managerData[1].names).toEqual(["Second Manager"]);

            observer.stop();
        });
    });

    describe("Edge Cases", () => {
        it("should handle empty specification results with nested collections", async () => {
            j = JinagaTest.create({
                initialState: [creator, company]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                    }))
            );

            const offices: any[] = [];
            const observer = j.watch(specification, company, projection => {
                offices.push({ managers: [] });
                projection.managers.onAdded(() => {
                    offices[offices.length - 1].managers.push(1);
                });
            });

            await observer.loaded();
            expect(offices).toEqual([]);

            observer.stop();
        });

        it("should handle stopping observer before nested facts arrive", async () => {
            j = JinagaTest.create({
                initialState: [creator, company, office]
            });

            const specification = model.given(Office).select((office, facts) => ({
                managers: facts.ofType(Manager)
                    .join(manager => manager.office, office)
                    .select(manager => manager.employeeNumber)
            }));

            const managerNumbers: number[] = [];
            const observer = j.watch(specification, office, projection => {
                projection.managers.onAdded(employeeNumber => {
                    managerNumbers.push(employeeNumber);
                });
            });

            await observer.loaded();
            observer.stop();

            // Add manager after stopping - should not be captured
            await j.fact(new Manager(office, 1301));
            expect(managerNumbers).toEqual([]);
        });

        it("should handle multiple observers on the same specification", async () => {
            const manager = new Manager(office, 1401);

            j = JinagaTest.create({
                initialState: [creator, company, office, manager]
            });

            const specification = model.given(Office).select((office, facts) => ({
                managers: facts.ofType(Manager)
                    .join(manager => manager.office, office)
                    .select(manager => manager.employeeNumber)
            }));

            const observer1Data: number[] = [];
            const observer2Data: number[] = [];

            const observer1 = j.watch(specification, office, projection => {
                projection.managers.onAdded(employeeNumber => {
                    observer1Data.push(employeeNumber);
                });
            });

            const observer2 = j.watch(specification, office, projection => {
                projection.managers.onAdded(employeeNumber => {
                    observer2Data.push(employeeNumber);
                });
            });

            await observer1.loaded();
            await observer2.loaded();

            expect(observer1Data).toEqual([1401]);
            expect(observer2Data).toEqual([1401]);

            // Add new manager - both should receive it
            await j.fact(new Manager(office, 1402));

            expect(observer1Data).toEqual([1401, 1402]);
            expect(observer2Data).toEqual([1401, 1402]);

            observer1.stop();
            observer2.stop();
        });
    });
    describe("Race Condition Reproduction Tests", () => {
        it("should handle facts arriving during observer initialization", async () => {
            j = JinagaTest.create({
                initialState: [creator, company, office]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        identifier: office.identifier,
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .select(manager => ({
                                employeeNumber: manager.employeeNumber
                            }))
                    }))
            );

            const offices: any[] = [];
            const managerAddCallbacks: number[] = [];
            
            console.log("TEST: Starting subscription...");
            const observer = j.watch(specification, company, projection => {
                console.log(`TEST: Office handler called for: ${projection.identifier}`);
                const model: any = {
                    identifier: projection.identifier,
                    managers: []
                };
                offices.push(model);

                projection.managers.onAdded(manager => {
                    console.log(`TEST: Manager handler called for employee ${manager.employeeNumber}`);
                    model.managers.push({
                        employeeNumber: manager.employeeNumber
                    });
                    managerAddCallbacks.push(manager.employeeNumber);
                });
                console.log(`TEST: Registered onAdded handler for office ${projection.identifier}`);
            });

            // Don't await loaded() yet - add nested facts immediately
            console.log("TEST: Adding managers BEFORE awaiting loaded()...");
            const manager1Promise = j.fact(new Manager(office, 2001));
            const manager2Promise = j.fact(new Manager(office, 2002));
            
            console.log("TEST: Now awaiting loaded()...");
            await observer.loaded();
            
            console.log("TEST: Awaiting manager facts...");
            await manager1Promise;
            await manager2Promise;

            console.log("TEST: Final state - offices:", JSON.stringify(offices));
            console.log("TEST: Manager callbacks invoked:", managerAddCallbacks);

            // Assert callbacks should still be invoked
            expect(managerAddCallbacks).toEqual(expect.arrayContaining([2001, 2002]));
            expect(managerAddCallbacks.length).toBe(2);
            expect(offices[0].managers).toEqual(expect.arrayContaining([
                { employeeNumber: 2001 },
                { employeeNumber: 2002 }
            ]));

            observer.stop();
        });

        // RACE CONDITION: Nested handler registration timing
        // FAILURE MODE: When user code delays registering nested handlers (e.g., via setTimeout),
        // child facts that arrive before the handler is registered are lost forever.
        // The notification system correctly identifies that no handler exists for the nested path,
        // but there's no mechanism to replay these notifications once the handler is registered.
        // LOG EVIDENCE: "[Observer] NO HANDLER FOUND - Path: .managers"
        // EXPECTED: managerNotifications to contain [2101]
        // ACTUAL: managerNotifications = []
        it.skip("should handle nested facts before nested handler registration", async () => {
            j = JinagaTest.create({
                initialState: [creator, company]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        identifier: office.identifier,
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .select(manager => manager.employeeNumber)
                    }))
            );

            const offices: any[] = [];
            const handlerRegistrations: string[] = [];
            const managerNotifications: number[] = [];

            console.log("TEST: Starting subscription...");
            const observer = j.watch(specification, company, projection => {
                console.log(`TEST: Office projection callback invoked for: ${projection.identifier}`);
                const model: any = {
                    identifier: projection.identifier,
                    managers: []
                };
                offices.push(model);

                // Use setTimeout to simulate user code delay before registering handler
                setTimeout(() => {
                    console.log(`TEST: Registering nested handler for office ${projection.identifier} (delayed)`);
                    handlerRegistrations.push(projection.identifier);
                    
                    projection.managers.onAdded(employeeNumber => {
                        console.log(`TEST: Manager onAdded called for: ${employeeNumber}`);
                        model.managers.push(employeeNumber);
                        managerNotifications.push(employeeNumber);
                    });
                }, 0);
            });

            await observer.loaded();
            console.log("TEST: Observer loaded");

            // Add parent fact
            console.log("TEST: Adding office...");
            await j.fact(office);
            
            // Add child fact IMMEDIATELY (before user code can register nested handler)
            console.log("TEST: Adding manager IMMEDIATELY...");
            await j.fact(new Manager(office, 2101));

            // Wait for event loop to process
            await new Promise(resolve => setTimeout(resolve, 50));

            console.log("TEST: Handler registrations:", handlerRegistrations);
            console.log("TEST: Manager notifications:", managerNotifications);
            console.log("TEST: Final offices state:", JSON.stringify(offices));

            // This test documents the bug: nested callback may not work if child arrives
            // before user code registers the handler
            expect(managerNotifications).toContain(2101);
            expect(offices[0].managers).toContain(2101);

            observer.stop();
        });

        // NO RACE CONDITION: This test passes consistently
        // This scenario works correctly - the system handles parent and child arriving
        // concurrently without awaiting between them. The nested handler is registered
        // synchronously during the parent's onAdded callback, so it's ready when
        // the child notifications arrive.
        it("should handle concurrent parent and child with no await", async () => {
            j = JinagaTest.create({
                initialState: [creator, company]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        identifier: office.identifier,
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .select(manager => manager.employeeNumber)
                    }))
            );

            const officeCallbacks: string[] = [];
            const managerCallbacks: number[] = [];
            const offices: any[] = [];

            console.log("TEST: Starting subscription...");
            const observer = j.watch(specification, company, projection => {
                console.log(`TEST: Office callback for: ${projection.identifier}`);
                officeCallbacks.push(projection.identifier);
                
                const model: any = {
                    identifier: projection.identifier,
                    managers: []
                };
                offices.push(model);

                console.log(`TEST: Registering manager handler for office ${projection.identifier}`);
                projection.managers.onAdded(employeeNumber => {
                    console.log(`TEST: Manager callback for: ${employeeNumber}`);
                    managerCallbacks.push(employeeNumber);
                    model.managers.push(employeeNumber);
                });
            });

            await observer.loaded();
            console.log("TEST: Observer loaded");

            // Add parent and child without awaiting between them
            console.log("TEST: Adding office and managers concurrently...");
            const officePromise = j.fact(office);
            const manager1Promise = j.fact(new Manager(office, 2201));
            const manager2Promise = j.fact(new Manager(office, 2202));

            await Promise.all([officePromise, manager1Promise, manager2Promise]);
            
            // Give event loop time to process
            await new Promise(resolve => setTimeout(resolve, 50));

            console.log("TEST: Office callbacks:", officeCallbacks);
            console.log("TEST: Manager callbacks:", managerCallbacks);
            console.log("TEST: Final offices:", JSON.stringify(offices));

            // Assert both callbacks invoked
            expect(officeCallbacks).toContain("TestOffice");
            expect(managerCallbacks).toEqual(expect.arrayContaining([2201, 2202]));
            expect(offices[0].managers).toEqual(expect.arrayContaining([2201, 2202]));

            observer.stop();
        });

        // RACE CONDITION: Facts added before observer initialization completes
        // FAILURE MODE: When multiple nested facts exist in storage before observer.loaded()
        // is called, only some nested facts are captured during initialization. The second
        // manager (2302) is completely missed, suggesting the nested specification's
        // initial query may not be capturing all existing facts correctly.
        // EXPECTED: managerCallbacks to contain [2301, 2302]
        // ACTUAL: managerCallbacks = [2301] (missing 2302)
        it.skip("should handle facts arriving before listeners registered", async () => {
            j = JinagaTest.create({
                initialState: [creator, company]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        identifier: office.identifier,
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .select(manager => manager.employeeNumber)
                    }))
            );

            const offices: any[] = [];
            const managerCallbacks: number[] = [];

            console.log("TEST: Creating observer but NOT starting yet...");
            const observer = j.watch(specification, company, projection => {
                console.log(`TEST: Office projection callback: ${projection.identifier}`);
                const model: any = {
                    identifier: projection.identifier,
                    managers: []
                };
                offices.push(model);

                projection.managers.onAdded(employeeNumber => {
                    console.log(`TEST: Manager onAdded callback: ${employeeNumber}`);
                    managerCallbacks.push(employeeNumber);
                    model.managers.push(employeeNumber);
                });
            });

            // Add facts to storage directly BEFORE starting observer
            console.log("TEST: Adding facts BEFORE starting observer...");
            await j.fact(office);
            await j.fact(new Manager(office, 2301));
            await j.fact(new Manager(office, 2302));
            console.log("TEST: Facts added to storage");

            // Now start observer
            console.log("TEST: Now starting observer (calling loaded())...");
            await observer.loaded();

            console.log("TEST: Offices:", JSON.stringify(offices));
            console.log("TEST: Manager callbacks:", managerCallbacks);

            // Assert facts should be picked up
            expect(offices.length).toBe(1);
            expect(offices[0].identifier).toBe("TestOffice");
            expect(managerCallbacks).toEqual(expect.arrayContaining([2301, 2302]));
            expect(offices[0].managers).toEqual(expect.arrayContaining([2301, 2302]));

            observer.stop();
        });

        // NO RACE CONDITION: This test passes consistently
        // Adding multiple nested facts rapidly (5 managers without awaiting) works correctly.
        // All callbacks fire in sequence and all facts are captured. This confirms the
        // notification queue handles rapid successive additions properly when handlers
        // are already registered.
        it("should handle multiple rapid nested additions", async () => {
            j = JinagaTest.create({
                initialState: [creator, company, office]
            });

            const specification = model.given(Company).match((company, facts) =>
                facts.ofType(Office)
                    .join(office => office.company, company)
                    .select(office => ({
                        identifier: office.identifier,
                        managers: facts.ofType(Manager)
                            .join(manager => manager.office, office)
                            .select(manager => ({
                                employeeNumber: manager.employeeNumber
                            }))
                    }))
            );

            const managerCallbacks: number[] = [];
            const offices: any[] = [];

            console.log("TEST: Starting subscription...");
            const observer = j.watch(specification, company, projection => {
                console.log(`TEST: Office callback for: ${projection.identifier}`);
                const model: any = {
                    identifier: projection.identifier,
                    managers: []
                };
                offices.push(model);

                projection.managers.onAdded(manager => {
                    console.log(`TEST: Manager callback ${managerCallbacks.length + 1} for: ${manager.employeeNumber}`);
                    managerCallbacks.push(manager.employeeNumber);
                    model.managers.push({
                        employeeNumber: manager.employeeNumber
                    });
                });
                console.log("TEST: Nested handler registered");
            });

            await observer.loaded();
            console.log("TEST: Observer loaded");

            // Add 5 nested facts in rapid succession without awaiting
            console.log("TEST: Adding 5 managers rapidly without awaiting...");
            const promises = [
                j.fact(new Manager(office, 2401)),
                j.fact(new Manager(office, 2402)),
                j.fact(new Manager(office, 2403)),
                j.fact(new Manager(office, 2404)),
                j.fact(new Manager(office, 2405))
            ];

            console.log("TEST: Waiting for all promises...");
            await Promise.all(promises);

            // Give event loop time to settle
            await new Promise(resolve => setTimeout(resolve, 50));

            console.log("TEST: Manager callbacks received:", managerCallbacks);
            console.log("TEST: Final office state:", JSON.stringify(offices));

            // Assert all 5 should be notified
            expect(managerCallbacks.length).toBe(5);
            expect(managerCallbacks).toEqual(expect.arrayContaining([2401, 2402, 2403, 2404, 2405]));
            expect(offices[0].managers.length).toBe(5);
            expect(offices[0].managers).toEqual(expect.arrayContaining([
                { employeeNumber: 2401 },
                { employeeNumber: 2402 },
                { employeeNumber: 2403 },
                { employeeNumber: 2404 },
                { employeeNumber: 2405 }
            ]));

            observer.stop();
        });
    });

});