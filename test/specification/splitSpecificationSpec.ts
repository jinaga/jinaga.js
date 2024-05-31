import { describeSpecification } from "../../src/specification/description";
import { Specification, splitBeforeFirstSuccessor } from "../../src/specification/specification";
import { Administrator, AdministratorRevoked, Company, Employee, Office, President, model } from "../companyModel";

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

    it('should split path when existential condition exists', () => {
        const specification = model.given(Administrator).match((admin, facts) =>
            facts.ofType(Administrator)
                .join(admin2 => admin2.company, admin.company)
                .notExists(admin2 => facts.ofType(AdministratorRevoked)
                    .join(revoked => revoked.administrator, admin2)));

        const { head, tail } = splitBeforeFirstSuccessor(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace(describeSpecification(head as Specification, 3))).toBe(`
            (p1: Administrator) {
                s1: Company [
                    s1 = p1->company: Company
                ]
            } => s1`);
        expect(tail).toBeDefined();
        expect(fixWhitespace(describeSpecification(tail as Specification, 3))).toBe(`
            (s1: Company) {
                u1: Administrator [
                    u1->company: Company = s1
                    !E {
                        u2: Administrator.Revoked [
                            u2->administrator: Administrator = u1
                        ]
                    }
                ]
            } => u1`);
    });

    it('should split when existential appears with only successor joins', () => {
        const specification = model.given(Administrator).match((admin, facts) =>
            facts.ofType(Company)
                .join(company => company, admin.company)
                .selectMany(company => facts.ofType(Administrator)
                    .join(admin2 => admin2.company, company)
                    .notExists(admin2 => facts.ofType(AdministratorRevoked)
                        .join(revoked => revoked.administrator, admin2))));

        const { head, tail } = splitBeforeFirstSuccessor(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace(describeSpecification(head as Specification, 3))).toBe(`
            (p1: Administrator) {
                u1: Company [
                    u1 = p1->company: Company
                ]
            } => u1`);
        expect(tail).toBeDefined();
        expect(fixWhitespace(describeSpecification(tail as Specification, 3))).toBe(`
            (u1: Company) {
                u2: Administrator [
                    u2->company: Company = u1
                    !E {
                        u3: Administrator.Revoked [
                            u3->administrator: Administrator = u2
                        ]
                    }
                ]
            } => u2`);
    });
});

function fixWhitespace(s: string): string {
    return '\n' + s.trimEnd();
}