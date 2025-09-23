"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
// Test fact classes
class TestFact {
    constructor(value) {
        this.value = value;
        this.type = TestFact.Type;
    }
}
TestFact.Type = "TestFact";
class TestFactWithPredecessor {
    constructor(parent, value) {
        this.parent = parent;
        this.value = value;
        this.type = TestFactWithPredecessor.Type;
    }
}
TestFactWithPredecessor.Type = "TestFactWithPredecessor";
// Invalid test class without Type property
class InvalidFact {
    constructor(value) {
        this.value = value;
    }
}
describe('factReference', () => {
    let j;
    beforeEach(() => {
        j = _src_1.JinagaTest.create({});
    });
    it('should create a fact reference with correct type', () => {
        const hash = 'test-hash-123';
        const factRef = _src_1.Jinaga.factReference(TestFact, hash);
        expect(factRef.type).toBe('TestFact');
        expect(typeof factRef).toBe('object');
    });
    it('should allow the fact reference to be hashed', () => {
        const hash = 'test-hash-123';
        const factRef = _src_1.Jinaga.factReference(TestFact, hash);
        const retrievedHash = _src_1.Jinaga.hash(factRef);
        expect(retrievedHash).toBe(hash);
    });
    it('should work with instance method', () => {
        const hash = 'test-hash-456';
        const factRef = j.factReference(TestFact, hash);
        expect(factRef.type).toBe('TestFact');
        expect(j.hash(factRef)).toBe(hash);
    });
    it('should have proper TypeScript typing', () => {
        const hash = 'test-hash-789';
        const factRef = _src_1.Jinaga.factReference(TestFact, hash);
        // This should compile without type errors
        const type = factRef.type;
        expect(type).toBe('TestFact');
        // The returned object should be typed as TestFact
        // Note: We can't actually access .value since we only created a reference
        // but TypeScript should treat it as a TestFact
    });
    it('should work with more complex fact types', () => {
        const hash = 'complex-hash-123';
        const factRef = _src_1.Jinaga.factReference(TestFactWithPredecessor, hash);
        expect(factRef.type).toBe('TestFactWithPredecessor');
        expect(_src_1.Jinaga.hash(factRef)).toBe(hash);
    });
    it('should throw error for constructor without Type property', () => {
        const hash = 'invalid-hash';
        expect(() => {
            _src_1.Jinaga.factReference(InvalidFact, hash);
        }).toThrow('Constructor must have a static Type property of type string');
    });
    it('should throw error for constructor with non-string Type property', () => {
        class BadFact {
        }
        BadFact.Type = 123; // Wrong type
        const hash = 'bad-hash';
        expect(() => {
            _src_1.Jinaga.factReference(BadFact, hash);
        }).toThrow('Constructor must have a static Type property of type string');
    });
    it('should work with valid hash string', () => {
        const hash = 'validHashExample123==';
        const factRef = _src_1.Jinaga.factReference(TestFact, hash);
        expect(factRef.type).toBe('TestFact');
        expect(_src_1.Jinaga.hash(factRef)).toBe(hash);
    });
    it('should preserve hash through multiple operations', () => {
        const hash = 'persistent-hash-123';
        const factRef = _src_1.Jinaga.factReference(TestFact, hash);
        // Hash should be consistent
        expect(_src_1.Jinaga.hash(factRef)).toBe(hash);
        expect(_src_1.Jinaga.hash(factRef)).toBe(hash);
        // Should work with instance method too
        expect(j.hash(factRef)).toBe(hash);
    });
});
//# sourceMappingURL=factReferenceSpec.js.map