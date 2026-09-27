import { AuthorizationRules, FactEnvelope, FactRepository, Forbidden, Jinaga, JinagaTest, LabelOf, MemoryStore, User, dehydrateFact } from "@src";
import { Item, Link, Owner, Workspace, model as linkModel } from "../linkModel";

// Only a user who owns the workspace of both endpoints may author a Link. The
// rule joins one unknown to two predecessor paths of the given, so the split
// gives each path a head label of its own (issue #231).

const ALICE_KEY = "alice-public-key";
const BOB_KEY = "bob-public-key";

// Formulation A: one Owner joined to both endpoints' workspaces.
const ruleA = (link: LabelOf<Link>, facts: FactRepository) =>
    facts.ofType(Owner)
        .join(o => o.workspace, link.item.workspace)
        .join(o => o.workspace, link.parent.workspace)
        .selectMany(o => facts.ofType(User)
            .join(u => u, o.user));

// Formulation C: walk one endpoint first, then join the Owner to the other.
const ruleC = (link: LabelOf<Link>, facts: FactRepository) =>
    facts.ofType(Workspace)
        .join(w => w, link.item.workspace)
        .selectMany(w => facts.ofType(Owner)
            .join(o => o.workspace, w)
            .join(o => o.workspace, link.parent.workspace)
            .selectMany(o => facts.ofType(User)
                .join(u => u, o.user)));

type LinkRule = (link: LabelOf<Link>, facts: FactRepository) => any;

function authorization(rule: LinkRule) {
    return (a: AuthorizationRules) => a
        .any(User)
        .any(Workspace)
        .any(Owner)
        .any(Item)
        .type(Link, rule);
}

// Alice owns w1 and Bob owns w2. Two items sit in w1, and one in w2.
function givenWorkspaces() {
    const alice = new User(ALICE_KEY);
    const bob = new User(BOB_KEY);
    const w1 = new Workspace(alice, "w1");
    const w2 = new Workspace(bob, "w2");
    const aliceOwnsW1 = new Owner(w1, alice);
    const bobOwnsW2 = new Owner(w2, bob);
    const first = new Item(w1, "first");
    const second = new Item(w1, "second");
    const foreign = new Item(w2, "foreign");
    return {
        alice, bob, first, second, foreign,
        facts: [alice, bob, w1, w2, aliceOwnsW1, bobOwnsW2, first, second, foreign]
    };
}

describe.each([
    ["formulation A", ruleA],
    ["formulation C", ruleC]
])("Authorization of a rule constraining two predecessor paths, %s", (_name, rule) => {
    describe("through JinagaTest", () => {
        let j: Jinaga;
        let first: Item;
        let second: Item;
        let foreign: Item;

        beforeEach(() => {
            const workspaces = givenWorkspaces();
            first = workspaces.first;
            second = workspaces.second;
            foreign = workspaces.foreign;
            j = JinagaTest.create({
                model: linkModel,
                authorization: authorization(rule),
                user: workspaces.alice,
                initialState: workspaces.facts
            });
        });

        it("should allow the workspace owner to link two items in that workspace", async () => {
            const link = await j.fact(new Link(second, first));

            expect(link.item.label).toEqual("second");
            expect(link.parent.label).toEqual("first");
        });

        it("should refuse a link whose parent is in a workspace the user does not own", async () => {
            const promise = j.fact(new Link(second, foreign));

            await expect(promise).rejects.toBeInstanceOf(Forbidden);
        });
    });

    describe("through getAuthorizedPopulation", () => {
        // getAuthorizedPopulation is the path the replicator takes, so exercise
        // it directly rather than only through JinagaTest.
        async function whenGetAuthorizedPopulation(link: Link) {
            const { facts } = givenWorkspaces();
            const closure: FactEnvelope[] = facts
                .flatMap(fact => dehydrateFact(fact))
                .map(fact => ({ fact, signatures: [] }));
            const linkRecords = dehydrateFact(link);
            const envelope: FactEnvelope = {
                fact: linkRecords[linkRecords.length - 1],
                signatures: []
            };
            const store = new MemoryStore();
            await store.save(closure);
            const rules = authorization(rule)(new AuthorizationRules(linkModel));

            return await rules.getAuthorizedPopulationForEnvelope(
                [ALICE_KEY, BOB_KEY],
                envelope,
                closure.concat(linkRecords.map(fact => ({ fact, signatures: [] }))),
                store);
        }

        it("should name the owner of the workspace holding both endpoints", async () => {
            const { first, second } = givenWorkspaces();

            const population = await whenGetAuthorizedPopulation(new Link(second, first));

            expect(population).toEqual({ quantifier: "some", authorizedKeys: [ALICE_KEY] });
        });

        it("should name nobody when the endpoints are in different workspaces", async () => {
            const { second, foreign } = givenWorkspaces();

            const population = await whenGetAuthorizedPopulation(new Link(second, foreign));

            expect(population).toEqual({ quantifier: "none" });
        });
    });
});
