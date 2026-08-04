import { AuthorizationEngine, AuthorizationRules, FactEnvelope, MemoryStore, PredecessorNotResolvedError, dehydrateFact } from "@src";

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

    it("names the missing predecessor instead of only the facts that depend on it", async () => {
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
        const missingUser = facts.find(f => f.type === "Jinaga.User")!;
        const batchFacts = facts.filter(f => f.type !== "Jinaga.User");

        const authorizationRules = new AuthorizationRules(undefined)
            .any("Test.Channel")
            .any("Test.ChannelOwner");
        const engine = new AuthorizationEngine(authorizationRules, store);

        const envelopes: FactEnvelope[] = batchFacts.map(fact => ({ fact, signatures: [] }));

        const error = await engine.authorizeFacts(envelopes, null).catch(e => e);

        expect(error).toBeInstanceOf(PredecessorNotResolvedError);
        expect(error.message).toContain(`predecessor Jinaga.User:${missingUser.hash}`);
        expect(error.message).toContain("Add it to the batch, or commit it first.");
        expect(error.missingPredecessors).toEqual([
            { type: "Jinaga.User", hash: missingUser.hash }
        ]);
        expect(error.unresolvedFacts).toEqual([
            { type: "Test.ChannelOwner", hash: batchFacts.find(f => f.type === "Test.ChannelOwner")!.hash }
        ]);
    });
});
