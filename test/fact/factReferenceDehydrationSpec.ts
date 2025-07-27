import { Jinaga } from '../../src/jinaga';
import { JinagaTest } from '../../src/jinaga-test';
import { User } from '../companyModel';
import { dehydrateReference } from '../../src/fact/hydrate';

describe('factReference dehydration debugging', () => {
    let j: Jinaga;

    beforeEach(async () => {
        j = JinagaTest.create({});
    });

    it('should understand what happens during prepareFactReference', async () => {
        // Create a real user fact
        const realUser = await j.fact(new User('debug-key'));
        const userHash = j.hash(realUser);
        
        console.log('Real user:', realUser);
        console.log('Real user hash:', userHash);
        
        // Create a fact reference
        const userRef = j.factReference(User, userHash);
        console.log('User ref before processing:', userRef);
        console.log('User ref hash before processing:', j.hash(userRef));
        
        // Simulate what prepareFactReference does
        const jsonProcessedRef = JSON.parse(JSON.stringify(userRef));
        console.log('After JSON processing:', jsonProcessedRef);
        
        // Try to dehydrate it
        const dehydratedRef = dehydrateReference(jsonProcessedRef);
        console.log('Dehydrated reference:', dehydratedRef);
        
        // Compare with dehydrating the real user
        const realUserDehydrated = dehydrateReference(realUser);
        console.log('Real user dehydrated:', realUserDehydrated);
        
        // Check if the hashes match
        console.log('Hashes match?', dehydratedRef.hash === realUserDehydrated.hash);
    });

    it('should test the actual prepareFactReference method', async () => {
        // Create a real user fact
        const realUser = await j.fact(new User('prepare-test-key'));
        const userHash = j.hash(realUser);
        
        // Create a fact reference
        const userRef = j.factReference(User, userHash);
        
        // Test the prepareFactReference method directly
        // Since it's private, I'll use a workaround to access it
        const prepareMethod = (j as any).prepareFactReference.bind(j);
        
        const realUserReference = prepareMethod(realUser);
        const userRefReference = prepareMethod(userRef);
        
        console.log('Real user prepared reference:', realUserReference);
        console.log('User ref prepared reference:', userRefReference);
        
        // These should now match!
        expect(userRefReference.hash).toBe(realUserReference.hash);
        expect(userRefReference.type).toBe(realUserReference.type);
    });
});