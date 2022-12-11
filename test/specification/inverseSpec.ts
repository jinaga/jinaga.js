import { describeSpecification } from "../../src/specification/description";
import { SpecificationOf } from "../../src/specification/given";
import { invertSpecification } from "../../src/specification/inverse";
import { Company, model, Office } from "./model";

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
            }`
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
