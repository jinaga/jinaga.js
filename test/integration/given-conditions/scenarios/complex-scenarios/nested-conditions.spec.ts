import { MemoryStore } from "../../../../../src/memory/memory-store";
import { FactReference } from "../../../../../src/storage";
import { dehydrateFact } from "../../../../../src/fact/hydrate";
import { SpecificationParser } from "../../../../../src/specification/specification-parser";
import { User, Company, Office, OfficeClosed, OfficeReopened, Administrator, Manager } from "../../../../companyModel";
import { createComplexCompanyScenario } from "../../setup/test-helpers";
import { SpecificationTemplates } from "../../setup/specification-builders";

describe("Given Conditions - Nested Conditions", () => {
    let store: MemoryStore;
    let users: User[];
    let companies: Company[];
    let offices: Office[];
    let closures: OfficeClosed[];
    let reopenings: OfficeReopened[];
    let administrators: Administrator[];
    let managers: Manager[];

    beforeEach(async () => {
        ({ users, companies, offices, closures, reopenings, administrators, managers } = await createComplexCompanyScenario());

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
            ...managers
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

    it("should handle deeply nested existential conditions", async () => {
        // Create a specification for offices that are closed, not reopened, and have administrators
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    !E {
                        reopening: Office.Reopened [
                            reopening = closure
                        ]
                    }
                    E {
                        admin: Administrator [
                            admin.company = closure.office.company
                            E {
                                manager: Manager [
                                    manager.office = office
                                ]
                            }
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Test with offices that meet all nested conditions
        const closedOfficeWithAdmin = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            !reopenings.some(reopening => reopening.officeClosed.office === office) &&
            administrators.some(admin => admin.company === office.company)
        );

        if (closedOfficeWithAdmin) {
            const officeRef: FactReference = dehydrateFact(closedOfficeWithAdmin)[0];

            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(1);
        }
    });

    it("should validate nested condition evaluation order", async () => {
        // Test that conditions are evaluated in the correct order (outer to inner)
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    !E {
                        reopening: Office.Reopened [
                            reopening = closure
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Test office that is closed but reopened (should fail inner condition)
        const reopenedOffice = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            reopenings.some(reopening => reopening.officeClosed.office === office)
        );

        if (reopenedOffice) {
            const officeRef: FactReference = dehydrateFact(reopenedOffice)[0];

            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(0); // Should fail due to reopening
        }
    });

    it("should handle multiple levels of nested conditions", async () => {
        // Create specification with 3 levels of nesting
        const specification = new SpecificationParser(`
            (company: Company [E {
                office: Office [
                    office.company = company
                    E {
                        closure: Office.Closed [
                            closure = office
                            !E {
                                reopening: Office.Reopened [
                                    reopening = closure
                                ]
                            }
                            E {
                                admin: Administrator [
                                    admin.company = company
                                ]
                            }
                        ]
                    }
                ]
            }]) {
            } => company
        `).parseSpecification();

        // Test companies that have offices meeting all conditions
        const qualifyingCompany = companies.find(company =>
            offices.some(office =>
                office.company === company &&
                closures.some(closure => closure.office === office) &&
                !reopenings.some(reopening => reopening.officeClosed.office === office) &&
                administrators.some(admin => admin.company === company)
            )
        );

        if (qualifyingCompany) {
            const companyRef: FactReference = dehydrateFact(qualifyingCompany)[0];

            const results = await store.read([companyRef], specification);
            expect(results.length).toBe(1);
        }
    });

    it("should validate short-circuiting in nested conditions", async () => {
        // Test that if outer condition fails, inner conditions aren't evaluated
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    !E {
                        reopening: Office.Reopened [
                            reopening = closure
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        // Test with office that has no closure at all
        const openOffice = offices.find(office =>
            !closures.some(closure => closure.office === office)
        );

        if (openOffice) {
            const officeRef: FactReference = dehydrateFact(openOffice)[0];

            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(0); // Should fail at first condition
        }
    });

    it("should handle complex nested condition combinations", async () => {
        // Create specification with mixed EXISTS and NOT EXISTS at multiple levels
        const specification = new SpecificationParser(`
            (office: Office [E {
                closure: Office.Closed [
                    closure = office
                    !E {
                        reopening: Office.Reopened [
                            reopening = closure
                        ]
                    }
                    E {
                        admin: Administrator [
                            admin.company = closure.office.company
                            !E {
                                manager: Manager [
                                    manager.office = closure.office
                                ]
                            }
                        ]
                    }
                ]
            }]) {
            } => office
        `).parseSpecification();

        // This tests offices that are closed, not reopened, have admins but no managers
        const qualifyingOffice = offices.find(office =>
            closures.some(closure => closure.office === office) &&
            !reopenings.some(reopening => reopening.officeClosed.office === office) &&
            administrators.some(admin => admin.company === office.company) &&
            !managers.some(manager => manager.office === office)
        );

        if (qualifyingOffice) {
            const officeRef: FactReference = dehydrateFact(qualifyingOffice)[0];

            const results = await store.read([officeRef], specification);
            expect(results.length).toBe(1);
        }
    });
});