"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
const indexeddb_store_1 = require("../../src/indexeddb/indexeddb-store");
const companyModel_1 = require("../companyModel");
const isIndexedDBAvailable = typeof indexedDB !== 'undefined';
const describeFunc = isIndexedDBAvailable ? describe : describe.skip;
describeFunc("query given conditions - IndexedDB", () => {
    let store;
    let office;
    let closedOffice;
    let anotherClosedOffice;
    let company;
    let dbName;
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        if (!isIndexedDBAvailable) {
            return;
        }
        // Use a unique database name for each test run
        dbName = `test-query-given-conditions-${Date.now()}-${Math.random()}`;
        store = new indexeddb_store_1.IndexedDBStore(dbName);
        // Create facts
        const creator = new _src_1.User("--- PUBLIC KEY GOES HERE ---");
        company = new companyModel_1.Company(creator, "TestCo");
        office = new companyModel_1.Office(company, "TestOffice");
        closedOffice = new companyModel_1.Office(company, "ClosedOffice");
        anotherClosedOffice = new companyModel_1.Office(company, "AnotherClosedOffice");
        const closed = new companyModel_1.OfficeClosed(closedOffice, new Date());
        const anotherClosed = new companyModel_1.OfficeClosed(anotherClosedOffice, new Date());
        const reopened = new companyModel_1.OfficeReopened(closed);
        // Save facts to store
        const dehydration = new _src_1.Dehydration();
        dehydration.dehydrate(creator);
        dehydration.dehydrate(company);
        dehydration.dehydrate(office);
        dehydration.dehydrate(closedOffice);
        dehydration.dehydrate(closed);
        dehydration.dehydrate(anotherClosedOffice);
        dehydration.dehydrate(anotherClosed);
        dehydration.dehydrate(reopened);
        yield store.save(dehydration.factRecords().map((f) => ({
            fact: f,
            signatures: []
        })));
    }));
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        // Clean up the IndexedDB database
        if (store) {
            yield store.close();
        }
        // Delete the database
        const deleteRequest = indexedDB.deleteDatabase(dbName);
        yield new Promise((resolve, reject) => {
            deleteRequest.onsuccess = () => resolve(undefined);
            deleteRequest.onerror = () => reject(deleteRequest.error);
            deleteRequest.onblocked = () => reject(new Error('Database deletion blocked'));
        });
    }));
    it("should execute query with simple given without conditions", () => __awaiter(void 0, void 0, void 0, function* () {
        const results = yield parseAndExecute(`
            (office: Office) {
            } => office
        `, [office]);
        expect(results.length).toBe(1);
        expect(results[0].result.type).toBe("Office");
        expect(results[0].result.identifier).toBe("TestOffice");
    }));
    it("should match if negative existential condition is satisfied", () => __awaiter(void 0, void 0, void 0, function* () {
        const results = yield parseAndExecute(`
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
    }));
    it("should not match if negative existential condition is not satisfied", () => __awaiter(void 0, void 0, void 0, function* () {
        const results = yield parseAndExecute(`
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
    }));
    it("should not match if positive existential condition is not satisfied", () => __awaiter(void 0, void 0, void 0, function* () {
        const results = yield parseAndExecute(`
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
    }));
    it("should handle multiple givens with different conditions", () => __awaiter(void 0, void 0, void 0, function* () {
        const results = yield parseAndExecute(`
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
    }));
    it("should handle conditions that reference prior givens", () => __awaiter(void 0, void 0, void 0, function* () {
        const results = yield parseAndExecute(`
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
    }));
    it("should match if positive existential condition is satisfied", () => __awaiter(void 0, void 0, void 0, function* () {
        const results = yield parseAndExecute(`
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
    }));
    it("should handle multiple conditions on same given", () => __awaiter(void 0, void 0, void 0, function* () {
        const results = yield parseAndExecute(`
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
    }));
    it("should handle mixed condition types on single given", () => __awaiter(void 0, void 0, void 0, function* () {
        const results = yield parseAndExecute(`
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
    }));
    it("should handle nested existential conditions", () => __awaiter(void 0, void 0, void 0, function* () {
        const results = yield parseAndExecute(`
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
    }));
    it("should handle nested existential conditions when not reopened", () => __awaiter(void 0, void 0, void 0, function* () {
        const results = yield parseAndExecute(`
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
    }));
    function parseAndExecute(specText, given) {
        return __awaiter(this, void 0, void 0, function* () {
            // Parse the specification from text
            const parser = new _src_1.SpecificationParser(specText);
            parser.skipWhitespace();
            const specification = parser.parseSpecification();
            // Execute the specification with read
            const givenRef = given.map(o => (0, _src_1.dehydrateReference)(o));
            const results = yield store.read(givenRef, specification);
            return results;
        });
    }
});
// NOTE: Given conditions are not yet implemented on IndexedDBStore.
// These tests will initially fail until the IndexedDB implementation
// supports given conditions in the SpecificationRunner.
//# sourceMappingURL=queryGivenConditionsIndexedDBSpec.js.map