import { Jinaga } from '../../src/jinaga';
import { JinagaTest } from '../../src/jinaga-test';
import { User, Company, model } from '../companyModel';

describe('factReference with company model', () => {
    let j: Jinaga;

    beforeEach(async () => {
        j = JinagaTest.create({});
    });

    it('should work with real company model facts', async () => {
        // Create an actual user fact  
        const realUser = await j.fact(new User('test-public-key'));
        const userHash = j.hash(realUser);
        
        console.log('Real user:', realUser);
        console.log('Real user hash:', userHash);
        
        // Create a fact reference
        const userRef = j.factReference(User, userHash);
        console.log('User ref:', userRef);
        console.log('User ref hash:', j.hash(userRef));
        
        // They should have the same hash and type
        expect(j.hash(userRef)).toBe(userHash);
        expect(userRef.type).toBe(realUser.type);
    });

    it('should work with company creation queries', async () => {
        // Create a user and company
        const user = await j.fact(new User('creator-key'));
        const company = await j.fact(new Company(user, 'TestCorp'));
        
        const userHash = j.hash(user);
        const userRef = j.factReference(User, userHash);
        
        // Query for companies created by this user using the reference
        const companies = await j.query(
            model.given(User).match((u, facts) =>
                facts.ofType(Company).join(c => c.creator, u)
            ),
            userRef
        );
        
        console.log('Companies found:', companies);
        expect(companies).toHaveLength(1);
        expect(companies[0].identifier).toBe('TestCorp');
    });

    it('should work for identity queries', async () => {
        // Create a user
        const user = await j.fact(new User('identity-test-key'));
        const userHash = j.hash(user);
        const userRef = j.factReference(User, userHash);
        
        // Simple identity query - just return the user itself
        const realUserResult = await j.query(
            model.given(User).select(u => u),
            user
        );
        
        const refUserResult = await j.query(
            model.given(User).select(u => u),
            userRef
        );
        
        console.log('Real user result:', realUserResult);
        console.log('Ref user result:', refUserResult);
        
        // Both should return the same user
        expect(realUserResult).toHaveLength(1);
        expect(refUserResult).toHaveLength(1);
        expect(j.hash(realUserResult[0])).toBe(j.hash(refUserResult[0]));
    });
});