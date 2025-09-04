import { Jinaga, JinagaTest } from '@src';

// Test fact classes
class TestFact {
    static Type = "TestFact" as const;
    type = TestFact.Type;
    
    constructor(
        public value: string
    ) { }
}

class TestFactWithPredecessor {
    static Type = "TestFactWithPredecessor" as const;
    type = TestFactWithPredecessor.Type;
    
    constructor(
        public parent: TestFact,
        public value: string
    ) { }
}

// Invalid test class without Type property
class InvalidFact {
    constructor(public value: string) { }
}

describe('factReference', () => {
    let j: Jinaga;

    beforeEach(() => {
        j = JinagaTest.create({});
    });

    it('should create a fact reference with correct type', () => {
        const hash = 'test-hash-123';
        const factRef = Jinaga.factReference(TestFact, hash);
        
        expect(factRef.type).toBe('TestFact');
        expect(typeof factRef).toBe('object');
    });

    it('should allow the fact reference to be hashed', () => {
        const hash = 'test-hash-123';
        const factRef = Jinaga.factReference(TestFact, hash);
        
        const retrievedHash = Jinaga.hash(factRef);
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
        const factRef = Jinaga.factReference(TestFact, hash);
        
        // This should compile without type errors
        const type: string = factRef.type;
        expect(type).toBe('TestFact');
        
        // The returned object should be typed as TestFact
        // Note: We can't actually access .value since we only created a reference
        // but TypeScript should treat it as a TestFact
    });

    it('should work with more complex fact types', () => {
        const hash = 'complex-hash-123';
        const factRef = Jinaga.factReference(TestFactWithPredecessor, hash);
        
        expect(factRef.type).toBe('TestFactWithPredecessor');
        expect(Jinaga.hash(factRef)).toBe(hash);
    });

    it('should throw error for constructor without Type property', () => {
        const hash = 'invalid-hash';
        
        expect(() => {
            Jinaga.factReference(InvalidFact as any, hash);
        }).toThrow('Constructor must have a static Type property of type string');
    });

    it('should throw error for constructor with non-string Type property', () => {
        class BadFact {
            static Type = 123; // Wrong type
        }
        
        const hash = 'bad-hash';
        
        expect(() => {
            Jinaga.factReference(BadFact as any, hash);
        }).toThrow('Constructor must have a static Type property of type string');
    });

    it('should work with valid hash string', () => {
        const hash = 'validHashExample123==';
        const factRef = Jinaga.factReference(TestFact, hash);
        
        expect(factRef.type).toBe('TestFact');
        expect(Jinaga.hash(factRef)).toBe(hash);
    });

    it('should preserve hash through multiple operations', () => {
        const hash = 'persistent-hash-123';
        const factRef = Jinaga.factReference(TestFact, hash);
        
        // Hash should be consistent
        expect(Jinaga.hash(factRef)).toBe(hash);
        expect(Jinaga.hash(factRef)).toBe(hash);
        
        // Should work with instance method too
        expect(j.hash(factRef)).toBe(hash);
    });
});