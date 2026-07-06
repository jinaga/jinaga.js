import {
    AuthorizationEngine,
    AuthorizationRules,
    FactEnvelope,
    FactRecord,
    GraphDeserializer,
    GraphSerializer,
    MemoryStore,
    User,
    buildModel,
    dehydrateFact
} from "@src";

class Filler {
    static Type = "Test.Filler" as const;
    type = Filler.Type;
    constructor(public value: number) {}
}

class Workspace {
    static Type = "Test.Workspace" as const;
    type = Workspace.Type;
    constructor(public owner: User, public identifier: string) {}
}

class Application {
    static Type = "Test.Application" as const;
    type = Application.Type;
    constructor(public workspace: Workspace, public name: string) {}
}

// Regression test for #224: GraphDeserializer flushes envelopes to its
// callback every 20 facts. When a consumer authorizes each flush batch
// independently (as jinaga-server's /save handler does), a fact whose
// authorization rule needs multiple predecessor hops through facts that
// landed in an earlier flush batch must still be resolvable, even though
// the deserializer no longer hands those records to the callback.
describe("Authorization across a GraphDeserializer flush boundary", () => {
    it("authorizes a fact whose multi-hop predecessors were saved in a prior flush batch", async () => {
        const ownerPublicKey = "owner-public-key";

        // Pad the graph with enough leading facts that the real predecessor
        // chain (user -> workspace -> application) crosses the deserializer's
        // default 20-fact flush threshold, landing Application alone in the
        // second flush.
        const fillerRecords: FactRecord[] = [];
        for (let i = 0; i < 18; i++) {
            fillerRecords.push(...dehydrateFact(new Filler(i)));
        }

        const chainRecords = dehydrateFact({
            type: Application.Type,
            workspace: {
                type: Workspace.Type,
                owner: {
                    type: User.Type,
                    publicKey: ownerPublicKey
                },
                identifier: "workspace-1"
            },
            name: "application-1"
        });

        const allRecords = [...fillerRecords, ...chainRecords];
        expect(allRecords.length).toBe(21);
        expect(allRecords[allRecords.length - 1].type).toBe(Application.Type);

        const envelopes: FactEnvelope[] = allRecords.map(fact => ({ fact, signatures: [] }));
        const userFact = chainRecords.find(f => f.type === User.Type)!;

        // Round-trip through the wire protocol so the test exercises the
        // real GraphDeserializer flush boundary, not a hand-picked batch.
        const lines: string[] = [];
        new GraphSerializer(chunk => lines.push(chunk)).serialize(envelopes);
        const wireText = lines.join("");
        const readLine = createReadLine(wireText);
        const deserializer = new GraphDeserializer(readLine);

        const model = buildModel(b => b
            .type(User)
            .type(Workspace, w => w
                .predecessor("owner", User)
            )
            .type(Application, a => a
                .predecessor("workspace", Workspace)
            )
        );
        const authorizationRules = new AuthorizationRules(model)
            .any(Filler.Type)
            .any(User.Type)
            .any(Workspace.Type)
            .type(Application, app => app.workspace.owner);

        const store = new MemoryStore();
        const engine = new AuthorizationEngine(authorizationRules, store);

        const batches: FactEnvelope[][] = [];
        await deserializer.read(async batch => {
            batches.push(batch);
            // Mirror jinaga-server's /save handler: authorize each flush
            // batch independently, then persist it, before the next batch
            // is even read off the wire.
            const results = await engine.authorizeFacts(batch, userFact);
            await store.save(results.map(r => ({ fact: r.fact, signatures: [] })));
        });

        // Confirm the graph really did split across flush batches, with the
        // Application landing in a later batch than its Workspace/User
        // predecessors. Otherwise this test would pass without ever
        // exercising the flush boundary the bug depends on.
        expect(batches.length).toBeGreaterThan(1);
        expect(batches[0].some(e => e.fact.type === Application.Type)).toBe(false);
        expect(batches.slice(1).some(batch => batch.some(e => e.fact.type === Application.Type))).toBe(true);

        const saved = await store.whichExist([{ type: Application.Type, hash: chainRecords.find(f => f.type === Application.Type)!.hash }]);
        expect(saved.length).toBe(1);
    });
});

function createReadLine(input: string) {
    const lines = input.split("\n");
    if (lines[lines.length - 1] === "") {
        lines.pop();
    }
    return async () => {
        const line = lines.shift();
        return line !== undefined ? line : null;
    };
}
