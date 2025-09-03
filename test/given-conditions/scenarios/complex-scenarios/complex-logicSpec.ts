import { dehydrateFact, FactReference, MemoryStore, SpecificationParser } from "@src";
import { Administrator, Company, Employee, Manager, Office, OfficeClosed, OfficeReopened, User } from "../../../companyModel";
import { createComplexCompanyScenario } from "../../setup/test-data-factories";

describe("Given Conditions - Complex Logic", () => {
    let store: MemoryStore;
    let users: User[];
    let companies: Company[];
    let offices: Office[];
    let closures: OfficeClosed[];
    let reopenings: OfficeReopened[];
    let administrators: Administrator[];
    let managers: Manager[];
    let employees: Employee[];

    beforeEach(async () => {
        ({ users, companies, offices, closures, reopenings, administrators, managers, employees } = await createComplexCompanyScenario());

        // Create memory store and populate with test data
        store = new MemoryStore();

        // Save all facts to the store
        const allFacts = [
            ...users,
            ...companies,
            ...offices,
            ...closures,
            ...reopenings,
            ...administrators,
            ...managers,
            ...employees
        ];

        for (const fact of allFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }
    });

    it("should handle complex AND combinations of multiple existential conditions", async () => {
        // Specification requiring office to be closed AND have admin AND have manager
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    !E {
                        reopening: Office.Reopened [
                            reopening = closure
                        ]
                    }
                    E {
                        admin: Administrator [
                            admin.company = closure.office.company
                        ]
                    }
                    E {
                        manager: Manager [
                            manager.office = office
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Find office that meets all conditions
        const qualifyingOffice = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            !reopenings.some(reopening => reopening.officeClosed.office === office) &&
            administrators.some(admin => admin.company === office.company) &&
            managers.some(manager => manager.office === office)
        );

        if (qualifyingOffice) {
            const officeRef: FactReference = dehydrateFact(qualifyingOffice)[0];

            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(1);
        }
    });

    it("should validate complex condition evaluation with multiple branches", async () => {
        // Specification with conditions that branch in different ways
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    E {
                        admin: Administrator [
                            admin.company = closure.office.company
                            E {
                                employee: Employee [
                                    employee.office = closure.office
                                    employee.user = admin.user
                                ]
                            }
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Find office where admin is also an employee
        const qualifyingOffice = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            administrators.some(admin =>
                admin.company === office.company &&
                employees.some(employee =>
                    employee.office === office &&
                    employee.user === admin.user
                )
            )
        );

        if (qualifyingOffice) {
            const officeRef: FactReference = dehydrateFact(qualifyingOffice)[0];

            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(1);
        }
    });

    it("should handle conditions with multiple alternative paths", async () => {
        // Specification that allows office to qualify through different paths
        // (Note: This tests the logical structure, though the parser may not support explicit OR)

        // Test two different specifications that represent alternative qualification paths

        // Path 1: Office is closed and has admin
        const spec1 = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    E {
                        admin: Administrator [
                            admin.company = closure.office.company
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Path 2: Office has manager but is not closed
        const spec2 = new SpecificationParser(`
            (office: Office [!E {
                closure: Office.Closed [
                    closure = office
                ]
            } E {
                manager: Manager [
                    manager.office = office
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Test offices that qualify through path 1
        const path1Office = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            administrators.some(admin => admin.company === office.company)
        );

        if (path1Office) {
            const officeRef: FactReference = dehydrateFact(path1Office)[0];

            const results1 = await store.read([officeRef], spec1);
            expect(results1.length).toBe(1);

            // Should not qualify for path 2
            const results2 = await store.read([officeRef], spec2);
            expect(results2.length).toBe(0);
        }

        // Test offices that qualify through path 2
        const path2Office = offices.find(office =>
            !closures.some(closure => closure.office === office) &&
            managers.some(manager => manager.office === office)
        );

        if (path2Office) {
            const officeRef: FactReference = dehydrateFact(path2Office)[0];

            const results2 = await store.read([officeRef], spec2);
            expect(results2.length).toBe(1);

            // Should not qualify for path 1
            const results1 = await store.read([officeRef], spec1);
            expect(results1.length).toBe(0);
        }
    });

    it("should validate complex nested condition logic with mixed requirements", async () => {
        // Specification requiring: closed office with admin but no manager, OR open office with manager
        // This tests complex logical combinations

        const spec1 = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    E {
                        admin: Administrator [
                            admin.company = closure.office.company
                        ]
                    }
                    !E {
                        manager: Manager [
                            manager.office = office
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        const spec2 = new SpecificationParser(`
            (office: Office [!E {
                closure: Office.Closed [
                    closure = office
                ]
            } E {
                manager: Manager [
                    manager.office = office
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Test scenario 1: closed office with admin but no manager
        const scenario1Office = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            administrators.some(admin => admin.company === office.company) &&
            !managers.some(manager => manager.office === office)
        );

        if (scenario1Office) {
            const officeRef: FactReference = dehydrateFact(scenario1Office)[0];

            const results1 = await store.read([officeRef], spec1);
            expect(results1.length).toBe(1);

            const results2 = await store.read([officeRef], spec2);
            expect(results2.length).toBe(0);
        }

        // Test scenario 2: open office with manager
        const scenario2Office = offices.find(office =>
            !closures.some(closure => closure.office === office) &&
            managers.some(manager => manager.office === office)
        );

        if (scenario2Office) {
            const officeRef: FactReference = dehydrateFact(scenario2Office)[0];

            const results2 = await store.read([officeRef], spec2);
            expect(results2.length).toBe(1);

            const results1 = await store.read([officeRef], spec1);
            expect(results1.length).toBe(0);
        }
    });

    it("should handle cascading condition failures correctly", async () => {
        // Test that when one condition in a chain fails, the entire evaluation stops correctly
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    E {
                        admin: Administrator [
                            admin.company = closure.office.company
                            E {
                                nonexistent: NonExistentType [
                                    nonexistent.id = admin.user.publicKey
                                ]
                            }
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Even offices that meet the first conditions should fail due to nonexistent type
        const officeWithClosureAndAdmin = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            administrators.some(admin => admin.company === office.company)
        );

        if (officeWithClosureAndAdmin) {
            const officeRef: FactReference = dehydrateFact(officeWithClosureAndAdmin)[0];

            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(0); // Should fail due to nonexistent type in chain
        }
    });

    it("should validate condition evaluation order in complex scenarios", async () => {
        // Test that conditions are evaluated in the expected order
        const specification = new SpecificationParser(`
            (office: Office [E {
                manager: Manager [
                    manager.office = office
                    E {
                        closure: Office.Closed [
                            closure = office
                            !E {
                                reopening: Office.Reopened [
                                    reopening = closure
                                ]
                            }
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Find office with manager that is closed but not reopened
        const qualifyingOffice = offices.find(office =>
            managers.some(manager => manager.office === office) &&
            closures.some(closure => closure.office === office) &&
            !reopenings.some(reopening => reopening.officeClosed.office === office)
        );

        if (qualifyingOffice) {
            const officeRef: FactReference = dehydrateFact(qualifyingOffice)[0];

            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(1);
        }

        // Test office with manager but reopened (should fail inner condition)
        const failingOffice = offices.find(office =>
            managers.some(manager => manager.office === office) &&
            closures.some(closure => closure.office === office) &&
            reopenings.some(reopening => reopening.officeClosed.office === office)
        );

        if (failingOffice) {
            const officeRef: FactReference = dehydrateFact(failingOffice)[0];

            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(0); // Should fail due to reopening
        }
    });
});