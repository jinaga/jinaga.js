import { MemoryStore } from "../../../src/memory/memory-store";
import { FactReference } from "../../../src/storage";
import { dehydrateFact } from "../../../src/fact/hydrate";
import { User, Company, Office, OfficeClosed, OfficeReopened, Administrator, Manager, Employee } from "../../companyModel";
import { SpecificationParser } from "../../../src/specification/specification-parser";

/**
 * Comprehensive runtime integration tests for Given Conditions
 * Replaces the basic givenConditionsRuntimeSpec.ts with extensive real-world scenarios
 */
describe("Given Conditions Runtime - Integration", () => {
    let store: MemoryStore;
    let creator: User;
    let company: Company;
    let openOffice: Office;
    let closedOffice: Office;
    let reopenedOffice: Office;
    let admin: Administrator;
    let manager: Manager;
    let employee: Employee;

    beforeEach(async () => {
        creator = new User("creator-public-key");
        company = new Company(creator, "TestCo");
        openOffice = new Office(company, "OpenOffice");
        closedOffice = new Office(company, "ClosedOffice");
        reopenedOffice = new Office(company, "ReopenedOffice");

        const closure = new OfficeClosed(closedOffice, new Date("2023-01-01"));
        const reopened = new OfficeReopened(closure);
        const reopenedClosure = new OfficeClosed(reopenedOffice, new Date("2023-02-01"));
        const finalReopened = new OfficeReopened(reopenedClosure);

        admin = new Administrator(company, creator, new Date("2023-01-01"));
        manager = new Manager(openOffice, 1001);
        employee = new Employee(openOffice, creator);

        // Initialize real MemoryStore
        store = new MemoryStore();

        // Save facts to store
        const facts = [
            creator, company, openOffice, closedOffice, reopenedOffice,
            closure, reopened, reopenedClosure, finalReopened,
            admin, manager, employee
        ];
        for (const fact of facts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }
    });

    describe("Backward Compatibility", () => {
        it("should work with backward compatibility (no given conditions)", async () => {
            // Test that existing specifications without given conditions continue to work
            const specification = new SpecificationParser(`
                (office: Office) {
                } => office
            `).parseSpecification();

            const openOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(openOffice)[0].hash
            };
            const openResult = await store.read([openOfficeRef], specification);
            expect(openResult.length).toBe(1);
            expect(openResult[0].result.type).toBe("Office");

            const closedOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(closedOffice)[0].hash
            };
            const closedResult = await store.read([closedOfficeRef], specification);
            expect(closedResult.length).toBe(1);
            expect(closedResult[0].result.type).toBe("Office");
        });

        it("should handle mixed scenarios with and without given conditions", async () => {
            // Test both types of specifications work together
            const withConditions = new SpecificationParser(`
                (office: Office [!E {
                    closure: Office.Closed [
                        closure = office
                    ]
                }]) {
                } => office
            `).parseSpecification();

            const withoutConditions = new SpecificationParser(`
                (office: Office) {
                } => office
            `).parseSpecification();

            const openOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(openOffice)[0].hash
            };

            // Both should return results
            const result1 = await store.read([openOfficeRef], withConditions);
            const result2 = await store.read([openOfficeRef], withoutConditions);

            expect(result1.length).toBe(1);
            expect(result2.length).toBe(1);
            expect(result1[0].result.type).toBe(result2[0].result.type);
        });
    });

    describe("Positive Existential Conditions", () => {
        it("should filter offices that have closure facts", async () => {
            const specification = new SpecificationParser(`
                (office: Office [E {
                    closure: Office.Closed [
                        closure = office
                    ]
                }]) {
                } => office
            `).parseSpecification();

            const openOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(openOffice)[0].hash
            };
            const openResult = await store.read([openOfficeRef], specification);
            expect(openResult.length).toBe(0); // Open office has no closure

            const closedOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(closedOffice)[0].hash
            };
            const closedResult = await store.read([closedOfficeRef], specification);
            expect(closedResult.length).toBe(1); // Closed office has closure
        });

        it("should filter offices that have administrator facts", async () => {
            const specification = new SpecificationParser(`
                (company: Company [E {
                    admin: Administrator [
                        admin.company = company
                    ]
                }]) {
                } => company
            `).parseSpecification();

            const companyRef: FactReference = {
                type: "Company",
                hash: dehydrateFact(company)[0].hash
            };
            const result = await store.read([companyRef], specification);
            expect(result.length).toBe(1); // Company has administrator
        });
    });

    describe("Negative Existential Conditions", () => {
        it("should filter offices that do NOT have closure facts", async () => {
            const specification = new SpecificationParser(`
                (office: Office [!E {
                    closure: Office.Closed [
                        closure = office
                    ]
                }]) {
                } => office
            `).parseSpecification();

            const openOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(openOffice)[0].hash
            };
            const openResult = await store.read([openOfficeRef], specification);
            expect(openResult.length).toBe(1); // Open office has no closure

            const closedOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(closedOffice)[0].hash
            };
            const closedResult = await store.read([closedOfficeRef], specification);
            expect(closedResult.length).toBe(0); // Closed office has closure
        });

        it("should filter offices that are closed but NOT reopened", async () => {
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

            const closedOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(closedOffice)[0].hash
            };
            const closedResult = await store.read([closedOfficeRef], specification);
            expect(closedResult.length).toBe(1); // Closed but not reopened

            const reopenedOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(reopenedOffice)[0].hash
            };
            const reopenedResult = await store.read([reopenedOfficeRef], specification);
            expect(reopenedResult.length).toBe(0); // Closed and reopened
        });
    });

    describe("Multi-Given Scenarios", () => {
        it("should handle company and office with correlated conditions", async () => {
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

            const companyRef: FactReference = {
                type: "Company",
                hash: dehydrateFact(company)[0].hash
            };
            const closedOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(closedOffice)[0].hash
            };
            const result = await store.read([companyRef, closedOfficeRef], specification);
            expect(result.length).toBe(1);
            expect(result[0].result.company.type).toBe("Company");
            expect(result[0].result.office.type).toBe("Office");
        });

        it("should validate that all givens must satisfy their conditions", async () => {
            const specification = new SpecificationParser(`
                (company: Company [E {
                    admin: Administrator [
                        admin.company = company
                    ]
                }], office: Office [!E {
                    closure: Office.Closed [
                        closure = office
                    ]
                }]) {
                } => {
                    company = company
                    office = office
                }
            `).parseSpecification();

            const companyRef: FactReference = {
                type: "Company",
                hash: dehydrateFact(company)[0].hash
            };

            // Valid combination: company with admin + open office
            const openOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(openOffice)[0].hash
            };
            const validResult = await store.read([companyRef, openOfficeRef], specification);
            expect(validResult.length).toBe(1);

            // Invalid combination: company with admin + closed office
            const closedOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(closedOffice)[0].hash
            };
            const invalidResult = await store.read([companyRef, closedOfficeRef], specification);
            expect(invalidResult.length).toBe(0);
        });
    });

    describe("Performance and Memory", () => {
        it("should maintain performance with early filtering", async () => {
            const specification = new SpecificationParser(`
                (office: Office [!E {
                    closure: Office.Closed [
                        closure = office
                    ]
                }]) {
                    manager: Manager [
                        manager.office = office
                    ]
                } => office
            `).parseSpecification();

            const closedOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(closedOffice)[0].hash
            };

            const startTime = Date.now();
            const result = await store.read([closedOfficeRef], specification);
            const endTime = Date.now();

            expect(result.length).toBe(0);
            // Should complete quickly due to early filtering
            expect(endTime - startTime).toBeLessThan(100);
        });

        it("should handle concurrent queries efficiently", async () => {
            const specification = new SpecificationParser(`
                (office: Office) {
                } => office
            `).parseSpecification();

            const openOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(openOffice)[0].hash
            };

            const startTime = Date.now();

            // Execute multiple concurrent queries
            const promises = Array(10).fill(null).map(() =>
                store.read([openOfficeRef], specification)
            );

            const results = await Promise.all(promises);
            const endTime = Date.now();

            // All queries should succeed
            results.forEach(result => {
                expect(result.length).toBe(1);
            });

            // Should complete within reasonable time
            expect(endTime - startTime).toBeLessThan(500);
        });

        it("should validate memory usage patterns", async () => {
            const specification = new SpecificationParser(`
                (office: Office [E {
                    closure: Office.Closed [
                        closure = office
                    ]
                }]) {
                } => office
            `).parseSpecification();

            const closedOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(closedOffice)[0].hash
            };

            const initialMemory = process.memoryUsage().heapUsed;

            // Execute multiple queries to test memory stability
            for (let i = 0; i < 100; i++) {
                await store.read([closedOfficeRef], specification);
            }

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryDelta = finalMemory - initialMemory;

            // Memory usage should not grow excessively
            expect(memoryDelta).toBeLessThan(5 * 1024 * 1024); // Less than 5MB increase
        });
    });

    describe("Error Handling and Edge Cases", () => {
        it("should provide detailed error messages for debugging", async () => {
            const invalidSpec = {
                given: [{
                    label: { name: "office", type: "Office" },
                    conditions: [{
                        type: "invalid" as any,
                        exists: false,
                        matches: []
                    } as any]
                }],
                matches: [],
                projection: { type: "fact" as const, label: "office" }
            };

            const openOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(openOffice)[0].hash
            };

            try {
                await store.read([openOfficeRef], invalidSpec);
                fail("Expected error for invalid specification");
            } catch (error: any) {
                expect(error.message).toContain("office");
                expect(error.message).toMatch(/Invalid|condition|type/i);
            }
        });

        it("should handle empty result sets gracefully", async () => {
            const specification = new SpecificationParser(`
                (office: Office [E {
                    nonexistent: NonExistentType [
                        nonexistent = office
                    ]
                }]) {
                } => office
            `).parseSpecification();

            const openOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(openOffice)[0].hash
            };
            const result = await store.read([openOfficeRef], specification);
            expect(result).toEqual([]);
            expect(Array.isArray(result)).toBe(true);
        });

        it("should handle complex nested conditions", async () => {
            const specification = new SpecificationParser(`
                (company: Company [E {
                    admin: Administrator [
                        admin.company = company
                        E {
                            manager: Manager [
                                manager.office.company = company
                                !E {
                                    termination: Manager.Terminated [
                                        termination.manager = manager
                                    ]
                                }
                            ]
                        }
                    ]
                }]) {
                } => company
            `).parseSpecification();

            const companyRef: FactReference = {
                type: "Company",
                hash: dehydrateFact(company)[0].hash
            };
            const result = await store.read([companyRef], specification);
            expect(result.length).toBe(1);
        });
    });

    describe("Real-World Scenarios", () => {
        it("should handle office management workflow", async () => {
            // Scenario: Find companies with offices that are open and have active managers
            const specification = new SpecificationParser(`
                (company: Company [E {
                    office: Office [
                        office.company = company
                        !E {
                            closure: Office.Closed [
                                closure = office
                            ]
                        }
                        E {
                            manager: Manager [
                                manager.office = office
                            ]
                        }
                    ]
                }]) {
                } => company
            `).parseSpecification();

            const companyRef: FactReference = {
                type: "Company",
                hash: dehydrateFact(company)[0].hash
            };
            const result = await store.read([companyRef], specification);
            expect(result.length).toBe(1);
        });

        it("should validate employee assignment rules", async () => {
            // Scenario: Find offices that have employees but are not closed
            const specification = new SpecificationParser(`
                (office: Office [E {
                    employee: Employee [
                        employee.office = office
                    ]
                } !E {
                    closure: Office.Closed [
                        closure = office
                    ]
                }]) {
                } => office
            `).parseSpecification();

            const openOfficeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(openOffice)[0].hash
            };
            const result = await store.read([openOfficeRef], specification);
            expect(result.length).toBe(1);
        });
    });
});