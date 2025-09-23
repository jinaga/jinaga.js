"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
const companyModel_1 = require("../companyModel");
describe('factReference with company model', () => {
    let j;
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        j = _src_1.JinagaTest.create({});
    }));
    it('should work with real company model facts', () => __awaiter(void 0, void 0, void 0, function* () {
        // Create an actual user fact  
        const realUser = yield j.fact(new _src_1.User('test-public-key'));
        const userHash = j.hash(realUser);
        console.log('Real user:', realUser);
        console.log('Real user hash:', userHash);
        // Create a fact reference
        const userRef = j.factReference(_src_1.User, userHash);
        console.log('User ref:', userRef);
        console.log('User ref hash:', j.hash(userRef));
        // They should have the same hash and type
        expect(j.hash(userRef)).toBe(userHash);
        expect(userRef.type).toBe(realUser.type);
    }));
    it('should work with company creation queries', () => __awaiter(void 0, void 0, void 0, function* () {
        // Create a user and company
        const user = yield j.fact(new _src_1.User('creator-key'));
        const company = yield j.fact(new companyModel_1.Company(user, 'TestCorp'));
        const userHash = j.hash(user);
        const userRef = j.factReference(_src_1.User, userHash);
        // Query for companies created by this user using the reference
        const companies = yield j.query(companyModel_1.model.given(_src_1.User).match((u, facts) => facts.ofType(companyModel_1.Company).join(c => c.creator, u)), userRef);
        console.log('Companies found:', companies);
        expect(companies).toHaveLength(1);
        expect(companies[0].identifier).toBe('TestCorp');
    }));
    it('should work for identity queries', () => __awaiter(void 0, void 0, void 0, function* () {
        // Create a user
        const user = yield j.fact(new _src_1.User('identity-test-key'));
        const userHash = j.hash(user);
        const userRef = j.factReference(_src_1.User, userHash);
        // Simple identity query - just return the user itself
        const realUserResult = yield j.query(companyModel_1.model.given(_src_1.User).select(u => u), user);
        const refUserResult = yield j.query(companyModel_1.model.given(_src_1.User).select(u => u), userRef);
        console.log('Real user result:', realUserResult);
        console.log('Ref user result:', refUserResult);
        // Both should return the same user
        expect(realUserResult).toHaveLength(1);
        expect(refUserResult).toHaveLength(1);
        expect(j.hash(realUserResult[0])).toBe(j.hash(refUserResult[0]));
    }));
});
//# sourceMappingURL=factReferenceCompanySpec.js.map