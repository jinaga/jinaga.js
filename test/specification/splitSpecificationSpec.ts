import { describeSpecification } from "../../src/specification/description";
import { Specification, splitAtFirstPredecessor } from "../../src/specification/specification";
import { Company, model, Office } from "./model";

describe('Split specification', () => {
  it('should put all in head if only predecessor joins', () => {
    const specification = model.given(Office).match((office, facts) =>
      facts.ofType(Company)
        .join(company => company, office.company)
    );

    const { head, tail } = splitAtFirstPredecessor(specification.specification);
    expect(tail).toBeUndefined();
    expect(head).toBeDefined();
    expect(describeSpecification(head as Specification, 0)).toEqual(describeSpecification(specification.specification, 0));
  });
});