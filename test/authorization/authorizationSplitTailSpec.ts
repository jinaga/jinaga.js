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

    describe("an existential condition that reads the given", () => {
        // Formulation D of issue #231. The head walks link.item.workspace. The
        // tail matches Owner against it, and its existential condition walks
        // link.parent.workspace, so the tail is given both the head's Workspace
        // and the Link under authorization. A rule runs while its fact is being
        // authorized, before the fact is saved, so that tail reads nothing and
        // the rule admits nobody. It is refused where it is written.
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

        it("should make the Link under authorization a given of the tail", () => {
            const specification = linkModel.given(Link).match(linkRule);

            const { head, tail } = splitBeforeFirstSuccessor(assertWellFormed(specification.specification, "The specification"));

            expect(head).toBeDefined();
            expect((tail as Specification).given.map(given => given.label)).toEqual([
                { name: "p1", type: "Link" },
                { name: "__s0", type: "Workspace" }
            ]);
        });

        it("should refuse the rule where it is written", () => {
            // Before #308 every write of a Link raised AuthorizationRuleError
            // from the evaluator. After it, every write was refused with
            // Forbidden, which looked like enforcement. The rule now fails at
            // the point it is written, naming the label the tail cannot read.
            // Admitting the write alice is entitled to needs the tail to see the
            // Link's predecessors, which is the open question on issue #297.
            expect(() => linkAuthorization(new AuthorizationRules(linkModel)))
                .toThrow(AuthorizationRuleError);
            expect(() => linkAuthorization(new AuthorizationRules(linkModel)))
                .toThrow(/uses 'p1' after its first successor join/);
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
