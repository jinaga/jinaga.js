import { dehydrateReference, Dehydration, FactEnvelope, MemoryStore, SpecificationParser, User } from "@src";
import { Company, Office, OfficeClosed } from "../companyModel";

describe("query given conditions", () => {
    let store: MemoryStore;
    let office: Office;
    let closedOffice!: Office;
    let company: Company;

    beforeEach(async () => {
        store = new MemoryStore();

        // Create facts
        const creator = new User("--- PUBLIC KEY GOES HERE ---");
        company = new Company(creator, "TestCo");
        office = new Office(company, "TestOffice");
        closedOffice = new Office(company, "ClosedOffice");
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

    it("should execute query with simple given without conditions", async () => {
        const results = await parseAndExecute(`
            (office: Office) {
            } => office
        `, [office]);

        expect(results.length).toBe(1);
        expect(results[0].result.type).toBe("Office");
        expect(results[0].result.identifier).toBe("TestOffice");
    });

    it("should match if negative existential condition is satisfied", async () => {
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

        // Assert that the query returns a result because office is not closed
        expect(results.length).toBe(1);
        expect(results[0].result.type).toBe("Office");
        expect(results[0].result.identifier).toBe("TestOffice");
    });

    it("should not match if negative existential condition is not satisfied", async () => {
        const results = await parseAndExecute(`
            (office: Office [
                !E {
                    closure: Office.Closed [
                        closure->office: Office = office
                    ]
                }
            ]) {
            } => office
        `, [closedOffice]);

        // Assert that the query returns no results because office has a closure (violates !E)
        expect(results.length).toBe(0);
    });

    it("should not match if positive existential condition is not satisfied", async () => {
        const results = await parseAndExecute(`
            (office: Office [
                E {
                    closure: Office.Closed [
                        closure->office: Office = office
                    ]
                }
            ]) {
            } => office
        `, [office]);

        // Assert that the query returns no results because office has no closure (violates E)
        expect(results.length).toBe(0);
    });

    it("should handle multiple givens with different conditions", async () => {
        const results = await parseAndExecute(`
            (office: Office [
                E {
                    closure: Office.Closed [
                        closure->office: Office = office
                    ]
                }
            ], company: Company) {
            } => office
        `, [closedOffice, company]);

        // Assert that the query returns a result because closedOffice is closed
        expect(results.length).toBe(1);
        expect(results[0].result.type).toBe("Office");
        expect(results[0].result.identifier).toBe("ClosedOffice");
    });

    it("should handle conditions that reference prior givens", async () => {
        const results = await parseAndExecute(`
            (office: Office, company: Company [
                E {
                    o: Office [
                        o->company: Company = company
                        o = office
                    ]
                }
            ]) {
            } => office
        `, [office, company]);

        // Assert that the query returns a result because office belongs to company
        expect(results.length).toBe(1);
        expect(results[0].result.type).toBe("Office");
        expect(results[0].result.identifier).toBe("TestOffice");
    });

    async function parseAndExecute(specText: string, given: any[]) {
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
