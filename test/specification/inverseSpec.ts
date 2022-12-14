import { describeSpecification } from "../../src/specification/description";
import { SpecificationOf } from "../../src/specification/given";
import { invertSpecification } from "../../src/specification/inverse";
import { Company, model, Office, OfficeClosed, President, User } from "./model";

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

    it("should invert successor of predecessor", () => {
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

        const inverses = fromSpecification(specification);

        expect(inverses).toEqual([`
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
    return invertSpecification(specification.specification)
        .map(i => {
            const desription = describeSpecification(i.specification, 3);
            return "\n" + desription.substring(0, desription.length - 1);
        });
}
