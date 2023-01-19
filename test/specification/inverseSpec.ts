import { describeSpecification } from "../../src/specification/description";
import { SpecificationOf } from "../../src/specification/given";
import { invertSpecification, SpecificationInverse } from "../../src/specification/inverse";
import { Company, model, Office, OfficeClosed, OfficeReopened, President, User } from "./model";

describe("specification inverse", () => {
    it("should invert successor", () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

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
        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(Company)
                .join(company => company, office.company)
        );

        const inverses = fromSpecification(specification);

        // When the predecessor is created, it does not have a successor yet.
        expect(inverses).toEqual([]);
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

        const inverses = fromSpecification(specification);

        // Expect the inverse to filter out the specification starting from the other predecessor.
        expect(inverses).toEqual([`
            (u1: President) {
                p1: Office [
                    p1 = u1->office: Office
                ]
                u2: User [
                    u2 = u1->user: User
                ]
            } => u2`
        ]);
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
        const formatted = formatInverses(inverses);

        expect(formatted).toEqual([`
            (u1: Office) {
                p1: Company [
                    p1 = u1->company: Company
                ]
            } => u1`,`
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
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .exists(office =>
                    facts.ofType(OfficeClosed)
                        .join(officeClosed => officeClosed.office, office)
                )
        );

        const inverses = invertSpecification(specification.specification);
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
        const formatted = formatInverses(inverses);

        expect(formatted).toEqual([`
            (u1: Office) {
                p1: Company [
                    p1 = u1->company: Company
                ]
            } => u1`,`
            (u2: Office.Closed) {
                u1: Office [
                    u1 = u2->office: Office
                ]
                p1: Company [
                    p1 = u1->company: Company
                ]
            } => u1`,`
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
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
                .select(office => ({
                    identifier: office.identifier,
                    president: facts.ofType(President)
                        .join(president => president.office, office)
                }))
        );

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
            }`,`
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
});

function fromSpecification<T, U>(specification: SpecificationOf<T, U>) {
    const inverses = invertSpecification(specification.specification);
    return formatInverses(inverses);
}

function formatInverses(inverses: SpecificationInverse[]) {
    return inverses
        .map(i => {
            const desription = describeSpecification(i.inverseSpecification, 3);
            return "\n" + desription.substring(0, desription.length - 1);
        });
}
