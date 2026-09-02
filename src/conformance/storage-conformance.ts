import { Dehydration, dehydrateReference, HashMap } from "../fact/hydrate";
import { SpecificationParser } from "../specification/specification-parser";
import { FactEnvelope, ProjectedResult, Storage } from "../storage";

/**
 * Produces the store under test. Called once before each conformance test, so
 * each test observes a store that contains only the fixture graph.
 */
export type StorageFactory = () => Storage | Promise<Storage>;

/**
 * Releases whatever the factory allocated. Called after each conformance test,
 * including when the test failed.
 */
export type StorageTeardown = (store: Storage) => void | Promise<void>;

/**
 * The fixture graph the conformance suite reads.
 *
 * One company with three offices. `ClosedOffice` is closed and then reopened;
 * `AnotherClosedOffice` is closed and stays closed; `TestOffice` was never
 * closed. That is the smallest graph that separates a positive existential
 * condition from a negative one, and a nested condition from a flat one.
 *
 * These are plain objects rather than model classes so that the kit carries no
 * dependency on this repository's test fixtures.
 */
function buildFixture() {
    const creator: HashMap = {
        type: "Jinaga.User",
        publicKey: "--- PUBLIC KEY GOES HERE ---"
    };
    const company: HashMap = {
        type: "Company",
        creator,
        identifier: "TestCo"
    };
    const office: HashMap = {
        type: "Office",
        company,
        identifier: "TestOffice"
    };
    const closedOffice: HashMap = {
        type: "Office",
        company,
        identifier: "ClosedOffice"
    };
    const anotherClosedOffice: HashMap = {
        type: "Office",
        company,
        identifier: "AnotherClosedOffice"
    };
    const closed: HashMap = {
        type: "Office.Closed",
        office: closedOffice,
        date: new Date("2026-01-01T00:00:00.000Z")
    };
    const anotherClosed: HashMap = {
        type: "Office.Closed",
        office: anotherClosedOffice,
        date: new Date("2026-01-01T00:00:00.000Z")
    };
    const reopened: HashMap = {
        type: "Office.Reopened",
        officeClosed: closed
    };

    const dehydration = new Dehydration();
    for (const fact of [creator, company, office, closedOffice, closed, anotherClosedOffice, anotherClosed, reopened]) {
        dehydration.dehydrate(fact);
    }
    const envelopes = dehydration.factRecords().map(fact => <FactEnvelope>({
        fact,
        signatures: []
    }));

    return { company, office, closedOffice, anotherClosedOffice, envelopes };
}

/**
 * Runs the storage conformance suite against an implementation of `Storage`.
 *
 * The suite defines what `read` is supposed to return. `MemoryStore` answers it
 * by interpreting the specification; a SQL-backed store answers it by compiling
 * one. This suite is how an implementation demonstrates that it agrees with the
 * reference semantics rather than merely resembling them.
 *
 * ```ts
 * describeStorageConformance("MemoryStore", () => new MemoryStore());
 * ```
 *
 * Call it from a test file in a Jest-compatible runner; it registers a
 * `describe` block of its own.
 *
 * @param name Identifies the implementation in the test report.
 * @param createStore Produces a store containing no facts.
 * @param teardown Releases the store produced by `createStore`.
 */
export function describeStorageConformance(
    name: string,
    createStore: StorageFactory,
    teardown?: StorageTeardown
): void {
    describe(`storage conformance: ${name}`, () => {
        let store: Storage;
        let fixture: ReturnType<typeof buildFixture>;

        beforeEach(async () => {
            fixture = buildFixture();
            store = await createStore();
            await store.save(fixture.envelopes);
        });

        afterEach(async () => {
            if (teardown && store) {
                await teardown(store);
            }
        });

        async function parseAndExecute(specText: string, given: HashMap[]): Promise<ProjectedResult[]> {
            const parser = new SpecificationParser(specText);
            parser.skipWhitespace();
            const specification = parser.parseSpecification();

            const givenRef = given.map(o => dehydrateReference(o));
            return await store.read(givenRef, specification);
        }

        it("should execute query with simple given without conditions", async () => {
            const results = await parseAndExecute(`
                (office: Office) {
                } => office
            `, [fixture.office]);

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
            `, [fixture.office]);

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
            `, [fixture.closedOffice]);

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
            `, [fixture.office]);

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
            `, [fixture.closedOffice, fixture.company]);

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
            `, [fixture.office, fixture.company]);

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
            `, [fixture.closedOffice]);

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
            `, [fixture.closedOffice]);

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
            `, [fixture.office]);

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
            `, [fixture.closedOffice]);

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
            `, [fixture.anotherClosedOffice]);

            // Assert that the query returns a result because anotherClosedOffice has closure with no reopened
            expect(results.length).toBe(1);
            expect(results[0].result.type).toBe("Office");
            expect(results[0].result.identifier).toBe("AnotherClosedOffice");
        });
    });
}
