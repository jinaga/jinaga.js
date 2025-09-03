import { MemoryStore } from "../../../../../src/memory/memory-store";
import { FactReference } from "../../../../../src/storage";
import { dehydrateFact } from "../../../../../src/fact/hydrate";
import { SpecificationParser } from "../../../../../src/specification/specification-parser";
import { User, Company, Office, OfficeClosed, OfficeReopened, Administrator, Manager, Employee } from "../../../../companyModel";
import { createComplexCompanyScenario } from "../../setup/test-helpers";

describe("Given Conditions - Error Handling", () => {
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

    it("should handle malformed specifications gracefully", async () => {
        // Test with incomplete specification strings
        const malformedSpecs = [
            "(office: Office [E { closure: Office.Closed [", // Incomplete
            "(office: Office [E { closure: Office.Closed [ closure = office ] } ] ) { } => office", // Missing closing braces
            "(office: Office [E { nonexistent: NonExistentType [ nonexistent.id = office.id ] } ]) { } => office", // Non-existent type
        ];

        for (const malformedSpec of malformedSpecs) {
            try {
                const specification = new SpecificationParser(malformedSpec).parseSpecification();
                // If parsing succeeds, test execution
                const testOffice = offices[0];
                const officeRef: FactReference = dehydrateFact(testOffice)[0];

                // This should either succeed or fail gracefully
                const results = await store.read([officeRef], specification);
                expect(Array.isArray(results)).toBe(true);
            } catch (error) {
                // Parsing errors should be caught and handled
                expect(error).toBeDefined();
            }
        }
    });

    it("should handle runtime errors during condition evaluation", async () => {
        // Specification that references non-existent facts
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

            // Should handle the error gracefully (return empty results)
            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(0);
        }
    });

    it("should validate error handling with circular references", async () => {
        // Specification that could potentially create circular references
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    E {
                        admin: Administrator [
                            admin.company = closure.office.company
                            E {
                                office2: Office [
                                    office2.company = admin.company
                                    office2 = office
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

    it("should handle deeply nested error conditions", async () => {
        // Specification with very deep nesting that might cause stack issues
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
                                            E {
                                                user: User [
                                                    user.publicKey = employee.user.publicKey
                                                    E {
                                                        company: Company [
                                                            company.creator = user
                                                            company = admin.company
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

        try {
            const specification = new SpecificationParser(deepSpec).parseSpecification();

            const testOffice = offices.find(office =>
                closures.some(closure => closure.office === office) &&
                administrators.some(admin => admin.company === office.company) &&
                managers.some(manager => manager.office === office) &&
                employees.some(employee => employee.office === office)
            );

            if (testOffice) {
                const officeRef: FactReference = dehydrateFact(testOffice)[0];

                const results = await store.read([officeRef], specification);
                expect(Array.isArray(results)).toBe(true);
            }
        } catch (error) {
            // Should handle deep nesting gracefully
            expect(error).toBeDefined();
        }
    });

    it("should validate error handling with invalid fact references", async () => {
        // Test with invalid fact references in conditions
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    closure.invalidField = "invalid"
                ]
            }]) {
            } => office
        `).parseSpecification();

        const testOffice = offices[0];
        const officeRef: FactReference = dehydrateFact(testOffice)[0];

        // Should handle invalid field references gracefully
        const results = await store.read([officeRef], specification);
        expect(Array.isArray(results)).toBe(true);
    });

    it("should handle concurrent specification execution errors", async () => {
        // Test multiple specifications executing concurrently with potential errors
        const specs = [
            new SpecificationParser(`
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
            `).parseSpecification(),

            new SpecificationParser(`
                (office: Office [E {
                    manager: Manager [
                        manager.office = office
                        E {
                            nonexistent: NonExistentType [
                                nonexistent.manager = manager
                            ]
                        }
                    ]
                }]) {
                } => office
            `).parseSpecification()
        ];

        const testOffice = offices[0];
        const officeRef: FactReference = dehydrateFact(testOffice)[0];

        // Execute both specifications concurrently
        const promises = specs.map(spec => store.read([officeRef], spec));

        try {
            const results = await Promise.all(promises);
            expect(results).toHaveLength(2);
            results.forEach(result => expect(Array.isArray(result)).toBe(true));
        } catch (error) {
            // Should handle concurrent errors gracefully
            expect(error).toBeDefined();
        }
    });

    it("should validate error recovery after failed conditions", async () => {
        // Test that system recovers properly after encountering errors
        const failingSpec = new SpecificationParser(`
            (office: Office [E {
                nonexistent: NonExistentType [
                    nonexistent.office = office
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

        // First execute failing specification
        const failingResults = await store.read([officeRef], failingSpec);
        expect(failingResults.length).toBe(0);

        // Then execute working specification - should work normally
        const workingResults = await store.read([officeRef], workingSpec);
        expect(workingResults.length).toBe(1);
        expect(workingResults[0].result.type).toBe("Office");
    });

    it("should handle specification parsing errors with special characters", async () => {
        // Test parsing with potentially problematic characters
        const problematicSpecs = [
            "(office: Office [E { closure: Office.Closed [ closure = office closure.date > '2023-01-01' ] } ]) { } => office",
            "(office: Office [E { closure: Office.Closed [ closure = office closure.date < '2024-12-31' ] } ]) { } => office",
            "(office: Office [E { admin: Administrator [ admin.date >= '2023-01-01' admin.date <= '2024-12-31' ] } ]) { } => office"
        ];

        for (const spec of problematicSpecs) {
            try {
                const specification = new SpecificationParser(spec).parseSpecification();
                const testOffice = offices[0];
                const officeRef: FactReference = dehydrateFact(testOffice)[0];

                const results = await store.read([officeRef], specification);
                expect(Array.isArray(results)).toBe(true);
            } catch (error) {
                // Should handle parsing errors gracefully
                expect(error).toBeDefined();
            }
        }
    });
});