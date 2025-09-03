import { dehydrateFact, FactReference, MemoryStore, SpecificationParser } from "@src";
import { Administrator, Company, Employee, Manager, Office, OfficeClosed, OfficeReopened, User } from "../../../companyModel";
import { createComplexCompanyScenario } from "../../setup/test-data-factories";

describe("Given Conditions - Multi-Given Scenarios", () => {
    let store: MemoryStore;
    let users: User[];
    let companies: Company[];
    let offices: Office[];
    let closures: OfficeClosed[];
    let reopenings: OfficeReopened[];
    let administrators: Administrator[];
    let managers: Manager[];
    let employees: Employee[];

    beforeEach(async () => {
        ({ users, companies, offices, closures, reopenings, administrators, managers, employees } = await createComplexCompanyScenario());

        // Create memory store and populate with test data
        store = new MemoryStore();

        // Save all facts to the store
        const allFacts = [
            ...users,
            ...companies,
            ...offices,
            ...closures,
            ...reopenings,
            ...administrators,
            ...managers,
            ...employees
        ];

        for (const fact of allFacts) {
            const dehydrated = dehydrateFact(fact);
            const envelopes = dehydrated.map(record => ({
                fact: record,
                signatures: []
            }));
            await store.save(envelopes);
        }
    });

    it("should handle multiple givens with mixed conditions", async () => {
        // Specification with company and office givens, where office has conditions but company doesn't
        const specification = new SpecificationParser(`
            (company: Company, office: Office [E {
                closure: Office.Closed [
                    closure = office
                    !E {
                        reopening: Office.Reopened [
                            reopening = closure
                        ]
                    }
                ]
            }]) {
            } => {
                company = company
                office = office
            }
        `).parseSpecification();

        // Test with a company and its closed-not-reopened office
        const testCompany = companies[0];
        const testOffice = offices.find(office =>
            office.company === testCompany &&
            closures.some(closure => closure.office === office) &&
            !reopenings.some(reopening => reopening.officeClosed.office === office)
        );

        if (testOffice) {
            const companyRef: FactReference = dehydrateFact(testCompany)[0];
            const officeRef: FactReference = dehydrateFact(testOffice)[0];

            const results = await store.read([companyRef, officeRef], specification);
            expect(results.length).toBe(1);
            expect(results[0].result.company.type).toBe("Company");
            expect(results[0].result.office.type).toBe("Office");
        }
    });

    it("should validate that all givens must satisfy their conditions", async () => {
        // Specification requiring both givens to have conditions
        const specification = new SpecificationParser(`
            (company: Company [E {
                admin: Administrator [
                    admin.company = company
                ]
            }], office: Office [E {
                closure: Office.Closed [
                    closure = office
                ]
            }]) {
            } => {
                company = company
                office = office
            }
        `).parseSpecification();

        // Test with company that has admin and office that is closed
        const qualifiedCompany = companies.find(company =>
            administrators.some(admin => admin.company === company)
        );
        const qualifiedOffice = offices.find(office =>
            closures.some(closure => closure.office === office)
        );

        if (qualifiedCompany && qualifiedOffice) {
            const companyRef: FactReference = dehydrateFact(qualifiedCompany)[0];
            const officeRef: FactReference = dehydrateFact(qualifiedOffice)[0];

            const results = await store.read([companyRef, officeRef], specification);
            expect(results.length).toBe(1);
        }

        // Test with company without admin (should fail)
        const unqualifiedCompany = companies.find(company =>
            !administrators.some(admin => admin.company === company)
        );

        if (unqualifiedCompany && qualifiedOffice) {
            const companyRef: FactReference = dehydrateFact(unqualifiedCompany)[0];
            const officeRef: FactReference = dehydrateFact(qualifiedOffice)[0];

            const results = await store.read([companyRef, officeRef], specification);
            expect(results.length).toBe(0); // Should fail due to company condition
        }
    });

    it("should handle givens with correlated conditions", async () => {
        // Specification where conditions correlate the givens
        const specification = new SpecificationParser(`
            (company: Company, office: Office [E {
                closure: Office.Closed [
                    closure = office
                    closure.office.company = company
                ]
            }]) {
            } => {
                company = company
                office = office
            }
        `).parseSpecification();

        // Test with company and its own closed office
        const testCompany = companies[0];
        const testOffice = offices.find(office =>
            office.company === testCompany &&
            closures.some(closure => closure.office === office)
        );

        if (testOffice) {
            const companyRef: FactReference = dehydrateFact(testCompany)[0];
            const officeRef: FactReference = dehydrateFact(testOffice)[0];

            const results = await store.read([companyRef, officeRef], specification);
            expect(results.length).toBe(1);
        }

        // Test with company and office from different company (should fail correlation)
        const otherCompany = companies[1];
        const otherOffice = offices.find(office =>
            office.company === otherCompany &&
            closures.some(closure => closure.office === office)
        );

        if (otherCompany && otherOffice && testCompany !== otherCompany) {
            const companyRef: FactReference = dehydrateFact(testCompany)[0];
            const officeRef: FactReference = dehydrateFact(otherOffice)[0];

            const results = await store.read([companyRef, officeRef], specification);
            expect(results.length).toBe(0); // Should fail due to correlation mismatch
        }
    });

    it("should support complex multi-given scenarios with nested conditions", async () => {
        // Specification with three givens and complex nested conditions
        const specification = new SpecificationParser(`
            (company: Company, office: Office, user: User [E {
                admin: Administrator [
                    admin.company = company
                    admin.user = user
                    E {
                        manager: Manager [
                            manager.office = office
                            !E {
                                termination: Manager.Terminated [
                                    termination.manager = manager
                                ]
                            }
                        ]
                    }
                ]
            }]) {
            } => {
                company = company
                office = office
                user = user
            }
        `).parseSpecification();

        // Find a scenario that matches all conditions
        const matchingScenario = administrators.find(admin => {
            const office = offices.find(o => o.company === admin.company);
            const manager = managers.find(m => m.office === office);
            return office && manager && !employees.some(emp => emp.office === office && emp.user === admin.user);
        });

        if (matchingScenario) {
            const companyRef: FactReference = dehydrateFact(matchingScenario.company)[0];
            const officeRef: FactReference = {
                type: "Office",
                hash: dehydrateFact(offices.find(o => o.company === matchingScenario.company)!)[0].hash
            };
            const userRef: FactReference = dehydrateFact(matchingScenario.user)[0];

            const results = await store.read([companyRef, officeRef, userRef], specification);
            expect(results.length).toBe(1);
        }
    });

    it("should validate early termination when any given fails its condition", async () => {
        // Specification with multiple givens where one has a failing condition
        const specification = new SpecificationParser(`
            (company: Company [E {
                admin: Administrator [
                    admin.company = company
                ]
            }], office: Office [!E {
                closure: Office.Closed [
                    closure = office
                ]
            }]) {
            } => {
                company = company
                office = office
            }
        `).parseSpecification();

        // Test with qualified company but closed office (should fail office condition)
        const qualifiedCompany = companies.find(company =>
            administrators.some(admin => admin.company === company)
        );
        const closedOffice = offices.find(office =>
            closures.some(closure => closure.office === office)
        );

        if (qualifiedCompany && closedOffice) {
            const companyRef: FactReference = dehydrateFact(qualifiedCompany)[0];
            const officeRef: FactReference = dehydrateFact(closedOffice)[0];

            const results = await store.read([companyRef, officeRef], specification);
            expect(results.length).toBe(0); // Should fail due to office being closed
        }
    });
});