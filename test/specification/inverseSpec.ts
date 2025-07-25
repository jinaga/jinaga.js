import { describeSpecification, invertSpecification, SpecificationInverse, SpecificationOf } from "../../src";
import { validateSpecificationInvariant } from "../../src/specification/inverse";
import { Company, model, Office, OfficeClosed, OfficeReopened, President, User } from "../companyModel";

describe("specification inverse", () => {
    it("should invert successor", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const inverses = invertSpecification(specification.specification);
        
        // Validate that all inverse specifications meet the required invariants
        expect(inverses.length).toBe(1);
        expect(() => validateSpecificationInvariant(inverses[0].inverseSpecification)).not.toThrow();
        
        // Verify the structure: one Office match that references Company
        const inverse = inverses[0];
        expect(inverse.operation).toBe("add");
        expect(inverse.inverseSpecification.given).toEqual([{ name: "u1", type: "Office" }]);
        expect(inverse.inverseSpecification.matches.length).toBe(1);
        
        const companyMatch = inverse.inverseSpecification.matches[0];
        expect(companyMatch.unknown.type).toBe("Company");
        expect(companyMatch.conditions.length).toBeGreaterThan(0);
        expect(companyMatch.conditions[0].type).toBe("path");
    });

    it("should invert predecessor", () => {
        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(Company)
                .join(company => company, office.company)
        );

        const inverses = invertSpecification(specification.specification);

        // When the predecessor is created, it does not have a successor yet.
        // The algorithm should either produce no inverses or valid ones
        for (const inverse of inverses) {
            expect(() => validateSpecificationInvariant(inverse.inverseSpecification)).not.toThrow();
        }
    });

    it("should invert predecessor of successor", () => {
        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(President)
                .join(president => president.office, office)
                .selectMany(president =>
                    facts.ofType(User)
                        .join(user => user, president.user)
                )
        );

        const inverses = invertSpecification(specification.specification);

        // Validate that all inverse specifications meet the required invariants
        expect(inverses.length).toBe(1);
        expect(() => validateSpecificationInvariant(inverses[0].inverseSpecification)).not.toThrow();
        
        // Verify the structure: President match that connects to Office and User
        const inverse = inverses[0];
        expect(inverse.operation).toBe("add");
        expect(inverse.inverseSpecification.given[0].type).toBe("President");
        
        // Should have Office and User matches that properly reference the President
        expect(inverse.inverseSpecification.matches.length).toBe(2);
        for (const match of inverse.inverseSpecification.matches) {
            if (match.conditions.length > 0) {
                expect(match.conditions[0].type).toBe("path");
            }
        }
    });

    it("should invert negative existential condition", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .notExists(office =>
                    facts.ofType(OfficeClosed)
                        .join(officeClosed => officeClosed.office, office)
                )
        );

        const inverses = invertSpecification(specification.specification);

        // Validate that all inverse specifications meet the required invariants
        expect(inverses.length).toBe(2);
        for (const inverse of inverses) {
            expect(() => validateSpecificationInvariant(inverse.inverseSpecification)).not.toThrow();
        }
        
        // First inverse should be for Office (add operation)
        const officeInverse = inverses.find(inv => inv.inverseSpecification.given[0].type === "Office");
        expect(officeInverse).toBeDefined();
        expect(officeInverse!.operation).toBe("add");
        
        // Second inverse should be for OfficeClosed (remove operation)
        const closedInverse = inverses.find(inv => inv.inverseSpecification.given[0].type === "Office.Closed");
        expect(closedInverse).toBeDefined();
        expect(closedInverse!.operation).toBe("remove");
    });

    it("should invert positive existential condition", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .exists(office =>
                    facts.ofType(OfficeClosed)
                        .join(officeClosed => officeClosed.office, office)
                )
        );

        const inverses = invertSpecification(specification.specification);

        // Validate that all inverse specifications meet the required invariants
        for (const inverse of inverses) {
            expect(() => validateSpecificationInvariant(inverse.inverseSpecification)).not.toThrow();
        }
        
        // Should have at least one inverse for OfficeClosed (add operation)
        const closedInverse = inverses.find(inv => inv.inverseSpecification.given[0].type === "Office.Closed");
        expect(closedInverse).toBeDefined();
        expect(closedInverse!.operation).toBe("add");
    });

    it("should invert restore pattern", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .notExists(office =>
                    facts.ofType(OfficeClosed)
                        .join(officeClosed => officeClosed.office, office)
                        .notExists(officeClosed =>
                            facts.ofType(OfficeReopened)
                                .join(officeReopened => officeReopened.officeClosed, officeClosed)
                        )
                )
        );

        const inverses = invertSpecification(specification.specification);

        // Validate that all inverse specifications meet the required invariants
        expect(inverses.length).toBe(3);
        for (const inverse of inverses) {
            expect(() => validateSpecificationInvariant(inverse.inverseSpecification)).not.toThrow();
        }

        // Find the different types of inverses
        const officeInverse = inverses.find(inv => inv.inverseSpecification.given[0].type === "Office");
        const closedInverse = inverses.find(inv => inv.inverseSpecification.given[0].type === "Office.Closed");
        const reopenedInverse = inverses.find(inv => inv.inverseSpecification.given[0].type === "Office.Reopened");

        expect(officeInverse).toBeDefined();
        expect(closedInverse).toBeDefined();
        expect(reopenedInverse).toBeDefined();

        expect(officeInverse!.operation).toBe("add");
        expect(closedInverse!.operation).toBe("remove");
        expect(reopenedInverse!.operation).toBe("add");

        // Verify subset properties are correct
        for (const inverse of inverses) {
            expect(inverse.parentSubset).toEqual(["p1"]);
            expect(inverse.path).toBe("");
            expect(inverse.resultSubset).toContain("p1");
            expect(inverse.resultSubset).toContain("u1");
        }
    });

    it("should invert child properties", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .select(office => ({
                    identifier: office.identifier,
                    president: facts.ofType(President)
                        .join(president => president.office, office)
                }))
        );

        const inverses = invertSpecification(specification.specification);

        // Validate that all inverse specifications meet the required invariants
        expect(inverses.length).toBe(2);
        for (const inverse of inverses) {
            expect(() => validateSpecificationInvariant(inverse.inverseSpecification)).not.toThrow();
        }

        // Find the different types of inverses
        const officeInverse = inverses.find(inv => inv.inverseSpecification.given[0].type === "Office");
        const presidentInverse = inverses.find(inv => inv.inverseSpecification.given[0].type === "President");

        expect(officeInverse).toBeDefined();
        expect(presidentInverse).toBeDefined();

        // Both should be add operations
        expect(officeInverse!.operation).toBe("add");
        expect(presidentInverse!.operation).toBe("add");

        // Verify the Office inverse has a Company match with path condition
        expect(officeInverse!.inverseSpecification.matches.length).toBeGreaterThan(0);
        const companyMatch = officeInverse!.inverseSpecification.matches.find(m => m.unknown.type === "Company");
        expect(companyMatch).toBeDefined();
        expect(companyMatch!.conditions.length).toBeGreaterThan(0);
        expect(companyMatch!.conditions[0].type).toBe("path");

        // Verify the President inverse properly references Office and Company
        expect(presidentInverse!.inverseSpecification.matches.length).toBeGreaterThan(0);
        const officeMatchInPresident = presidentInverse!.inverseSpecification.matches.find(m => m.unknown.type === "Office");
        expect(officeMatchInPresident).toBeDefined();
        if (officeMatchInPresident!.conditions.length > 0) {
            expect(officeMatchInPresident!.conditions[0].type).toBe("path");
        }
    });
});

// Helper function to validate inverse specifications
function validateInverseOperations(inverses: SpecificationInverse[], expectedOperations: string[]) {
    expect(inverses.length).toBe(expectedOperations.length);
    for (let i = 0; i < inverses.length; i++) {
        expect(inverses[i].operation).toBe(expectedOperations[i]);
        expect(() => validateSpecificationInvariant(inverses[i].inverseSpecification)).not.toThrow();
    }
}
