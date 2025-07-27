import { Jinaga } from '../../src/jinaga';
import { JinagaTest } from '../../src/jinaga-test';
import { buildModel } from '../../src/specification/model';

// Simple test fact class
class SimpleUser {
    static Type = "SimpleTest.User" as const;
    type = SimpleUser.Type;
    
    constructor(
        public publicKey: string
    ) { }
}

const simpleModel = buildModel(b => b
    .type(SimpleUser)
);

describe('factReference debugging', () => {
    let j: Jinaga;

    beforeEach(async () => {
        j = JinagaTest.create({});
    });

    it('should create a factReference that behaves like a normal fact', async () => {
        // Create an actual user fact
        const realUser = await j.fact(new SimpleUser('test-key'));
        const userHash = j.hash(realUser);
        
        console.log('Real user:', realUser);
        console.log('Real user hash:', userHash);
        console.log('Real user type:', realUser.type);
        
        // Create a fact reference
        const userRef = j.factReference(SimpleUser, userHash);
        console.log('User ref:', userRef);
        console.log('User ref hash:', j.hash(userRef));
        console.log('User ref type:', userRef.type);
        
        // They should have the same hash and type
        expect(j.hash(userRef)).toBe(userHash);
        expect(userRef.type).toBe(realUser.type);
        
        // Check if they are equivalent for query purposes
        console.log('Real user JSON:', JSON.stringify(realUser));
        console.log('User ref JSON:', JSON.stringify(userRef));
    });

    it('should work in a basic query context', async () => {
        // Create an actual user 
        const realUser = await j.fact(new SimpleUser('basic-test-key'));
        const userHash = j.hash(realUser);
        
        // Create a fact reference
        const userRef = j.factReference(SimpleUser, userHash);
        
        // Simple query just to get the user back
        const realUserQuery = await j.query(
            simpleModel.given(SimpleUser).match((u, facts) => u),
            realUser
        );
        
        const refUserQuery = await j.query(
            simpleModel.given(SimpleUser).match((u, facts) => u),
            userRef
        );
        
        console.log('Real user query result:', realUserQuery);
        console.log('Ref user query result:', refUserQuery);
        
        // Both should return the same result
        expect(realUserQuery).toHaveLength(1);
        expect(refUserQuery).toHaveLength(1);
        expect(j.hash(realUserQuery[0])).toBe(j.hash(refUserQuery[0]));
    });
});