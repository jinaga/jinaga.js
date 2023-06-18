import { describeSpecification } from "../../src/specification/description";
import { Specification, splitBeforeFirstSuccessor } from "../../src/specification/specification";
import { Company, Employee, Office, President, model } from "../companyModel";

describe('Split specification', () => {
    it('should put all in head if only predecessor joins', () => {
        const specification = model.given(Office).match((office, facts) =>
            facts.ofType(Company)
                .join(company => company, office.company)
        );

        const { head, tail } = splitBeforeFirstSuccessor(specification.specification);
        expect(tail).toBeUndefined();
        expect(head).toBeDefined();
        expect(describeSpecification(head as Specification, 0)).toEqual(describeSpecification(specification.specification, 0));
    });

    it('should put all in tail if only successor joins', () => {
        const specification = model.given(Company).match((company, facts) =>
            facts.ofType(Office)
                .join(office => office.company, company)
        );

        const { head, tail } = splitBeforeFirstSuccessor(specification.specification);
        expect(head).toBeUndefined();
        expect(tail).toBeDefined();
        expect(describeSpecification(tail as Specification, 0)).toEqual(describeSpecification(specification.specification, 0));
    });

    it('should split if predecessor and then successor', () => {
        const specification = model.given(Employee).match((employee, facts) =>
            facts.ofType(Office)
                .join(office => office, employee.office)
                .selectMany(office => facts.ofType(President)
                    .join(president => president.office, office)));

        const { head, tail } = splitBeforeFirstSuccessor(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace(describeSpecification(head as Specification, 3))).toBe(`
            (p1: Employee) {
                u1: Office [
                    u1 = p1->office: Office
                ]
            } => u1`);
        expect(tail).toBeDefined();
        expect(fixWhitespace(describeSpecification(tail as Specification, 3))).toBe(`
            (u1: Office) {
                u2: President [
                    u2->office: Office = u1
                ]
            } => u2`);
    });

    it('should split if predecessor and then successor, but in one match', () => {
        const specification = model.given(Employee).match((employee, facts) =>
            facts.ofType(President)
                .join(president => president.office, employee.office));

        const { head, tail } = splitBeforeFirstSuccessor(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace(describeSpecification(head as Specification, 3))).toBe(`
            (p1: Employee) {
                s1: Office [
                    s1 = p1->office: Office
                ]
            } => s1`);
        expect(tail).toBeDefined();
        expect(fixWhitespace(describeSpecification(tail as Specification, 3))).toBe(`
            (s1: Office) {
                u1: President [
                    u1->office: Office = s1
                ]
            } => u1`);
    });
});

function fixWhitespace(s: string): string {
    return '\n' + s.trimEnd();
}