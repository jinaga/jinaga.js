import { dehydrateReference, Dehydration, FactEnvelope, SpecificationParser, User } from "@src";
import { IndexedDBStore } from "../../src/indexeddb/indexeddb-store";
import { Company, Office, OfficeClosed, OfficeReopened } from "../companyModel";

const isIndexedDBAvailable = typeof indexedDB !== 'undefined';

const describeFunc = isIndexedDBAvailable ? describe : describe.skip;

describeFunc("query given conditions - IndexedDB", () => {
    let store: IndexedDBStore;
    let office: Office;
    let closedOffice!: Office;
    let anotherClosedOffice!: Office;
    let company: Company;
    let dbName: string;

    beforeEach(async () => {
        if (!isIndexedDBAvailable) {
            return;
        }

        // Use a unique database name for each test run
        dbName = `test-query-given-conditions-${Date.now()}-${Math.random()}`;
        store = new IndexedDBStore(dbName);

        // Create facts
        const creator = new User("--- PUBLIC KEY GOES HERE ---");
        company = new Company(creator, "TestCo");
        office = new Office(company, "TestOffice");
        closedOffice = new Office(company, "ClosedOffice");
        anotherClosedOffice = new Office(company, "AnotherClosedOffice");
        const closed = new OfficeClosed(closedOffice, new Date());
        const anotherClosed = new OfficeClosed(anotherClosedOffice, new Date());
        const reopened = new OfficeReopened(closed);

        // Save facts to store
        const dehydration = new Dehydration();
        dehydration.dehydrate(creator);
        dehydration.dehydrate(company);
        dehydration.dehydrate(office);
        dehydration.dehydrate(closedOffice);
        dehydration.dehydrate(closed);
        dehydration.dehydrate(anotherClosedOffice);
        dehydration.dehydrate(anotherClosed);
        dehydration.dehydrate(reopened);
        await store.save(dehydration.factRecords().map((f: any) => <FactEnvelope>({
            fact: f,
            signatures: []
        })));
    });

    afterEach(async () => {
        // Clean up the IndexedDB database
        if (store) {
            await store.close();
        }
        // Delete the database
        const deleteRequest = indexedDB.deleteDatabase(dbName);
        await new Promise((resolve, reject) => {
            deleteRequest.onsuccess = () => resolve(undefined);
            deleteRequest.onerror = () => reject(deleteRequest.error);
            deleteRequest.onblocked = () => reject(new Error('Database deletion blocked'));
        });
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

    it("should match if positive existential condition is satisfied", async () => {
        const results = await parseAndExecute(`
            (office: Office [
                E {
                    closure: Office.Closed [
                        closure->office: Office = office
                    ]
                }
            ]) {
            } => office
        `, [closedOffice]);

        // Assert that the query returns a result because closedOffice has a closure (satisfies E)
        expect(results.length).toBe(1);
        expect(results[0].result.type).toBe("Office");
        expect(results[0].result.identifier).toBe("ClosedOffice");
    });

    it("should handle multiple conditions on same given", async () => {
        const results = await parseAndExecute(`
            (office: Office [
                E {
                    closure: Office.Closed [
                        closure->office: Office = office
                    ]
                }
                !E {
                    president: President [
                        president->office: Office = office
                    ]
                }
            ]) {
            } => office
        `, [closedOffice]);

        // Assert that the query returns a result because closedOffice has closure but no president
        expect(results.length).toBe(1);
        expect(results[0].result.type).toBe("Office");
        expect(results[0].result.identifier).toBe("ClosedOffice");
    });

    it("should handle mixed condition types on single given", async () => {
        const results = await parseAndExecute(`
            (office: Office [
                E {
                    closure: Office.Closed [
                        closure->office: Office = office
                    ]
                }
                !E {
                    president: President [
                        president->office: Office = office
                    ]
                }
            ]) {
            } => office
        `, [office]);

        // Assert that the query returns no results because office has no closure (violates E)
        expect(results.length).toBe(0);
    });

    it("should handle nested existential conditions", async () => {
        const results = await parseAndExecute(`
            (office: Office [
                E {
                    closure: Office.Closed [
                        closure->office: Office = office
                        !E {
                            reopened: Office.Reopened [
                                reopened->officeClosed: Office.Closed = closure
                            ]
                        }
                    ]
                }
            ]) {
            } => office
        `, [closedOffice]);

        // Assert that the query returns no results because closedOffice has closure with reopened (violates !E)
        expect(results.length).toBe(0);
    });

    it("should handle nested existential conditions when not reopened", async () => {
        const results = await parseAndExecute(`
            (office: Office [
                E {
                    closure: Office.Closed [
                        closure->office: Office = office
                        !E {
                            reopened: Office.Reopened [
                                reopened->officeClosed: Office.Closed = closure
                            ]
                        }
                    ]
                }
            ]) {
            } => office
        `, [anotherClosedOffice]);

        // Assert that the query returns a result because anotherClosedOffice has closure with no reopened
        expect(results.length).toBe(1);
        expect(results[0].result.type).toBe("Office");
        expect(results[0].result.identifier).toBe("AnotherClosedOffice");
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

// NOTE: Given conditions are not yet implemented on IndexedDBStore.
// These tests will initially fail until the IndexedDB implementation
// supports given conditions in the SpecificationRunner.