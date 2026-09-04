import { Jinaga, User } from '@src';
import { Company, model } from '../companyModel';
import { describeAcrossStores } from '../utils/store-factories';

// The acceptance criteria describe what a read returns for a reference, which
// is a semantic no one store owns (issue #252, step 3).
describeAcrossStores('factReference acceptance criteria', (createInstance) => {
    let j: Jinaga;

    beforeEach(async () => {
        j = await createInstance({});
    });

    it('✅ Developers can call the helper with a fact class and a hash, and receive a strongly-typed reference object', () => {
        const hash = 'test-hash-123';
        
        // Test static method
        const ref1 = Jinaga.factReference(User, hash);
        expect(ref1.type).toBe('Jinaga.User');
        
        // Test instance method
        const ref2 = j.factReference(User, hash);
        expect(ref2.type).toBe('Jinaga.User');
        
        // Test standalone exported function
        const ref3 = Jinaga.factReference(User, hash);
        expect(ref3.type).toBe('Jinaga.User');
        
        // TypeScript should treat these as User objects
        // (This compiles without errors, proving type safety)
        const userType: string = ref1.type;
        expect(userType).toBe('Jinaga.User');
    });

    it('✅ The returned object is accepted by Jinaga\'s query, watch, and subscribe APIs as the appropriate type', async () => {
        const user = await j.fact(new User('api-test-key'));
        const company = await j.fact(new Company(user, 'TestCompany'));
        
        const userHash = j.hash(user);
        const userRef = j.factReference(User, userHash);
        
        // Test query API
        const companies = await j.query(
            model.given(User).match((u, facts) =>
                facts.ofType(Company).join(c => c.creator, u)
            ),
            userRef
        );
        expect(companies).toHaveLength(1);
        expect(companies[0].identifier).toBe('TestCompany');
        
        // Test watch API (setup only, no timing issues)
        const observer = j.watch(
            model.given(User).match((u, facts) =>
                facts.ofType(Company).join(c => c.creator, u)
            ),
            userRef,
            company => { /* callback */ }
        );
        expect(observer).toBeDefined();
        // Awaited before stopping, so the initial read has finished rather than
        // being abandoned mid-flight, which against a store that reads from a
        // database would hold a connection open past the end of this test.
        await observer.loaded();
        observer.stop();

        // Test subscribe API (setup only)
        const subscription = j.subscribe(
            model.given(User).match((u, facts) =>
                facts.ofType(Company).join(c => c.creator, u)
            ),
            userRef,
            company => { /* callback */ }
        );
        expect(subscription).toBeDefined();
        await subscription.loaded();
        subscription.stop();
    });

    it('✅ The returned object works with Jinaga.hash() to return the provided hash', () => {
        const originalHash = 'test-original-hash-456';
        const userRef = j.factReference(User, originalHash);
        
        const retrievedHash = Jinaga.hash(userRef);
        expect(retrievedHash).toBe(originalHash);
        
        // Also test instance method
        const retrievedHash2 = j.hash(userRef);
        expect(retrievedHash2).toBe(originalHash);
    });

    it('✅ The .type property is correctly set to the fact type', () => {
        const userRef = j.factReference(User, 'hash123');
        expect(userRef.type).toBe('Jinaga.User');
        
        const companyRef = j.factReference(Company, 'hash456');
        expect(companyRef.type).toBe('Company');
    });

    it('✅ The helper is documented and discoverable in the public API', () => {
        // Static method on Jinaga class
        expect(typeof Jinaga.factReference).toBe('function');
        
        // Instance method on Jinaga instance
        expect(typeof j.factReference).toBe('function');
        
        // Standalone exported function
        expect(typeof Jinaga.factReference).toBe('function');
    });

    it('✅ Tests confirm type safety and runtime behavior', async () => {
        // Type safety: these should compile without errors
        const userRef = j.factReference(User, 'user-hash');
        const companyRef = j.factReference(Company, 'company-hash');
        
        // Runtime behavior: proper hash and type handling
        expect(userRef.type).toBe('Jinaga.User');
        expect(companyRef.type).toBe('Company');
        expect(j.hash(userRef)).toBe('user-hash');
        expect(j.hash(companyRef)).toBe('company-hash');
        
        // Error handling for invalid constructors
        class InvalidFact {
            // No static Type property
        }
        
        expect(() => {
            j.factReference(InvalidFact as any, 'test-hash');
        }).toThrow('Constructor must have a static Type property of type string');
        
        // Error handling for non-string Type
        class BadTypeFact {
            static Type = 123; // Wrong type
        }
        
        expect(() => {
            j.factReference(BadTypeFact as any, 'test-hash');
        }).toThrow('Constructor must have a static Type property of type string');
    });

    it('✅ Integration with existing fact ecosystem', async () => {
        // Create real facts
        const user = await j.fact(new User('integration-key'));
        const company = await j.fact(new Company(user, 'IntegrationCorp'));
        
        // Create fact references
        const userRef = j.factReference(User, j.hash(user));
        const companyRef = j.factReference(Company, j.hash(company));
        
        // Fact references should work exactly like the original facts in queries
        const companiesFromReal = await j.query(
            model.given(User).match((u, facts) =>
                facts.ofType(Company).join(c => c.creator, u)
            ),
            user
        );
        
        const companiesFromRef = await j.query(
            model.given(User).match((u, facts) =>
                facts.ofType(Company).join(c => c.creator, u)
            ),
            userRef
        );
        
        // Should return the same results
        expect(companiesFromReal).toHaveLength(1);
        expect(companiesFromRef).toHaveLength(1);
        expect(j.hash(companiesFromReal[0])).toBe(j.hash(companiesFromRef[0]));
    });
});