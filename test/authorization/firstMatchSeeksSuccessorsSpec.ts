import { AuthorizationRules, FactEnvelope, FactRepository, Forbidden, JinagaTest, LabelOf, MemoryStore, User, dehydrateFact } from "@src";
import { Owner, Workspace, model as linkModel } from "../linkModel";

// A rule whose first match seeks successors of the given: only an owner of the
// workspace may author it. Nothing precedes that match and it walks no
// predecessor, so the head has no matches, and the whole rule runs in the tail.
// Such a rule used to throw `AuthorizationRuleError` on every write. It is a
// rule like any other: it admits the users it names, when the given can be read.

const ALICE_KEY = "alice-public-key";

const rule = (workspace: LabelOf<Workspace>, facts: FactRepository) =>
    facts.ofType(Owner)
        .join(o => o.workspace, workspace)
        .selectMany(o => facts.ofType(User)
            .join(u => u, o.user));

const authorization = (a: AuthorizationRules) => a
    .any(User)
    .any(Owner)
    .type(Workspace, rule);

describe("Authorization of a rule whose first match seeks successors of the given", () => {
    const alice = new User(ALICE_KEY);
    const workspace = new Workspace(alice, "w1");
    const owner = new Owner(workspace, alice);

    it("should refuse a new workspace with Forbidden rather than AuthorizationRuleError", async () => {
        // The workspace is being authorized, so the store cannot yet be read for it.
        const j = JinagaTest.create({
            model: linkModel,
            authorization,
            user: alice,
            initialState: [alice]
        });

        await expect(j.fact(new Workspace(alice, "new"))).rejects.toBeInstanceOf(Forbidden);
    });

    it("should name the owner when the workspace is in the store", async () => {
        const closure: FactEnvelope[] = [alice, workspace, owner]
            .flatMap(fact => dehydrateFact(fact))
            .map(fact => ({ fact, signatures: [] }));
        const workspaceRecords = dehydrateFact(workspace);
        const envelope: FactEnvelope = {
            fact: workspaceRecords[workspaceRecords.length - 1],
            signatures: []
        };
        const store = new MemoryStore();
        await store.save(closure);
        const rules = authorization(new AuthorizationRules(linkModel));

        const population = await rules.getAuthorizedPopulationForEnvelope([ALICE_KEY], envelope, closure, store);

        expect(population).toEqual({ quantifier: "some", authorizedKeys: [ALICE_KEY] });
    });
});
