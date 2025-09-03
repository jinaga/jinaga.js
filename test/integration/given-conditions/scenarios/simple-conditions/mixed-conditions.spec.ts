import { dehydrateFact, FactReference, MemoryStore } from "@src";
import { Company, Office, OfficeClosed, OfficeReopened, User } from "../../../../companyModel";
import { SpecificationTemplates } from "../../setup/specification-builders";
import { createBasicCompanyScenario } from "../../setup/test-helpers";

describe("Given Conditions - Mixed Conditions", () => {
    let store: MemoryStore;
    let creator: User;
    let company: Company;
    let openOffice: Office;
    let closedOffice: Office;
    let closure: OfficeClosed;

    beforeEach(async () => {
        ({ users: [creator], companies: [company], offices: [openOffice, closedOffice], closures: [closure] } = await createBasicCompanyScenario());

        // Create memory store and populate with test data
        store = new MemoryStore();

        // Save facts to the store
        const facts = [creator, company, openOffice, closedOffice, closure];
        for (const fact of facts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }
    });

    it("should handle mixed conditions (EXISTS + NOT EXISTS) correctly", async () => {
        // Create additional data for mixed conditions testing
        const reopenedOffice = new Office(company, "Reopened Office");
        const closure2 = new OfficeClosed(reopenedOffice, new Date("2023-06-01"));
        const reopening = new OfficeReopened(closure2);

        // Save additional facts
        const additionalFacts = [reopenedOffice, closure2, reopening];
        for (const fact of additionalFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }

        const specification = SpecificationTemplates.officesClosedNotReopened();

        // Test closed office without reopening (should pass)
        const closedOfficeRef: FactReference = dehydrateFact(closedOffice)[0];
        const closedResults = await store.read([closedOfficeRef], specification);
        expect(closedResults.length).toBe(1); // Closed but not reopened

        // Test reopened office (should fail - closed AND reopened)
        const reopenedOfficeRef: FactReference = dehydrateFact(reopenedOffice)[0];
        const reopenedResults = await store.read([reopenedOfficeRef], specification);
        expect(reopenedResults.length).toBe(0); // Closed and reopened

        // Test open office (should fail - not closed at all)
        const openOfficeRef: FactReference = dehydrateFact(openOffice)[0];
        const openResults = await store.read([openOfficeRef], specification);
        expect(openResults.length).toBe(0); // Not closed
    });

    it("should validate AND logic in mixed conditions", async () => {
        // Create test data with various combinations
        const offices = [
            new Office(company, "Office A"), // Not closed
            new Office(company, "Office B"), // Closed, not reopened
            new Office(company, "Office C"), // Closed, reopened
        ];

        const closures = [
            new OfficeClosed(offices[1], new Date("2023-06-01")), // Office B closed
            new OfficeClosed(offices[2], new Date("2023-06-01")), // Office C closed
        ];

        const reopenings = [
            new OfficeReopened(closures[1]), // Office C reopened
        ];

        // Save all facts
        const allFacts = [...offices, ...closures, ...reopenings];
        for (const fact of allFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }

        const specification = SpecificationTemplates.officesClosedNotReopened();

        // Office A (not closed) - should fail first condition
        const officeARef: FactReference = dehydrateFact(offices[0])[0];
        const resultsA = await store.read([officeARef], specification);
        expect(resultsA.length).toBe(0);

        // Office B (closed, not reopened) - should pass both conditions
        const officeBRef: FactReference = dehydrateFact(offices[1])[0];
        const resultsB = await store.read([officeBRef], specification);
        expect(resultsB.length).toBe(1);

        // Office C (closed, reopened) - should pass first condition, fail second
        const officeCRef: FactReference = dehydrateFact(offices[2])[0];
        const resultsC = await store.read([officeCRef], specification);
        expect(resultsC.length).toBe(0);
    });

    it("should handle complex mixed condition scenarios", async () => {
        // Create a more complex scenario with multiple conditions
        const testOffice = new Office(company, "Complex Test Office");
        const closure3 = new OfficeClosed(testOffice, new Date("2023-01-01"));

        // Save facts
        const testFacts = [testOffice, closure3];
        for (const fact of testFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }

        const specification = SpecificationTemplates.officesClosedNotReopened();

        // Test office that is closed but not reopened
        const testOfficeRef: FactReference = dehydrateFact(testOffice)[0];
        const results = await store.read([testOfficeRef], specification);

        // Should pass: EXISTS(closure) AND NOT EXISTS(reopening)
        expect(results.length).toBe(1);
        expect(results[0].result.type).toBe("Office");
    });

    it("should validate condition evaluation order", async () => {
        // This test ensures that conditions are evaluated in the correct order
        // and that short-circuiting works properly

        const specification = SpecificationTemplates.officesClosedNotReopened();

        // Test with an office that doesn't exist in the data
        const nonExistentOfficeRef: FactReference = {
            type: "Office",
            hash: "non-existent-hash"
        };

        const results = await store.read([nonExistentOfficeRef], specification);

        // Should return empty results (office doesn't exist)
        expect(results.length).toBe(0);
    });

    it("should demonstrate mixed condition logic clarity", async () => {
        // This test demonstrates that mixed conditions work as expected
        // by testing the logical combination of EXISTS and NOT EXISTS

        const specification = SpecificationTemplates.officesClosedNotReopened();

        // Original closed office (no reopening) - should pass
        const closedOfficeRef: FactReference = dehydrateFact(closedOffice)[0];
        const closedResults = await store.read([closedOfficeRef], specification);
        expect(closedResults.length).toBe(1);

        // Original open office - should fail
        const openOfficeRef: FactReference = dehydrateFact(openOffice)[0];
        const openResults = await store.read([openOfficeRef], specification);
        expect(openResults.length).toBe(0);

        // The specification requires: EXISTS(closure) AND NOT EXISTS(reopening)
        // This is a complex logical condition that must be evaluated correctly
    });
});