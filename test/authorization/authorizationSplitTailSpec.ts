import { AuthorizationRuleError, AuthorizationRules, FactEnvelope, FactRecord, FactRepository, Forbidden, Jinaga, JinagaTest, LabelOf, MemoryStore, Specification, User, buildModel, assertWellFormed, dehydrateFact, splitBeforeFirstSuccessor } from "@src";
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

    describe("an existential condition that reads a predecessor of the given", () => {
        // Formulation D of issue #231. The pivot joins Owner to
        // link.item.workspace, and its existential condition walks
        // link.parent.workspace. The split moves that walk out of the positive
        // existential condition and into the head, so the tail is given the two
        // workspaces rather than the Link, which is not in the store while it
        // is being authorized.
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

        it("should walk both endpoints' workspaces in the head", () => {
            const specification = linkModel.given(Link).match(linkRule);

            const { head, tail } = splitBeforeFirstSuccessor(assertWellFormed(specification.specification, "The specification"));

            expect(head.matches.map(match => match.unknown)).toEqual([
                { name: "__s0", type: "Workspace" },
                { name: "__s1", type: "Workspace" }
            ]);
            expect((tail as Specification).given.map(given => given.label)).toEqual([
                { name: "__s0", type: "Workspace" },
                { name: "__s1", type: "Workspace" }
            ]);
        });

        it("should admit a link whose endpoints are both in alice's workspace", async () => {
            const j = JinagaTest.create({ model: linkModel, authorization: linkAuthorization, user: alice, initialState });

            const link = await j.fact(new Link(aliceOtherItem, aliceItem));

            expect(j.hash(link.parent)).toEqual(j.hash(aliceItem));
        });

        it("should refuse with Forbidden a link whose parent is in bob's workspace", async () => {
            const j = JinagaTest.create({ model: linkModel, authorization: linkAuthorization, user: alice, initialState });

            const promise = j.fact(new Link(aliceOtherItem, bobItem));

            await expect(promise).rejects.toBeInstanceOf(Forbidden);
        });

        it("should return alice's key from getAuthorizedPopulation when both endpoints are hers", async () => {
            const population = await whenAuthorizeLink(aliceOtherItem, aliceItem);

            expect(population).toEqual({
                quantifier: "some",
                authorizedKeys: ["alice"]
            });
        });

        it("should return no keys from getAuthorizedPopulation when the parent is in another workspace", async () => {
            const population = await whenAuthorizeLink(aliceOtherItem, bobItem);

            expect(population).toEqual({ quantifier: "none" });
        });

        async function whenAuthorizeLink(item: Item, parent: Item) {
            // The Link is under authorization, so it is in the batch and not in
            // the store, as it is during a live write.
            const stored: FactEnvelope[] = initialState
                .flatMap(fact => dehydrateFact(fact))
                .map(fact => ({ fact, signatures: [] }));
            const store = new MemoryStore();
            await store.save(stored);
            const linkRecords = dehydrateFact(new Link(item, parent));
            const envelope: FactEnvelope = { fact: lastOf(linkRecords), signatures: [] };
            const rules = linkAuthorization(new AuthorizationRules(linkModel));

            return await rules.getAuthorizedPopulationForEnvelope(
                ["alice", "bob"], envelope, stored.concat(linkRecords.map(fact => ({ fact, signatures: [] }))), store);
        }
    });

    describe("a negative existential condition that reads a predecessor of the given", () => {
        // Only an owner of the item's workspace may link it, unless the
        // parent's workspace is archived. The walk to the parent's workspace
        // sits beneath a negative existential condition, where the split must
        // not move it into the head: if the parent role named several items,
        // the tail would test their workspaces one at a time, and an unarchived
        // one would admit a link that an archived one should refuse. The tail
        // therefore reads the Link, and the rule is refused where it is written.
        const archivedRule = (link: LabelOf<Link>, facts: FactRepository) =>
            facts.ofType(Owner)
                .join(o => o.workspace, link.item.workspace)
                .notExists(o => facts.ofType(Archive)
                    .join(a => a.workspace, link.parent.workspace))
                .selectMany(o => facts.ofType(User).join(u => u, o.user));

        it("should leave the walk beneath the negation in the tail", () => {
            const specification = linkModel.given(Link).match(archivedRule);

            const { tail } = splitBeforeFirstSuccessor(assertWellFormed(specification.specification, "The specification"));

            expect((tail as Specification).given.map(given => given.label)).toEqual([
                { name: "p1", type: "Link" },
                { name: "__s0", type: "Workspace" }
            ]);
        });

        it("should refuse the rule where it is written", () => {
            expect(() => new AuthorizationRules(linkModel).type(Link, archivedRule))
                .toThrow(AuthorizationRuleError);
            expect(() => new AuthorizationRules(linkModel).type(Link, archivedRule))
                .toThrow(/reads 'p1' from the store/);
        });
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

class Archive {
    static Type = "Archive" as const;
    type = Archive.Type;
    constructor(
        public workspace: Workspace
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
    .type(Archive, x => x
        .predecessor("workspace", Workspace)
    )
);

function lastOf(records: FactRecord[]): FactRecord {
    return records[records.length - 1];
}
