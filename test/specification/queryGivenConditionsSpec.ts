import { dehydrateReference, Dehydration, FactEnvelope, MemoryStore, SpecificationParser, User } from "@src";
import { Company, Office, OfficeClosed } from "../companyModel";

describe("query given conditions", () => {
    let store: MemoryStore;
    let office: Office;

    beforeEach(async () => {
        store = new MemoryStore();

        // Create facts
        const creator = new User("--- PUBLIC KEY GOES HERE ---");
        const company = new Company(creator, "TestCo");
        office = new Office(company, "TestOffice");
        const closedOffice = new Office(company, "ClosedOffice");
        const closed = new OfficeClosed(closedOffice, new Date());

        // Save facts to store
        const dehydration = new Dehydration();
        dehydration.dehydrate(creator);
        dehydration.dehydrate(company);
        dehydration.dehydrate(office);
        dehydration.dehydrate(closedOffice);
        dehydration.dehydrate(closed);
        await store.save(dehydration.factRecords().map((f: any) => <FactEnvelope>({
            fact: f,
            signatures: []
        })));
    });

    it("should match if given condition is satisfied", async () => {
        const results = await parseAndExecute(`
            (office: Office [
                !E {
                    closure: Office.Closed [
                        closure->office: Office = office
                    ]
                }
            ]) {
            } => office
        `, [office]);

        // Assert that the query returns the office
        expect(results.length).toBe(1);
        expect(results[0].result.type).toBe("Office");
        expect(results[0].result.identifier).toBe("TestOffice");
    });

    async function parseAndExecute(specText: string, given: Office[]) {
        // Parse the specification from text
        const parser = new SpecificationParser(specText);
        parser.skipWhitespace();
        const specification = parser.parseSpecification();

        // Execute the specification with read
        const givenRef = given.map(o => dehydrateReference(o));
        const results = await store.read(givenRef, specification);
        return results;
    }
});
