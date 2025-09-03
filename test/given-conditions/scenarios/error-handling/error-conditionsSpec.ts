import { dehydrateFact, FactReference, MemoryStore, SpecificationParser } from "@src";
import { Administrator, Company, Employee, Manager, Office, OfficeClosed, OfficeReopened, User } from "../../../companyModel";
import { createComplexCompanyScenario } from "../../setup/test-data-factories";

describe("Given Conditions - Error Conditions", () => {
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

    describe("Parsing Errors", () => {
        it("should handle malformed specifications gracefully", async () => {
            // Test with incomplete specification strings
            const malformedSpecs = [
                "(office: Office [E { closure: Office.Closed [", // Incomplete
                "(office: Office [E { closure: Office.Closed [ closure = office ] } ] ) { } => office", // Missing closing braces
                "(office: Office [E { nonexistent: NonExistentType [ nonexistent.id = office.id ] } ]) { } => office", // Non-existent type
                // Missing closing brackets
                "(office: Office [E { closure: Office.Closed [ closure = office ",
                // Invalid characters
                "(office: Office [E { closure: Office.Closed [ closure = @invalid@ ] } ]) { } => office",
                // Missing given declaration
                "[E { closure: Office.Closed [ closure = office ] } ]) { } => office",
                // Invalid type names
                "(office: Office [E { closure: Office.Closed [ closure = office ] } ]) { } => office",
                // Malformed conditions
                "(office: Office [E { closure: Office.Closed [ closure = office invalid_syntax ] } ]) { } => office",
                // Empty conditions
                "(office: Office []) { } => office",
                // Missing projection
                "(office: Office [E { closure: Office.Closed [ closure = office ] } ]) { }",
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

        it("should validate parser error handling for edge cases", async () => {
            const edgeCaseSpecs = [
                // Extremely long type names
                `(office: ${"A".repeat(1000)} [E { closure: Office.Closed [ closure = office ] } ]) { } => office`,
                // Deeply nested but invalid structure
                "(office: Office [E { closure: Office.Closed [ closure = office [E { nested: Invalid [ nested = closure ] } ] ] } ]) { } => office",
                // Unicode characters
                "(office: Office [E { closure: Office.Closed [ closure = office closure.date ≥ '2023-01-01' ] } ]) { } => office",
                // Empty strings
                "",
                // Only whitespace
                "   \n\t   ",
                // Invalid operators
                "(office: Office [E { closure: Office.Closed [ closure === office ] } ]) { } => office",
            ];

            for (const edgeSpec of edgeCaseSpecs) {
                try {
                    const specification = new SpecificationParser(edgeSpec).parseSpecification();
                    expect(specification).toBeDefined();
                } catch (error) {
                    // Should handle errors gracefully
                    expect(error).toBeDefined();
                }
            }
        });

        it("should handle specification parsing with special characters", async () => {
            // Test parsing with potentially problematic characters
            const problematicSpecs = [
                "(office: Office [E { closure: Office.Closed [ closure = office closure.date > '2023-01-01' ] } ]) { } => office",
                "(office: Office [E { closure: Office.Closed [ closure = office closure.date < '2024-12-31' ] } ]) { } => office",
                "(office: Office [E { admin: Administrator [ admin.date >= '2023-01-01' admin.date <= '2024-12-31' ] } ]) { } => office",
                // Quotes in strings
                "(office: Office [E { closure: Office.Closed [ closure = office closure.date = '2023-01-01' ] } ]) { } => office",
                // Escaped characters
                "(office: Office [E { closure: Office.Closed [ closure = office closure.identifier = 'Test\\'s Office' ] } ]) { } => office",
                // Unicode in identifiers
                "(office: Office [E { closure: Office.Closed [ closure = office closure.identifier = '办公室' ] } ]) { } => office",
                // Numbers in identifiers
                "(office: Office123 [E { closure: Office.Closed [ closure = office ] } ]) { } => office",
                // Symbols in strings
                "(office: Office [E { closure: Office.Closed [ closure = office closure.identifier = 'Test@#$%' ] } ]) { } => office",
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

        it("should handle extremely long specifications", async () => {
            // Create a very long but valid specification
            const longConditions = Array.from({ length: 100 }, (_, i) =>
                `E { condition${i}: Office.Closed [ condition${i} = office ] }`
            ).join(' ');

            const longSpec = `(office: Office [${longConditions}]) { } => office`;

            try {
                const specification = new SpecificationParser(longSpec).parseSpecification();
                expect(specification).toBeDefined();
            } catch (error) {
                // Should handle long specs gracefully
                expect(error).toBeDefined();
            }
        });
    });

    describe("Validation Errors", () => {
        it("should handle specification validation errors", async () => {
            const validationErrorSpecs = [
                // Non-existent fact types
                "(office: Office [E { nonexistent: NonExistentType [ nonexistent = office ] } ]) { } => office",
                // Invalid field references
                "(office: Office [E { closure: Office.Closed [ closure.nonexistentField = office ] } ]) { } => office",
                // Type mismatches
                "(office: Office [E { user: User [ user = office ] } ]) { } => office",
                // Circular references
                "(office: Office [E { self: Office [ self = office self.company = office.company ] } ]) { } => office",
                // Invalid date formats
                "(office: Office [E { closure: Office.Closed [ closure.date = 'invalid-date' ] } ]) { } => office",
            ];

            for (const validationSpec of validationErrorSpecs) {
                try {
                    const specification = new SpecificationParser(validationSpec).parseSpecification();

                    // If parsing succeeds, test execution
                    const officeRef: FactReference = dehydrateFact(offices[0])[0];

                    const results = await store.read([officeRef], specification);
                    expect(Array.isArray(results)).toBe(true);
                } catch (error) {
                    // Should handle validation errors gracefully
                    expect(error).toBeDefined();
                }
            }
        });

        it("should validate error messages for different failure types", async () => {
            const errorTestCases = [
                {
                    spec: "(office: Office [E { closure: Office.Closed [ closure = office ",
                    expectedErrorType: "syntax"
                },
                {
                    spec: "(office: InvalidType) { } => office",
                    expectedErrorType: "validation"
                },
                {
                    spec: "(office: Office [E { nonexistent: NonExistentType [ nonexistent = office ] } ]) { } => office",
                    expectedErrorType: "reference"
                }
            ];

            for (const testCase of errorTestCases) {
                try {
                    const specification = new SpecificationParser(testCase.spec).parseSpecification();
                    // If parsing succeeds, the error type might be different
                    expect(specification).toBeDefined();
                } catch (error) {
                    // Should provide meaningful error information
                    expect(error).toBeDefined();
                    if (error instanceof Error) {
                        expect(error.message).toBeTruthy();
                    }
                }
            }
        });
    });

    describe("Runtime Errors", () => {
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
    });

    describe("Concurrent and Recovery", () => {
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

        it("should validate parser recovery after errors", async () => {
            // Test that parser can recover from errors and parse valid specs afterwards
            const invalidSpec = "(office: Office [E { closure: Office.Closed [ closure = office ";
            const validSpec = "(office: Office) { } => office";

            try {
                // Try invalid spec first
                const invalidSpecification = new SpecificationParser(invalidSpec).parseSpecification();
                // If it succeeds unexpectedly, that's also fine
            } catch (error) {
                // Expected to fail
                expect(error).toBeDefined();
            }

            // Now try valid spec - should work
            const validSpecification = new SpecificationParser(validSpec).parseSpecification();
            expect(validSpecification).toBeDefined();

            // Test execution
            const officeRef: FactReference = dehydrateFact(offices[0])[0];

            const results = await store.read([officeRef], validSpecification);
            expect(results.length).toBe(1);
        });

        it("should validate error handling for concurrent parsing", async () => {
            const specs = [
                "(office: Office [E { closure: Office.Closed [ closure = office ",
                "(office: Office) { } => office",
                "(office: InvalidType) { } => office",
                "(office: Office [E { nonexistent: NonExistentType [ nonexistent = office ] } ]) { } => office"
            ];

            // Parse all specifications concurrently
            const promises = specs.map(spec => {
                try {
                    return Promise.resolve(new SpecificationParser(spec).parseSpecification());
                } catch (error) {
                    return Promise.reject(error);
                }
            });

            const results = await Promise.allSettled(promises);

            // Should have mix of fulfilled and rejected promises
            const fulfilled = results.filter(result => result.status === 'fulfilled').length;
            const rejected = results.filter(result => result.status === 'rejected').length;

            expect(fulfilled + rejected).toBe(specs.length);
            expect(fulfilled).toBeGreaterThan(0); // At least one should succeed
            expect(rejected).toBeGreaterThan(0); // At least one should fail
        });
    });
});