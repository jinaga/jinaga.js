import { MemoryStore } from "../../../../../src/memory/memory-store";
import { FactReference } from "../../../../../src/storage";
import { dehydrateFact } from "../../../../../src/fact/hydrate";
import { User, Company, Office, OfficeClosed } from "../../../../companyModel";
import { createBasicCompanyScenario } from "../../setup/test-helpers";
import { SpecificationTemplates } from "../../setup/specification-builders";

describe("Given Conditions - Negative Existential", () => {
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

    it("should filter offices that do NOT have closure facts (negative existential)", async () => {
        const specification = SpecificationTemplates.officesNotClosed();

        const openOfficeRef: FactReference = dehydrateFact(openOffice)[0];

        const results = await store.read([openOfficeRef], specification);

        // Should return only the open office (no closure)
        expect(results.length).toBe(1);
        expect(results[0].result.type).toBe("Office");
    });

    it("should not return offices that have closure facts", async () => {
        const specification = SpecificationTemplates.officesNotClosed();

        const closedOfficeRef: FactReference = dehydrateFact(closedOffice)[0];

        const results = await store.read([closedOfficeRef], specification);

        // Should return empty result since office is closed
        expect(results.length).toBe(0);
    });

    it("should handle multiple offices with mixed closure status", async () => {
        // Create additional test data
        const anotherOpenOffice = new Office(company, "Another Open Office");
        const anotherClosedOffice = new Office(company, "Another Closed Office");
        const anotherClosure = new OfficeClosed(anotherClosedOffice, new Date());

        // Save additional facts
        const additionalFacts = [anotherOpenOffice, anotherClosedOffice, anotherClosure];
        for (const fact of additionalFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }

        const specification = SpecificationTemplates.officesNotClosed();

        // Query with open office - should return the office
        const openOfficeRef: FactReference = dehydrateFact(openOffice)[0];
        const openResults = await store.read([openOfficeRef], specification);
        expect(openResults.length).toBe(1);

        // Query with closed office - should return empty
        const closedOfficeRef: FactReference = dehydrateFact(closedOffice)[0];
        const closedResults = await store.read([closedOfficeRef], specification);
        expect(closedResults.length).toBe(0);

        // Query with another open office - should return the office
        const anotherOpenOfficeRef: FactReference = dehydrateFact(anotherOpenOffice)[0];
        const anotherOpenResults = await store.read([anotherOpenOfficeRef], specification);
        expect(anotherOpenResults.length).toBe(1);

        // Query with another closed office - should return empty
        const anotherClosedOfficeRef: FactReference = dehydrateFact(anotherClosedOffice)[0];
        const anotherClosedResults = await store.read([anotherClosedOfficeRef], specification);
        expect(anotherClosedResults.length).toBe(0);
    });

    it("should work with different office types and closure patterns", async () => {
        // Create offices with different closure dates
        const oldClosedOffice = new Office(company, "Old Closed Office");
        const recentClosedOffice = new Office(company, "Recent Closed Office");
        const oldClosure = new OfficeClosed(oldClosedOffice, new Date("2020-01-01"));
        const recentClosure = new OfficeClosed(recentClosedOffice, new Date("2023-12-01"));

        // Save additional facts
        const additionalFacts = [oldClosedOffice, recentClosedOffice, oldClosure, recentClosure];
        for (const fact of additionalFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }

        const specification = SpecificationTemplates.officesNotClosed();

        // Both closed offices should be filtered out
        const oldOfficeRef: FactReference = dehydrateFact(oldClosedOffice)[0];
        const oldResults = await store.read([oldOfficeRef], specification);
        expect(oldResults.length).toBe(0);

        const recentOfficeRef: FactReference = dehydrateFact(recentClosedOffice)[0];
        const recentResults = await store.read([recentOfficeRef], specification);
        expect(recentResults.length).toBe(0);

        // Original open office should still pass
        const openOfficeRef: FactReference = dehydrateFact(openOffice)[0];
        const openResults = await store.read([openOfficeRef], specification);
        expect(openResults.length).toBe(1);
    });

    it("should validate negative existential logic correctness", async () => {
        const specification = SpecificationTemplates.officesNotClosed();

        // Test with open office (should pass)
        const openOfficeRef: FactReference = dehydrateFact(openOffice)[0];
        const openResults = await store.read([openOfficeRef], specification);
        expect(openResults.length).toBe(1);

        // Test with closed office (should fail)
        const closedOfficeRef: FactReference = dehydrateFact(closedOffice)[0];
        const closedResults = await store.read([closedOfficeRef], specification);
        expect(closedResults.length).toBe(0);

        // Verify that the logic is correct: NOT EXISTS(closure) means no closure facts
        // This is the inverse of positive existential
    });
});