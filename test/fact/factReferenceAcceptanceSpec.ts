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