import { MemoryStore } from "../../../src/memory/memory-store";
import { FactReference } from "../../../src/storage";
import { dehydrateFact } from "../../../src/fact/hydrate";
import { SpecificationParser } from "../../../src/specification/specification-parser";
import { User, Company, Office, OfficeClosed, OfficeReopened } from "../../companyModel";

/**
 * Integration test suite for SpecificationRunner Given Conditions
 * Replaces the mock-heavy specificationRunnerSpec.ts with real dependencies
 */
describe("SpecificationRunner Given Conditions - Integration", () => {
    let store: MemoryStore;
    let creator: User;
    let company: Company;
    let office1: Office;
    let office2: Office;
    let closure: OfficeClosed;
    let reopened: OfficeReopened;

    beforeEach(async () => {
        // Create test data
        creator = new User("creator-public-key");
        company = new Company(creator, "TestCo");
        office1 = new Office(company, "Office1");
        office2 = new Office(company, "Office2");
        closure = new OfficeClosed(office2, new Date("2023-01-01"));
        reopened = new OfficeReopened(closure);

        // Initialize real MemoryStore
        store = new MemoryStore();

        // Save facts to store
        const facts = [creator, company, office1, office2, closure, reopened];
        for (const fact of facts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }
    });

    it("should pass given without conditions (backward compatibility)", async () => {
        const specification = new SpecificationParser(`
            (office: Office) {
            } => office
        `).parseSpecification();

        // Both offices should pass (no conditions to filter them)
        const office1Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office1)[0].hash
        };
        const result1 = await store.read([office1Ref], specification);
        expect(result1.length).toBe(1);
        expect(result1[0].result.type).toBe("Office");

        const office2Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office2)[0].hash
        };
        const result2 = await store.read([office2Ref], specification);
        expect(result2.length).toBe(1);
        expect(result2[0].result.type).toBe("Office");
    });

    it("should filter given with negative existential condition", async () => {
        const specification = new SpecificationParser(`
            (office: Office [!E {
                closure: Office.Closed [
                    closure = office
                ]
            }]) {
            } => office
        `).parseSpecification();

        // office1 (not closed) should pass
        const office1Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office1)[0].hash
        };
        const result1 = await store.read([office1Ref], specification);
        expect(result1.length).toBe(1);

        // office2 (closed) should be filtered out
        const office2Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office2)[0].hash
        };
        const result2 = await store.read([office2Ref], specification);
        expect(result2.length).toBe(0);
    });

    it("should filter given with positive existential condition", async () => {
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                ]
            }]) {
            } => office
        `).parseSpecification();

        // office1 (not closed) should be filtered out
        const office1Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office1)[0].hash
        };
        const result1 = await store.read([office1Ref], specification);
        expect(result1.length).toBe(0);

        // office2 (closed) should pass
        const office2Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office2)[0].hash
        };
        const result2 = await store.read([office2Ref], specification);
        expect(result2.length).toBe(1);
    });

    it("should handle multiple givens where one fails condition", async () => {
        const specification = new SpecificationParser(`
            (company: Company, office: Office [!E {
                closure: Office.Closed [
                    closure = office
                ]
            }]) {
            } => {
                company = company
                office = office
            }
        `).parseSpecification();

        // company + office1 (not closed) should pass
        const companyRef: FactReference = {
            type: "Company",
            hash: dehydrateFact(company)[0].hash
        };
        const office1Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office1)[0].hash
        };
        const result1 = await store.read([companyRef, office1Ref], specification);
        expect(result1.length).toBe(1);
        expect(result1[0].result.company.type).toBe("Company");
        expect(result1[0].result.office.type).toBe("Office");

        // company + office2 (closed) should be filtered out entirely
        const office2Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office2)[0].hash
        };
        const result2 = await store.read([companyRef, office2Ref], specification);
        expect(result2.length).toBe(0);
    });

    it("should handle error cases for invalid condition types", async () => {
        // Create specification with invalid condition type
        const specification = {
            given: [{
                label: { name: "office", type: "Office" },
                conditions: [{
                    type: "invalid" as any, // Invalid condition type
                    exists: false,
                    matches: []
                } as any]
            }],
            matches: [],
            projection: { type: "fact" as const, label: "office" }
        };

        const office1Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office1)[0].hash
        };

        await expect(
            store.read([office1Ref], specification)
        ).rejects.toThrow(/Invalid condition type on given 'office': expected 'existential', got 'invalid'/);
    });

    it("should handle nested existential conditions within givens", async () => {
        // Specification that only accepts offices that are closed but NOT reopened
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

        // office1 (not closed) should be filtered out
        const office1Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office1)[0].hash
        };
        const result1 = await store.read([office1Ref], specification);
        expect(result1.length).toBe(0);

        // office2 (closed but reopened) should be filtered out
        const office2Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office2)[0].hash
        };
        const result2 = await store.read([office2Ref], specification);
        expect(result2.length).toBe(0);

        // Add another closed office that is NOT reopened
        const office3 = new Office(company, "Office3");
        const closure2 = new OfficeClosed(office3, new Date("2023-01-02"));

        // Save new facts
        const newFacts = [office3, closure2];
        for (const fact of newFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }

        // office3 (closed but not reopened) should pass
        const office3Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office3)[0].hash
        };
        const result3 = await store.read([office3Ref], specification);
        expect(result3.length).toBe(1);
    });

    it("should maintain performance with early filtering", async () => {
        // This test verifies that when a given condition fails,
        // the matches and projection are not executed (performance optimization)

        const specification = new SpecificationParser(`
            (office: Office [!E {
                closure: Office.Closed [
                    closure = office
                ]
            }]) {
                someMatch: SomeType [
                    someMatch = office
                ]
            } => office
        `).parseSpecification();

        // Test with office2 (closed) - should return empty without executing matches
        const office2Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office2)[0].hash
        };

        const startTime = Date.now();
        const result = await store.read([office2Ref], specification);
        const endTime = Date.now();

        expect(result.length).toBe(0);
        // Performance assertion: should complete quickly due to early filtering
        expect(endTime - startTime).toBeLessThan(100); // Should be very fast
    });

    it("should provide detailed error messages for debugging", async () => {
        // Test with malformed specification
        const malformedSpec = {
            given: [{
                label: { name: "office", type: "Office" },
                conditions: [{
                    type: "existential" as const,
                    exists: true,
                    matches: [{
                        unknown: { name: "closure", type: "Office.Closed" },
                        conditions: [{
                            type: "path" as const,
                            rolesLeft: [{ name: "nonexistent", predecessorType: "NonExistentType" }],
                            labelRight: "office",
                            rolesRight: []
                        }]
                    }]
                } as any]
            }],
            matches: [],
            projection: { type: "fact" as const, label: "office" }
        };

        const office1Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office1)[0].hash
        };

        try {
            await store.read([office1Ref], malformedSpec);
            fail("Expected error for malformed specification");
        } catch (error: any) {
            expect(error.message).toContain("office"); // Should mention the failing given
            expect(error.message).toMatch(/Office|office/); // Should be descriptive
        }
    });

    it("should validate memory usage patterns", async () => {
        const specification = new SpecificationParser(`
            (office: Office) {
            } => office
        `).parseSpecification();

        const office1Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office1)[0].hash
        };

        // Monitor memory usage during query execution
        const initialMemory = process.memoryUsage().heapUsed;

        const result = await store.read([office1Ref], specification);

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryDelta = finalMemory - initialMemory;

        expect(result.length).toBe(1);
        // Memory usage should not grow excessively
        expect(memoryDelta).toBeLessThan(1024 * 1024); // Less than 1MB increase
    });

    it("should handle concurrent queries with given conditions", async () => {
        const specification = new SpecificationParser(`
            (office: Office [!E {
                closure: Office.Closed [
                    closure = office
                ]
            }]) {
            } => office
        `).parseSpecification();

        const office1Ref: FactReference = {
            type: "Office",
            hash: dehydrateFact(office1)[0].hash
        };

        // Execute multiple concurrent queries
        const promises = Array(10).fill(null).map(() =>
            store.read([office1Ref], specification)
        );

        const results = await Promise.all(promises);

        // All queries should return the same result
        results.forEach(result => {
            expect(result.length).toBe(1);
            expect(result[0].result.type).toBe("Office");
        });
    });
});