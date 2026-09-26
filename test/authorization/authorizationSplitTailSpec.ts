import { AuthorizationRuleError, AuthorizationRules, FactEnvelope, FactRecord, FactRepository, Forbidden, Jinaga, JinagaTest, LabelOf, MemoryStore, Specification, User, buildModel, dehydrateFact, splitBeforeFirstSuccessor } from "@src";
import { Blog, Post, model as blogModel } from "../blogModel";

// A rule that binds a label before its first successor join and projects it.
// The split puts that label in the head and makes it a given of the tail, so
// the tail has two givens and the head projects both of them.
const postAuthorization = (a: AuthorizationRules) => a
    .any(User)
    .any(Blog)
    .type(Post, (p, facts) =>
        facts.ofType(User)
            .join(user => user, p.blog.creator)
            .selectMany(creator => facts.ofType(Post)
                .join(other => other.blog, p.blog)
                .select(other => creator)));

describe("Authorization rule whose tail has several givens", () => {
    describe("a projected label bound in the head", () => {
        let owner: User;
        let otherUser: User;
        let blog: Blog;
        let firstPost: Post;

        beforeEach(() => {
            owner = new User("blog owner");
            otherUser = new User("other user");
            blog = new Blog(owner, "domain");
            firstPost = new Post(blog, owner, new Date(2024, 0, 1).toISOString());
        });

        function createInstance(user: User): Jinaga {
            return JinagaTest.create({
                model: blogModel,
                authorization: postAuthorization,
                user,
                initialState: [owner, otherUser, blog, firstPost]
            });
        }

        it("should allow the blog owner to add a post to a blog that already has one", async () => {
            const j = createInstance(owner);

            const post = await j.fact(new Post(blog, owner, new Date(2024, 0, 2).toISOString()));

            expect(j.hash(post.blog)).toEqual(j.hash(blog));
        });

        it("should refuse another user with Forbidden", async () => {
            const j = createInstance(otherUser);

            const promise = j.fact(new Post(blog, owner, new Date(2024, 0, 2).toISOString()));

            await expect(promise).rejects.toBeInstanceOf(Forbidden);
        });

        it("should return the owner's key from getAuthorizedPopulation", async () => {
            // getAuthorizedPopulation is the path the replicator takes, so
            // exercise it directly rather than only through JinagaTest.
            const records = [
                ...dehydrateFact(owner),
                ...dehydrateFact(blog),
                ...dehydrateFact(firstPost)
            ];
            const store = new MemoryStore();
            await store.save(records.map(fact => ({ fact, signatures: [] })));

            const secondPost = new Post(blog, owner, new Date(2024, 0, 2).toISOString());
            const batch = dehydrateFact(secondPost);
            const envelopes: FactEnvelope[] = [...records, ...batch]
                .map(fact => ({ fact, signatures: [] }));
            const envelope: FactEnvelope = { fact: lastOf(batch), signatures: [] };
            const rules = postAuthorization(new AuthorizationRules(blogModel));

            const population = await rules.getAuthorizedPopulationForEnvelope(
                ["blog owner", "other user"], envelope, envelopes, store);

            expect(population).toEqual({
                quantifier: "some",
                authorizedKeys: ["blog owner"]
            });
        });
    });

    describe("an existential condition that reads the given", () => {
        // Formulation D of issue #231. The head walks link.item.workspace. The
        // tail matches Owner against it, and its existential condition walks
        // link.parent.workspace, so the tail is given both the head's Workspace
        // and the Link under authorization.
        const linkRule = (link: LabelOf<Link>, facts: FactRepository) =>
            facts.ofType(Owner)
                .join(o => o.workspace, link.item.workspace)
                .exists(o => facts.ofType(Owner)
                    .join(o2 => o2.workspace, link.parent.workspace)
                    .join(o2 => o2.user, o.user))
                .selectMany(o => facts.ofType(User).join(u => u, o.user));

        const linkAuthorization = (a: AuthorizationRules) => a
            .any(User)
            .any(Workspace)
            .any(Owner)
            .any(Item)
            .type(Link, linkRule);

        let alice: User;
        let bob: User;
        let aliceWorkspace: Workspace;
        let bobWorkspace: Workspace;
        let aliceOwns: Owner;
        let bobOwns: Owner;
        let aliceItem: Item;
        let aliceOtherItem: Item;
        let bobItem: Item;
        let initialState: {}[];

        beforeEach(() => {
            alice = new User("alice");
            bob = new User("bob");
            aliceWorkspace = new Workspace(alice, "alice workspace");
            bobWorkspace = new Workspace(bob, "bob workspace");
            aliceOwns = new Owner(aliceWorkspace, alice);
            bobOwns = new Owner(bobWorkspace, bob);
            aliceItem = new Item(aliceWorkspace, "first");
            aliceOtherItem = new Item(aliceWorkspace, "second");
            bobItem = new Item(bobWorkspace, "bob item");
            initialState = [alice, bob, aliceWorkspace, bobWorkspace, aliceOwns,
                bobOwns, aliceItem, aliceOtherItem, bobItem];
        });

        it("should make the Link under authorization a given of the tail", () => {
            const specification = linkModel.given(Link).match(linkRule);

            const { head, tail } = splitBeforeFirstSuccessor(specification.specification);

            expect(head).toBeDefined();
            expect((tail as Specification).given.map(given => given.label)).toEqual([
                { name: "p1", type: "Link" },
                { name: "s1", type: "Workspace" }
            ]);
        });

        it("should evaluate the rule rather than raising AuthorizationRuleError", async () => {
            // Before this fix the composite head projection was refused outright,
            // so every write of a Link raised AuthorizationRuleError. The rule now
            // evaluates. A live write is still refused, because the tail is given
            // the Link and the store cannot read a fact that has not been saved
            // yet; that is recorded on issue #297.
            const j = JinagaTest.create({
                model: linkModel,
                authorization: linkAuthorization,
                user: alice,
                initialState
            });

            const promise = j.fact(new Link(aliceOtherItem, aliceItem));

            await expect(promise).rejects.not.toBeInstanceOf(AuthorizationRuleError);
        });

        it("should return alice's key from getAuthorizedPopulation when both endpoints are hers", async () => {
            const { population } = await whenAuthorizeLink(aliceOtherItem, aliceItem);

            expect(population).toEqual({
                quantifier: "some",
                authorizedKeys: ["alice"]
            });
        });

        it("should return no keys from getAuthorizedPopulation when the parent is in another workspace", async () => {
            const { population } = await whenAuthorizeLink(aliceOtherItem, bobItem);

            expect(population).toEqual({ quantifier: "none" });
        });

        async function whenAuthorizeLink(item: Item, parent: Item) {
            // The tail is given the Link, so the store must be able to read it.
            const link = new Link(item, parent);
            const records = [
                ...dehydrateFact(alice),
                ...dehydrateFact(bob),
                ...dehydrateFact(aliceWorkspace),
                ...dehydrateFact(bobWorkspace),
                ...dehydrateFact(aliceOwns),
                ...dehydrateFact(bobOwns),
                ...dehydrateFact(aliceItem),
                ...dehydrateFact(aliceOtherItem),
                ...dehydrateFact(bobItem),
                ...dehydrateFact(link)
            ];
            const envelopes: FactEnvelope[] = records.map(fact => ({ fact, signatures: [] }));
            const store = new MemoryStore();
            await store.save(envelopes);
            const envelope: FactEnvelope = { fact: lastOf(dehydrateFact(link)), signatures: [] };
            const rules = linkAuthorization(new AuthorizationRules(linkModel));

            const population = await rules.getAuthorizedPopulationForEnvelope(
                ["alice", "bob"], envelope, envelopes, store);
            return { population };
        }
    });
});

class Workspace {
    static Type = "Workspace" as const;
    type = Workspace.Type;
    constructor(
        public creator: User,
        public identifier: string
    ) { }
}

class Owner {
    static Type = "Owner" as const;
    type = Owner.Type;
    constructor(
        public workspace: Workspace,
        public user: User
    ) { }
}

class Item {
    static Type = "Item" as const;
    type = Item.Type;
    constructor(
        public workspace: Workspace,
        public label: string
    ) { }
}

class Link {
    static Type = "Link" as const;
    type = Link.Type;
    constructor(
        public item: Item,
        public parent: Item
    ) { }
}

const linkModel = buildModel(b => b
    .type(User)
    .type(Workspace, x => x
        .predecessor("creator", User)
    )
    .type(Owner, x => x
        .predecessor("workspace", Workspace)
        .predecessor("user", User)
    )
    .type(Item, x => x
        .predecessor("workspace", Workspace)
    )
    .type(Link, x => x
        .predecessor("item", Item)
        .predecessor("parent", Item)
    )
);

function lastOf(records: FactRecord[]): FactRecord {
    return records[records.length - 1];
}
