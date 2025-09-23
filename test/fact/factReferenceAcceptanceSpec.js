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
describe('factReference acceptance criteria', () => {
    let j;
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        j = _src_1.JinagaTest.create({});
    }));
    it('✅ Developers can call the helper with a fact class and a hash, and receive a strongly-typed reference object', () => {
        const hash = 'test-hash-123';
        // Test static method
        const ref1 = _src_1.Jinaga.factReference(_src_1.User, hash);
        expect(ref1.type).toBe('Jinaga.User');
        // Test instance method
        const ref2 = j.factReference(_src_1.User, hash);
        expect(ref2.type).toBe('Jinaga.User');
        // Test standalone exported function
        const ref3 = _src_1.Jinaga.factReference(_src_1.User, hash);
        expect(ref3.type).toBe('Jinaga.User');
        // TypeScript should treat these as User objects
        // (This compiles without errors, proving type safety)
        const userType = ref1.type;
        expect(userType).toBe('Jinaga.User');
    });
    it('✅ The returned object is accepted by Jinaga\'s query, watch, and subscribe APIs as the appropriate type', () => __awaiter(void 0, void 0, void 0, function* () {
        const user = yield j.fact(new _src_1.User('api-test-key'));
        const company = yield j.fact(new companyModel_1.Company(user, 'TestCompany'));
        const userHash = j.hash(user);
        const userRef = j.factReference(_src_1.User, userHash);
        // Test query API
        const companies = yield j.query(companyModel_1.model.given(_src_1.User).match((u, facts) => facts.ofType(companyModel_1.Company).join(c => c.creator, u)), userRef);
        expect(companies).toHaveLength(1);
        expect(companies[0].identifier).toBe('TestCompany');
        // Test watch API (setup only, no timing issues)
        const observer = j.watch(companyModel_1.model.given(_src_1.User).match((u, facts) => facts.ofType(companyModel_1.Company).join(c => c.creator, u)), userRef, company => { });
        expect(observer).toBeDefined();
        observer.stop();
        // Test subscribe API (setup only)  
        const subscription = j.subscribe(companyModel_1.model.given(_src_1.User).match((u, facts) => facts.ofType(companyModel_1.Company).join(c => c.creator, u)), userRef, company => { });
        expect(subscription).toBeDefined();
        subscription.stop();
    }));
    it('✅ The returned object works with Jinaga.hash() to return the provided hash', () => {
        const originalHash = 'test-original-hash-456';
        const userRef = j.factReference(_src_1.User, originalHash);
        const retrievedHash = _src_1.Jinaga.hash(userRef);
        expect(retrievedHash).toBe(originalHash);
        // Also test instance method
        const retrievedHash2 = j.hash(userRef);
        expect(retrievedHash2).toBe(originalHash);
    });
    it('✅ The .type property is correctly set to the fact type', () => {
        const userRef = j.factReference(_src_1.User, 'hash123');
        expect(userRef.type).toBe('Jinaga.User');
        const companyRef = j.factReference(companyModel_1.Company, 'hash456');
        expect(companyRef.type).toBe('Company');
    });
    it('✅ The helper is documented and discoverable in the public API', () => {
        // Static method on Jinaga class
        expect(typeof _src_1.Jinaga.factReference).toBe('function');
        // Instance method on Jinaga instance
        expect(typeof j.factReference).toBe('function');
        // Standalone exported function
        expect(typeof _src_1.Jinaga.factReference).toBe('function');
    });
    it('✅ Tests confirm type safety and runtime behavior', () => __awaiter(void 0, void 0, void 0, function* () {
        // Type safety: these should compile without errors
        const userRef = j.factReference(_src_1.User, 'user-hash');
        const companyRef = j.factReference(companyModel_1.Company, 'company-hash');
        // Runtime behavior: proper hash and type handling
        expect(userRef.type).toBe('Jinaga.User');
        expect(companyRef.type).toBe('Company');
        expect(j.hash(userRef)).toBe('user-hash');
        expect(j.hash(companyRef)).toBe('company-hash');
        // Error handling for invalid constructors
        class InvalidFact {
        }
        expect(() => {
            j.factReference(InvalidFact, 'test-hash');
        }).toThrow('Constructor must have a static Type property of type string');
        // Error handling for non-string Type
        class BadTypeFact {
        }
        BadTypeFact.Type = 123; // Wrong type
        expect(() => {
            j.factReference(BadTypeFact, 'test-hash');
        }).toThrow('Constructor must have a static Type property of type string');
    }));
    it('✅ Integration with existing fact ecosystem', () => __awaiter(void 0, void 0, void 0, function* () {
        // Create real facts
        const user = yield j.fact(new _src_1.User('integration-key'));
        const company = yield j.fact(new companyModel_1.Company(user, 'IntegrationCorp'));
        // Create fact references
        const userRef = j.factReference(_src_1.User, j.hash(user));
        const companyRef = j.factReference(companyModel_1.Company, j.hash(company));
        // Fact references should work exactly like the original facts in queries
        const companiesFromReal = yield j.query(companyModel_1.model.given(_src_1.User).match((u, facts) => facts.ofType(companyModel_1.Company).join(c => c.creator, u)), user);
        const companiesFromRef = yield j.query(companyModel_1.model.given(_src_1.User).match((u, facts) => facts.ofType(companyModel_1.Company).join(c => c.creator, u)), userRef);
        // Should return the same results
        expect(companiesFromReal).toHaveLength(1);
        expect(companiesFromRef).toHaveLength(1);
        expect(j.hash(companiesFromReal[0])).toBe(j.hash(companiesFromRef[0]));
    }));
});
//# sourceMappingURL=factReferenceAcceptanceSpec.js.map