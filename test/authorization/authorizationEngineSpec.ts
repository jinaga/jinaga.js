import { AuthorizationEngine, AuthorizationRules, FactEnvelope, MemoryStore, dehydrateFact } from "@src";

describe("AuthorizationEngine.authorizeFacts", () => {
    it("authorizes a fact whose predecessor already exists in the store but is not in the current batch", async () => {
        const store = new MemoryStore();

        // The user already exists in the store (e.g. from a prior login),
        // but is not resubmitted as part of this save batch.
        const facts = dehydrateFact({
            type: "Test.ChannelOwner",
            channel: {
                type: "Test.Channel",
                channelId: "channel-1"
            },
            user: {
                type: "Jinaga.User",
                publicKey: "existing-owner"
            }
        });
        const existingUser = facts.find(f => f.type === "Jinaga.User")!;
        const batchFacts = facts.filter(f => f.type !== "Jinaga.User");

        await store.save([{ fact: existingUser, signatures: [] }]);

        const authorizationRules = new AuthorizationRules(undefined)
            .any("Test.Channel")
            .any("Test.ChannelOwner");
        const engine = new AuthorizationEngine(authorizationRules, store);

        const envelopes: FactEnvelope[] = batchFacts.map(fact => ({ fact, signatures: [] }));

        const results = await engine.authorizeFacts(envelopes, null);

        const authorizedTypes = results.map(r => r.fact.type).sort();
        expect(authorizedTypes).toEqual(["Test.Channel", "Test.ChannelOwner"]);
    });

    it("throws instead of silently dropping a fact whose predecessor does not exist anywhere", async () => {
        const store = new MemoryStore();

        // The user does not exist in the store, and is not resubmitted as
        // part of this save batch either.
        const facts = dehydrateFact({
            type: "Test.ChannelOwner",
            channel: {
                type: "Test.Channel",
                channelId: "channel-1"
            },
            user: {
                type: "Jinaga.User",
                publicKey: "nonexistent-owner"
            }
        });
        const batchFacts = facts.filter(f => f.type !== "Jinaga.User");

        const authorizationRules = new AuthorizationRules(undefined)
            .any("Test.Channel")
            .any("Test.ChannelOwner");
        const engine = new AuthorizationEngine(authorizationRules, store);

        const envelopes: FactEnvelope[] = batchFacts.map(fact => ({ fact, signatures: [] }));

        await expect(engine.authorizeFacts(envelopes, null)).rejects.toThrow();
    });
});
