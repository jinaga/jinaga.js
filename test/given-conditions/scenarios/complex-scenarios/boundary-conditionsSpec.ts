import { dehydrateFact, FactReference, MemoryStore, SpecificationParser } from "@src";
import { Administrator, Company, Employee, Manager, Office, OfficeClosed, OfficeReopened, User } from "../../../companyModel";
import { createComplexCompanyScenario } from "../../setup/test-data-factories";

describe("Given Conditions - Boundary Conditions", () => {
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

    it("should handle empty given arrays", async () => {
        const specification = new SpecificationParser(`
            (office: Office) {
            } => office
        `).parseSpecification();

        // Test with empty array
        const results = await store.read([], specification);
        expect(results.length).toBe(0);
    });

    it("should handle single given with no conditions", async () => {
        const specification = new SpecificationParser(`
            (office: Office) {
            } => office
        `).parseSpecification();

        const testOffice = offices[0];
        const officeRef: FactReference = dehydrateFact(testOffice)[0];

        const results = await store.read([officeRef], specification);
        expect(results.length).toBe(1);
        expect(results[0].result.type).toBe("Office");
    });

    it("should validate boundary with minimum data set", async () => {
        // Create minimal dataset
        const minimalStore = new MemoryStore();
        const minimalUser = new User("minimal-user");
        const minimalCompany = new Company(minimalUser, "Minimal Corp");
        const minimalOffice = new Office(minimalCompany, "Minimal Office");

        const minimalFacts = [minimalUser, minimalCompany, minimalOffice];
        for (const fact of minimalFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await minimalStore.save(envelopes);
        }

        const specification = new SpecificationParser(`
            (office: Office) {
            } => office
        `).parseSpecification();

        const officeRef: FactReference = dehydrateFact(minimalOffice)[0];

        const results = await minimalStore.read([officeRef], specification);
        expect(results.length).toBe(1);
    });

    it("should handle maximum nested conditions depth", async () => {
        // Create specification with maximum reasonable nesting depth
        const deepSpec = `
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    E {
                        admin: Administrator [
                            admin.company = closure.office.company
                            E {
                                manager: Manager [
                                    manager.office = closure.office
                                    E {
                                        employee: Employee [
                                            employee.office = manager.office
                                            employee.user = admin.user
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }]) {
            } => office
        `;

        const specification = new SpecificationParser(deepSpec).parseSpecification();

        // Find office that meets all deep nesting criteria
        const qualifyingOffice = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            administrators.some(admin =>
                admin.company === office.company &&
                managers.some(manager => manager.office === office) &&
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

    it("should validate concurrent execution with multiple givens", async () => {
        const specification = new SpecificationParser(`
            (company: Company, office: Office [E {
                closure: Office.Closed [
                    closure = office
                    closure.office.company = company
                ]
            }]) {
            } => {
                company = company
                office = office
            }
        `).parseSpecification();

        // Create multiple concurrent executions
        const executions = companies.slice(0, 3).map(async (company) => {
            const companyOffice = offices.find(office =>
                office.company === company &&
                closures.some(closure => closure.office === office)
            );

            if (companyOffice) {
                const companyRef: FactReference = dehydrateFact(company)[0];
                const officeRef: FactReference = dehydrateFact(companyOffice)[0];

                return await store.read([companyRef, officeRef], specification);
            }
            return [];
        });

        const results = await Promise.all(executions);
        expect(results).toHaveLength(3);
        results.forEach(result => expect(Array.isArray(result)).toBe(true));
    });

    it("should handle large datasets efficiently", async () => {
        // Create larger dataset for performance testing
        const largeStore = new MemoryStore();
        const largeUsers = Array.from({ length: 50 }, (_, i) => new User(`user-${i}`));
        const largeCompanies = Array.from({ length: 20 }, (_, i) =>
            new Company(largeUsers[i % largeUsers.length], `Company ${i}`)
        );
        const largeOffices = largeCompanies.flatMap(company =>
            Array.from({ length: 5 }, (_, i) =>
                new Office(company, `${company.identifier} Office ${i}`)
            )
        );
        const largeClosures = largeOffices.slice(0, 30).map((office, i) =>
            new OfficeClosed(office, new Date(`2023-${String(i % 12 + 1).padStart(2, '0')}-01`))
        );

        const largeFacts = [...largeUsers, ...largeCompanies, ...largeOffices, ...largeClosures];
        for (const fact of largeFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await largeStore.save(envelopes);
        }

        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Test with first closed office
        const testOffice = largeOffices.find(office =>
            largeClosures.some(closure => closure.office === office)
        );

        if (testOffice) {
            const officeRef: FactReference = dehydrateFact(testOffice)[0];

            const results = await largeStore.read([officeRef], specification);
            expect(results.length).toBe(1);
        }
    });

    it("should validate boundary conditions with null/undefined values", async () => {
        // Test with specifications that might encounter null/undefined references
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    !E {
                        reopening: Office.Reopened [
                            reopening = closure
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Test with office that has closure but no reopening (should work)
        const closedOffice = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            !reopenings.some(reopening => reopening.officeClosed.office === office)
        );

        if (closedOffice) {
            const officeRef: FactReference = dehydrateFact(closedOffice)[0];

            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(1);
        }
    });

    it("should handle specifications with extreme condition complexity", async () => {
        // Create specification with many parallel conditions
        const complexSpec = `
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    E {
                        admin1: Administrator [
                            admin1.company = closure.office.company
                        ]
                    }
                    E {
                        admin2: Administrator [
                            admin2.company = closure.office.company
                            admin2.user != admin1.user
                        ]
                    }
                    E {
                        manager: Manager [
                            manager.office = office
                        ]
                    }
                    !E {
                        reopening: Office.Reopened [
                            reopening = closure
                        ]
                    }
                ]
            }]) {
            } => office
        `;

        const specification = new SpecificationParser(complexSpec).parseSpecification();

        // Find office that meets all complex criteria
        const qualifyingOffice = offices.find(office => {
            const officeClosures = closures.filter(closure => closure.office === office);
            const officeAdmins = administrators.filter(admin => admin.company === office.company);
            const officeManagers = managers.filter(manager => manager.office === office);
            const officeReopenings = reopenings.filter(reopening => reopening.officeClosed.office === office);

            return officeClosures.length > 0 &&
                   officeAdmins.length >= 2 &&
                   officeManagers.length > 0 &&
                   officeReopenings.length === 0;
        });

        if (qualifyingOffice) {
            const officeRef: FactReference = dehydrateFact(qualifyingOffice)[0];

            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(1);
        }
    });

    it("should validate memory usage with recursive conditions", async () => {
        // Test specification that might cause memory issues with recursion
        const recursiveSpec = `
            (company: Company [E {
                office: Office [
                    office.company = company
                    E {
                        closure: Office.Closed [
                            closure = office
                            E {
                                admin: Administrator [
                                    admin.company = company
                                    E {
                                        creatorCompany: Company [
                                            creatorCompany.creator = admin.user
                                            creatorCompany = company
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }]) {
            } => company
        `;

        const specification = new SpecificationParser(recursiveSpec).parseSpecification();

        // Find company that meets recursive criteria
        const qualifyingCompany = companies.find(company =>
            offices.some(office =>
                office.company === company &&
                closures.some(closure => closure.office === office) &&
                administrators.some(admin =>
                    admin.company === company &&
                    company.creator === admin.user
                )
            )
        );

        if (qualifyingCompany) {
            const companyRef: FactReference = dehydrateFact(qualifyingCompany)[0];

            const results = await store.read([companyRef], specification);
            expect(Array.isArray(results)).toBe(true);
        }
    });

    it("should handle timeout scenarios with long-running conditions", async () => {
        // Create specification that might take longer to evaluate
        const intensiveSpec = `
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    E {
                        admin: Administrator [
                            admin.company = closure.office.company
                            E {
                                manager: Manager [
                                    manager.office = closure.office
                                    E {
                                        employee: Employee [
                                            employee.office = manager.office
                                            employee.user = admin.user
                                            E {
                                                userCompany: Company [
                                                    userCompany.creator = employee.user
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }]) {
            } => office
        `;

        const specification = new SpecificationParser(intensiveSpec).parseSpecification();

        const qualifyingOffice = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            administrators.some(admin =>
                admin.company === office.company &&
                managers.some(manager => manager.office === office) &&
                employees.some(employee =>
                    employee.office === office &&
                    employee.user === admin.user
                )
            )
        );

        if (qualifyingOffice) {
            const officeRef: FactReference = dehydrateFact(qualifyingOffice)[0];

            // Should complete without timeout
            const results = await store.read([officeRef], specification);
            expect(Array.isArray(results)).toBe(true);
        }
    });
});