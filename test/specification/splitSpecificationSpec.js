"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
const companyModel_1 = require("../companyModel");
describe('Split specification', () => {
    it('should put all in head if identity specification', () => {
        const specification = companyModel_1.model.given(companyModel_1.Company).select((company, facts) => company);
        const { head, tail } = (0, _src_1.splitBeforeFirstSuccessor)(specification.specification);
        expect(tail).toBeUndefined();
        expect(head).toBeDefined();
        expect((0, _src_1.describeSpecification)(head, 0)).toEqual((0, _src_1.describeSpecification)(specification.specification, 0));
    });
    it('should put all in head if only predecessor joins', () => {
        const specification = companyModel_1.model.given(companyModel_1.Office).match((office, facts) => facts.ofType(companyModel_1.Company)
            .join(company => company, office.company));
        const { head, tail } = (0, _src_1.splitBeforeFirstSuccessor)(specification.specification);
        expect(tail).toBeUndefined();
        expect(head).toBeDefined();
        expect((0, _src_1.describeSpecification)(head, 0)).toEqual((0, _src_1.describeSpecification)(specification.specification, 0));
    });
    it('should put all in tail if only successor joins', () => {
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company));
        const { head, tail } = (0, _src_1.splitBeforeFirstSuccessor)(specification.specification);
        expect(head).toBeUndefined();
        expect(tail).toBeDefined();
        expect((0, _src_1.describeSpecification)(tail, 0)).toEqual((0, _src_1.describeSpecification)(specification.specification, 0));
    });
    it('should split if predecessor and then successor', () => {
        const specification = companyModel_1.model.given(companyModel_1.Employee).match((employee, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office, employee.office)
            .selectMany(office => facts.ofType(companyModel_1.President)
            .join(president => president.office, office)));
        const { head, tail } = (0, _src_1.splitBeforeFirstSuccessor)(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace((0, _src_1.describeSpecification)(head, 3))).toBe(`
            (p1: Employee) {
                u1: Office [
                    u1 = p1->office: Office
                ]
            } => u1`);
        expect(tail).toBeDefined();
        expect(fixWhitespace((0, _src_1.describeSpecification)(tail, 3))).toBe(`
            (u1: Office) {
                u2: President [
                    u2->office: Office = u1
                ]
            } => u2`);
    });
    it('should split if predecessor and then successor, but in one match', () => {
        const specification = companyModel_1.model.given(companyModel_1.Employee).match((employee, facts) => facts.ofType(companyModel_1.President)
            .join(president => president.office, employee.office));
        const { head, tail } = (0, _src_1.splitBeforeFirstSuccessor)(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace((0, _src_1.describeSpecification)(head, 3))).toBe(`
            (p1: Employee) {
                s1: Office [
                    s1 = p1->office: Office
                ]
            } => s1`);
        expect(tail).toBeDefined();
        expect(fixWhitespace((0, _src_1.describeSpecification)(tail, 3))).toBe(`
            (s1: Office) {
                u1: President [
                    u1->office: Office = s1
                ]
            } => u1`);
    });
    it('should split path when existential condition exists', () => {
        const specification = companyModel_1.model.given(companyModel_1.Administrator).match((admin, facts) => facts.ofType(companyModel_1.Administrator)
            .join(admin2 => admin2.company, admin.company)
            .notExists(admin2 => facts.ofType(companyModel_1.AdministratorRevoked)
            .join(revoked => revoked.administrator, admin2)));
        const { head, tail } = (0, _src_1.splitBeforeFirstSuccessor)(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace((0, _src_1.describeSpecification)(head, 3))).toBe(`
            (p1: Administrator) {
                s1: Company [
                    s1 = p1->company: Company
                ]
            } => s1`);
        expect(tail).toBeDefined();
        expect(fixWhitespace((0, _src_1.describeSpecification)(tail, 3))).toBe(`
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
        const specification = companyModel_1.model.given(companyModel_1.Administrator).match((admin, facts) => facts.ofType(companyModel_1.Company)
            .join(company => company, admin.company)
            .selectMany(company => facts.ofType(companyModel_1.Administrator)
            .join(admin2 => admin2.company, company)
            .notExists(admin2 => facts.ofType(companyModel_1.AdministratorRevoked)
            .join(revoked => revoked.administrator, admin2))));
        const { head, tail } = (0, _src_1.splitBeforeFirstSuccessor)(specification.specification);
        expect(head).toBeDefined();
        expect(fixWhitespace((0, _src_1.describeSpecification)(head, 3))).toBe(`
            (p1: Administrator) {
                u1: Company [
                    u1 = p1->company: Company
                ]
            } => u1`);
        expect(tail).toBeDefined();
        expect(fixWhitespace((0, _src_1.describeSpecification)(tail, 3))).toBe(`
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
function fixWhitespace(s) {
    return '\n' + s.trimEnd();
}
//# sourceMappingURL=splitSpecificationSpec.js.map