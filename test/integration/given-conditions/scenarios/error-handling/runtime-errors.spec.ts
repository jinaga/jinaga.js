import { dehydrateFact, FactReference, MemoryStore, SpecificationParser } from "@src";
import { Administrator, Company, Employee, Manager, Office, OfficeClosed, OfficeReopened, User } from "../../../../companyModel";
import { createComplexCompanyScenario } from "../../setup/test-helpers";

describe("Given Conditions - Runtime Errors", () => {
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

    it("should handle runtime errors during condition evaluation", async () => {
        // Specification that references non-existent facts during execution
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    E {
                        nonexistent: NonExistentType [
                            nonexistent.office = office
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        const testOffice = offices.find(office =>
            closures.some(closure => closure.office === office)
        );

        if (testOffice) {
            const officeRef: FactReference = dehydrateFact(testOffice)[0];

            // Should handle runtime error gracefully (return empty results)
            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(0);
        }
    });

    it("should validate error handling for invalid fact references", async () => {
        // Test with specifications that have invalid field access at runtime
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    closure.invalidField = "test"
                ]
            }]) {
            } => office
        `).parseSpecification();

        const testOffice = offices[0];
        const officeRef: FactReference = dehydrateFact(testOffice)[0];

        // Should handle invalid field access gracefully
        const results = await store.read([officeRef], specification);
        expect(Array.isArray(results)).toBe(true);
    });

    it("should handle concurrent execution errors", async () => {
        const errorSpec = new SpecificationParser(`
            (office: Office [E {
                nonexistent: NonExistentType [
                    nonexistent = office
                ]
            }]) {
            } => office
        `).parseSpecification();

        const workingSpec = new SpecificationParser(`
            (office: Office) {
            } => office
        `).parseSpecification();

        const testOffice = offices[0];
        const officeRef: FactReference = dehydrateFact(testOffice)[0];

        // Execute both specifications concurrently
        const errorPromise = store.read([officeRef], errorSpec);
        const workingPromise = store.read([officeRef], workingSpec);

        const [errorResults, workingResults] = await Promise.all([errorPromise, workingPromise]);

        // Error spec should return empty results
        expect(errorResults.length).toBe(0);

        // Working spec should return results
        expect(workingResults.length).toBe(1);
    });

    it("should validate error recovery after runtime failures", async () => {
        const failingSpec = new SpecificationParser(`
            (office: Office [E {
                invalid: InvalidType [
                    invalid = office
                ]
            }]) {
            } => office
        `).parseSpecification();

        const workingSpec = new SpecificationParser(`
            (office: Office) {
            } => office
        `).parseSpecification();

        const testOffice = offices[0];
        const officeRef: FactReference = dehydrateFact(testOffice)[0];

        // Execute failing specification first
        const failingResults = await store.read([officeRef], failingSpec);
        expect(failingResults.length).toBe(0);

        // Execute working specification - should work normally
        const workingResults = await store.read([officeRef], workingSpec);
        expect(workingResults.length).toBe(1);
        expect(workingResults[0].result.type).toBe("Office");
    });

    it("should handle errors in deeply nested condition evaluation", async () => {
        // Specification with deep nesting that includes runtime errors
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    E {
                        admin: Administrator [
                            admin.company = closure.office.company
                            E {
                                nonexistent: NonExistentType [
                                    nonexistent.admin = admin
                                ]
                            }
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        const testOffice = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            administrators.some(admin => admin.company === office.company)
        );

        if (testOffice) {
            const officeRef: FactReference = dehydrateFact(testOffice)[0];

            // Should handle deep nested error gracefully
            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(0);
        }
    });

    it("should validate error handling with circular fact references", async () => {
        // Test specification that might create circular references at runtime
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    E {
                        admin: Administrator [
                            admin.company = closure.office.company
                            E {
                                selfRef: Office [
                                    selfRef = office
                                    selfRef.company = admin.company
                                ]
                            }
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        const testOffice = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            administrators.some(admin => admin.company === office.company)
        );

        if (testOffice) {
            const officeRef: FactReference = dehydrateFact(testOffice)[0];

            // Should handle potential circular reference gracefully
            const results = await store.read([officeRef], specification);
            expect(Array.isArray(results)).toBe(true);
        }
    });

    it("should handle runtime errors with complex multi-given scenarios", async () => {
        // Specification with multiple givens and runtime errors
        const specification = new SpecificationParser(`
            (company: Company, office: Office [E {
                closure: Office.Closed [
                    closure = office
                    closure.office.company = company
                    E {
                        errorType: ErrorType [
                            errorType = closure
                        ]
                    }
                ]
            }]) {
            } => {
                company = company
                office = office
            }
        `).parseSpecification();

        const testCompany = companies[0];
        const testOffice = offices.find(office =>
            office.company === testCompany &&
            closures.some(closure => closure.office === office)
        );

        if (testCompany && testOffice) {
            const companyRef: FactReference = dehydrateFact(testCompany)[0];
            const officeRef: FactReference = dehydrateFact(testOffice)[0];

            // Should handle runtime error in multi-given scenario
            const results = await store.read([companyRef, officeRef], specification);
            expect(results.length).toBe(0);
        }
    });

    it("should validate error handling with invalid data types", async () => {
        // Test with specifications that expect different data types than available
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    closure.date > 12345  // Invalid date comparison
                ]
            }]) {
            } => office
        `).parseSpecification();

        const testOffice = offices.find(office =>
            closures.some(closure => closure.office === office)
        );

        if (testOffice) {
            const officeRef: FactReference = dehydrateFact(testOffice)[0];

            // Should handle type mismatch errors gracefully
            const results = await store.read([officeRef], specification);
            expect(Array.isArray(results)).toBe(true);
        }
    });

    it("should handle errors during result projection", async () => {
        // Specification with invalid projection
        const specification = new SpecificationParser(`
            (office: Office) {
            } => {
                invalidField = office.nonexistentField
            }
        `).parseSpecification();

        const testOffice = offices[0];
        const officeRef: FactReference = dehydrateFact(testOffice)[0];

        // Should handle projection errors gracefully
        const results = await store.read([officeRef], specification);
        expect(Array.isArray(results)).toBe(true);
    });

    it("should validate error handling with memory constraints", async () => {
        // Create specification that might consume excessive memory
        const largeConditionSpec = Array.from({ length: 1000 }, (_, i) =>
            `E { condition${i}: Office.Closed [ condition${i} = office ] }`
        ).join(' ');

        const specification = new SpecificationParser(`
            (office: Office [${largeConditionSpec}]) {
            } => office
        `).parseSpecification();

        const testOffice = offices[0];
        const officeRef: FactReference = dehydrateFact(testOffice)[0];

        // Should handle large specifications gracefully
        const results = await store.read([officeRef], specification);
        expect(Array.isArray(results)).toBe(true);
    });

    it("should handle timeout scenarios during execution", async () => {
        // Create specification that might take very long to execute
        const complexSpec = `
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
                                                    E {
                                                        nestedAdmin: Administrator [
                                                            nestedAdmin.company = userCompany
                                                            nestedAdmin.user != admin.user
                                                        ]
                                                    }
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

        const specification = new SpecificationParser(complexSpec).parseSpecification();

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

            // Should complete execution without hanging
            const results = await store.read([officeRef], specification);
            expect(Array.isArray(results)).toBe(true);
        }
    });
});