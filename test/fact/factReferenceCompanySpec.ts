import { Jinaga, User } from '@src';
import { model } from '../companyModel';
import { describeAcrossStores } from '../utils/store-factories';

// A fact reference stands for a fact the store holds, so what a read makes of
// one is a semantic every store has to share (issue #252, step 3).
describeAcrossStores('factReference with company model', (createInstance) => {
    let j: Jinaga;

    beforeEach(async () => {
        j = await createInstance({});
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