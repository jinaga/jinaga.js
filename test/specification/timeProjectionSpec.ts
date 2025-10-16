import { MemoryStore, SpecificationParser, User, FactEnvelope } from "@src";

describe("Time projection", () => {
    it("returns the time when a fact was learned", async () => {
        // Create store
        const store = new MemoryStore();
        
        // Record time before creating the fact
        const timeBefore = new Date();
        
        // Create a user fact
        const user = new User("--- TEST PUBLIC KEY ---");
        const userEnvelope: FactEnvelope = {
            fact: {
                type: "Jinaga.User",
                hash: "test-hash",
                predecessors: {},
                fields: {
                    publicKey: user.publicKey
                }
            },
            signatures: []
        };
        await store.save([userEnvelope]);
        
        // Record time after creating the fact
        const timeAfter = new Date();
        
        // Parse specification with time projection
        const parser = new SpecificationParser("(user: Jinaga.User) { } => @user");
        parser.skipWhitespace();
        const specification = parser.parseSpecification();
        
        // Query with time projection
        const result = await store.read([{ type: "Jinaga.User", hash: "test-hash" }], specification);
        
        // Verify we got exactly one result
        expect(result).toHaveLength(1);
        
        // Verify the result is a Date object
        expect(result[0].result).toBeInstanceOf(Date);
        
        // Verify the timestamp is within the expected range
        const timestamp = result[0].result as Date;
        expect(timestamp.getTime()).toBeGreaterThanOrEqual(timeBefore.getTime());
        expect(timestamp.getTime()).toBeLessThanOrEqual(timeAfter.getTime());
    });
});