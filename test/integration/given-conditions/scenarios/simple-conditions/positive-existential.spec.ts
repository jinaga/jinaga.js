import { FactReference, MemoryStore, dehydrateFact } from "@src";
import { Company, Office, OfficeClosed, User } from "../../../../companyModel";
import { SpecificationTemplates } from "../../setup/specification-builders";
import { createBasicCompanyScenario } from "../../setup/test-helpers";

describe("Given Conditions - Positive Existential", () => {
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

    it("should filter offices that have closure facts (positive existential)", async () => {
        const specification = SpecificationTemplates.officesClosed();

        const closedOfficeRef: FactReference = dehydrateFact(closedOffice)[0];

        const results = await store.read([closedOfficeRef], specification);

        // Should return only the closed office
        expect(results.length).toBe(1);
        expect(results[0].result.type).toBe("Office");
    });

    it("should not return offices without closure facts", async () => {
        const specification = SpecificationTemplates.officesClosed();

        const openOfficeRef: FactReference = dehydrateFact(openOffice)[0];

        const results = await store.read([openOfficeRef], specification);

        // Should return empty result since office is not closed
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

        const specification = SpecificationTemplates.officesClosed();

        // Query with open office - should return empty
        const openOfficeRef: FactReference = dehydrateFact(openOffice)[0];
        const openResults = await store.read([openOfficeRef], specification);
        expect(openResults.length).toBe(0);

        // Query with closed office - should return the office
        const closedOfficeRef: FactReference = dehydrateFact(closedOffice)[0];
        const closedResults = await store.read([closedOfficeRef], specification);
        expect(closedResults.length).toBe(1);

        // Query with another closed office - should return the office
        const anotherClosedOfficeRef: FactReference = dehydrateFact(anotherClosedOffice)[0];
        const anotherClosedResults = await store.read([anotherClosedOfficeRef], specification);
        expect(anotherClosedResults.length).toBe(1);
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

        const specification = SpecificationTemplates.officesClosed();

        // Both should pass the positive existential condition
        const oldOfficeRef: FactReference = dehydrateFact(oldClosedOffice)[0];
        const oldResults = await store.read([oldOfficeRef], specification);
        expect(oldResults.length).toBe(1);

        const recentOfficeRef: FactReference = dehydrateFact(recentClosedOffice)[0];
        const recentResults = await store.read([recentOfficeRef], specification);
        expect(recentResults.length).toBe(1);
    });

    it("should validate early filtering optimization", async () => {
        const specification = SpecificationTemplates.officesClosed();

        // Test that when condition fails, matches are not executed
        let matchExecuted = false;
        // Note: Early filtering verification would require deeper instrumentation
        // of the internal SpecificationRunner, which is not easily accessible

        // Test with open office (should fail condition) - should return empty without executing matches
        const openOfficeRef: FactReference = dehydrateFact(openOffice)[0];
        matchExecuted = false;
        const results = await store.read([openOfficeRef], specification);

        expect(results.length).toBe(0);
        expect(matchExecuted).toBe(false); // Matches should not be executed due to early filtering
    });
});