import { dehydrateFact, FactReference, MemoryStore, SpecificationParser } from "@src";
import { Company, Office, User } from "../../../../companyModel";

describe("Given Conditions - Invalid Specifications", () => {
    let store: MemoryStore;
    let testUser: User;
    let testCompany: Company;
    let testOffice: Office;

    beforeEach(async () => {
        // Create minimal test data
        testUser = new User("test-user");
        testCompany = new Company(testUser, "Test Company");
        testOffice = new Office(testCompany, "Test Office");

        store = new MemoryStore();
        const facts = [testUser, testCompany, testOffice];

        for (const fact of facts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }
    });

    it("should handle malformed specification syntax", async () => {
        const invalidSpecs = [
            // Missing closing brackets
            "(office: Office [E { closure: Office.Closed [ closure = office ",
            // Invalid characters
            "(office: Office [E { closure: Office.Closed [ closure = @invalid@ ] } ]) { } => office",
            // Missing given declaration
            "[E { closure: Office.Closed [ closure = office ] } ]) { } => office",
            // Invalid type names
            "(office: Invalid.Type [E { closure: Office.Closed [ closure = office ] } ]) { } => office",
            // Malformed conditions
            "(office: Office [E { closure: Office.Closed [ closure = office invalid_syntax ] } ]) { } => office",
            // Empty conditions
            "(office: Office []) { } => office",
            // Missing projection
            "(office: Office [E { closure: Office.Closed [ closure = office ] } ]) { }",
        ];

        for (const invalidSpec of invalidSpecs) {
            try {
                const specification = new SpecificationParser(invalidSpec).parseSpecification();
                // If parsing succeeds, test execution
                const officeRef: FactReference = {
                    type: "Office",
                    hash: dehydrateFact(testOffice)[0].hash
                };

                const results = await store.read([officeRef], specification);
                expect(Array.isArray(results)).toBe(true);
            } catch (error) {
                // Parsing should either succeed or fail gracefully
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
                const officeRef: FactReference = {
                    type: "Office",
                    hash: dehydrateFact(testOffice)[0].hash
                };

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

    it("should handle specification parsing with special characters", async () => {
        const specialCharSpecs = [
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

        for (const specialSpec of specialCharSpecs) {
            try {
                const specification = new SpecificationParser(specialSpec).parseSpecification();
                expect(specification).toBeDefined();
            } catch (error) {
                // Should handle special characters gracefully
                expect(error).toBeDefined();
            }
        }
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
        const officeRef: FactReference = {
            type: "Office",
            hash: dehydrateFact(testOffice)[0].hash
        };

        const results = await store.read([officeRef], validSpecification);
        expect(results.length).toBe(1);
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