"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
const companyModel_1 = require("../companyModel");
describe("specification inverse", () => {
    it("should invert successor", () => {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company));
        const inverses = fromSpecification(specification);
        expect(inverses).toEqual([`
            (u1: Office) {
                p1: Company [
                    p1 = u1->company: Company
                ]
            } => u1`
        ]);
    });
    it("should invert predecessor", () => {
        const specification = companyModel_1.model.given(companyModel_1.Office).match((office, facts) => facts.ofType(companyModel_1.Company)
            .join(company => company, office.company));
        const inverses = fromSpecification(specification);
        // With broader self-inverse coverage, specifications that reference givens get self-inverses
        expect(inverses).toEqual([`
            (p1: Office) {
                u1: Company [
                    u1 = p1->company: Company
                ]
            } => u1`
        ]);
    });
    it("should invert predecessor of successor", () => {
        const specification = companyModel_1.model.given(companyModel_1.Office).match((office, facts) => facts.ofType(companyModel_1.President)
            .join(president => president.office, office)
            .selectMany(president => facts.ofType(_src_1.User)
            .join(user => user, president.user)));
        const inverses = fromSpecification(specification);
        // Expect the inverse to filter out the specification starting from the other predecessor.
        expect(inverses).toEqual([`
            (u1: President) {
                p1: Office [
                    p1 = u1->office: Office
                ]
                u2: Jinaga.User [
                    u2 = u1->user: Jinaga.User
                ]
            } => u2`
        ]);
    });
    it("should invert negative existential condition", () => {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .notExists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)));
        const inverses = (0, _src_1.invertSpecification)(specification.specification);
        const formatted = formatInverses(inverses);
        expect(formatted).toEqual([`
            (u1: Office) {
                p1: Company [
                    p1 = u1->company: Company
                ]
            } => u1`, `
            (u2: Office.Closed) {
                u1: Office [
                    u1 = u2->office: Office
                ]
                p1: Company [
                    p1 = u1->company: Company
                ]
            } => u1`
        ]);
        expect(inverses[0].operation).toEqual("add");
        expect(inverses[1].operation).toEqual("remove");
    });
    it("should invert positive existential condition", () => {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .exists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)));
        const inverses = (0, _src_1.invertSpecification)(specification.specification);
        const formatted = formatInverses(inverses);
        // The second inverse is not satisfiable because the OfficeClosed
        // fact will not yet exist.
        expect(formatted).toEqual([`
            (u2: Office.Closed) {
                u1: Office [
                    u1 = u2->office: Office
                ]
                p1: Company [
                    p1 = u1->company: Company
                ]
            } => u1`
        ]);
        expect(inverses[0].operation).toEqual("add");
    });
    it("should invert restore pattern", () => {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .notExists(office => facts.ofType(companyModel_1.OfficeClosed)
            .join(officeClosed => officeClosed.office, office)
            .notExists(officeClosed => facts.ofType(companyModel_1.OfficeReopened)
            .join(officeReopened => officeReopened.officeClosed, officeClosed))));
        const inverses = (0, _src_1.invertSpecification)(specification.specification);
        const formatted = formatInverses(inverses);
        expect(formatted).toEqual([`
            (u1: Office) {
                p1: Company [
                    p1 = u1->company: Company
                ]
            } => u1`, `
            (u2: Office.Closed) {
                u1: Office [
                    u1 = u2->office: Office
                ]
                p1: Company [
                    p1 = u1->company: Company
                ]
            } => u1`, `
            (u3: Office.Reopened) {
                u2: Office.Closed [
                    u2 = u3->officeClosed: Office.Closed
                ]
                u1: Office [
                    u1 = u2->office: Office
                    !E {
                        u2: Office.Closed [
                            u2->office: Office = u1
                            !E {
                                u3: Office.Reopened [
                                    u3->officeClosed: Office.Closed = u2
                                ]
                            }
                        ]
                    }
                ]
                p1: Company [
                    p1 = u1->company: Company
                ]
            } => u1`
        ]);
        expect(inverses[0].operation).toEqual("add");
        expect(inverses[1].operation).toEqual("remove");
        expect(inverses[2].operation).toEqual("add");
        expect(inverses[0].parentSubset).toEqual(["p1"]);
        expect(inverses[1].parentSubset).toEqual(["p1"]);
        expect(inverses[2].parentSubset).toEqual(["p1"]);
        expect(inverses[0].path).toEqual("");
        expect(inverses[1].path).toEqual("");
        expect(inverses[2].path).toEqual("");
        expect(inverses[0].resultSubset).toEqual(["p1", "u1"]);
        expect(inverses[1].resultSubset).toEqual(["p1", "u1"]);
        expect(inverses[2].resultSubset).toEqual(["p1", "u1"]);
    });
    it("should invert child properties", () => {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company)
            .select(office => ({
            identifier: office.identifier,
            president: facts.ofType(companyModel_1.President)
                .join(president => president.office, office)
        })));
        const inverses = fromSpecification(specification);
        expect(inverses).toEqual([`
            (u1: Office) {
                p1: Company [
                    p1 = u1->company: Company
                ]
            } => {
                identifier = u1.identifier
                president = {
                    u2: President [
                        u2->office: Office = u1
                    ]
                } => u2
            }`, `
            (u2: President) {
                u1: Office [
                    u1 = u2->office: Office
                ]
                p1: Company [
                    p1 = u1->company: Company
                ]
            } => u2`
        ]);
    });
    it("should not include given in inverse when first step is a successor", () => {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.President)
            .join(president => president.office.company, company));
        const inverses = fromSpecification(specification);
        expect(inverses).toEqual([`
            (u1: President) {
                p1: Company [
                    p1 = u1->office: Office->company: Company
                ]
            } => u1`
        ]);
    });
    it("should include given in inverse when first step is a predecessor", () => {
        const specification = companyModel_1.model.given(companyModel_1.Office).match((office, facts) => facts.ofType(companyModel_1.President)
            .join(president => president.office.company, office.company));
        const inverses = fromSpecification(specification);
        expect(inverses).toEqual([`
            (p1: Office) {
                u1: President [
                    u1->office: Office->company: Company = p1->company: Company
                ]
            } => u1`, `
            (u1: President) {
                p1: Office [
                    p1->company: Company = u1->office: Office->company: Company
                ]
            } => u1`
        ]);
    });
    it("should keep existential condition if based on predecessor", () => {
        const specification = companyModel_1.model.given(companyModel_1.Company).match(company => company.successors(companyModel_1.President, president => president.office.company)
            .exists(president => president.office.successors(companyModel_1.OfficeClosed, officeClosed => officeClosed.office)
            .notExists(officeClosed => officeClosed.successors(companyModel_1.OfficeReopened, officeReopened => officeReopened.officeClosed))));
        const description = "\n" + (0, _src_1.describeSpecification)(specification.specification, 3).trimEnd();
        expect(description).toEqual(`
            (p1: Company) {
                u1: President [
                    u1->office: Office->company: Company = p1
                    E {
                        u2: Office.Closed [
                            u2->office: Office = u1->office: Office
                            !E {
                                u3: Office.Reopened [
                                    u3->officeClosed: Office.Closed = u2
                                ]
                            }
                        ]
                    }
                ]
            } => u1`);
        const inverses = fromSpecification(specification);
        expect(inverses).toEqual([`
            (u1: President [
                E {
                    u2: Office.Closed [
                        u2->office: Office = u1->office: Office
                        !E {
                            u3: Office.Reopened [
                                u3->officeClosed: Office.Closed = u2
                            ]
                        }
                    ]
                }
            ]) {
                p1: Company [
                    p1 = u1->office: Office->company: Company
                ]
            } => u1`, `
            (u2: Office.Closed) {
                u1: President [
                    u1->office: Office = u2->office: Office
                ]
                p1: Company [
                    p1 = u1->office: Office->company: Company
                ]
            } => u1`, `
            (u3: Office.Reopened) {
                u2: Office.Closed [
                    u2 = u3->officeClosed: Office.Closed
                ]
                u1: President [
                    u1->office: Office = u2->office: Office
                    E {
                        u2: Office.Closed [
                            u2->office: Office = u1->office: Office
                            !E {
                                u3: Office.Reopened [
                                    u3->officeClosed: Office.Closed = u2
                                ]
                            }
                        ]
                    }
                ]
                p1: Company [
                    p1 = u1->office: Office->company: Company
                ]
            } => u1`
        ]);
    });
});
function fromSpecification(specification) {
    const inverses = (0, _src_1.invertSpecification)(specification.specification);
    return formatInverses(inverses);
}
function formatInverses(inverses) {
    return inverses
        .map(i => {
        const desription = (0, _src_1.describeSpecification)(i.inverseSpecification, 3);
        return "\n" + desription.substring(0, desription.length - 1);
    });
}
//# sourceMappingURL=inverseSpec.js.map