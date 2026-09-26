import { AuthorizationRules, FactEnvelope, FactRepository, Forbidden, Jinaga, JinagaTest, LabelOf, MemoryStore, User, buildModel, dehydrateFact } from "@src";
import { Blog, Comment, Post, model as blogModel } from "../blogModel";

// A match may join its unknown to several predecessor paths of the given. The
// graph can run such a match, so the split belongs after it, not before it
// (issue #299).

const CREATOR_KEY = "creator-public-key";
const OTHER_KEY = "other-public-key";

// "Only the blog's creator may comment, and only in their own name." The one
// match joins the comment's author and the blog's creator to the same user.
const commentAuthorization = (a: AuthorizationRules) => a
    .any(User)
    .any(Blog)
    .any(Post)
    .type(Comment, (comment, facts) =>
        facts.ofType(User)
            .join(user => user, comment.author)
            .join(user => user, comment.post.blog.creator)
    );

function givenBlogAndPost(creatorKey: string) {
    const creator = new User(creatorKey);
    const blog = new Blog(creator, "qedcode.com");
    const post = new Post(blog, creator, "2026-01-01T00:00:00.000Z");
    return { creator, blog, post };
}

describe("Authorization of a match with several predecessor joins", () => {
    describe("through JinagaTest", () => {
        let j: Jinaga;
        let post: Post;

        beforeEach(() => {
            const { creator, blog, post: p } = givenBlogAndPost(CREATOR_KEY);
            post = p;
            j = JinagaTest.create({
                model: blogModel,
                authorization: commentAuthorization,
                user: creator,
                initialState: [creator, blog, post]
            });
        });

        it("should allow the creator to comment in their own name", async () => {
            const { userFact: creator } = await j.login<User>();

            const comment = await j.fact(new Comment(post, creator, "Nice post", "2026-01-02T00:00:00.000Z"));

            expect(comment.author.publicKey).toEqual(CREATOR_KEY);
        });

        it("should refuse the creator commenting in another user's name", async () => {
            const other = await j.fact(new User(OTHER_KEY));

            const promise = j.fact(new Comment(post, other, "Not me", "2026-01-02T00:00:00.000Z"));

            await expect(promise).rejects.toBeInstanceOf(Forbidden);
        });

        it("should refuse a comment from a user who is not the creator", async () => {
            const other = new User(OTHER_KEY);
            const otherJ = JinagaTest.create({
                model: blogModel,
                authorization: commentAuthorization,
                user: other,
                initialState: [new User(CREATOR_KEY), post.blog, post, other]
            });
            const { userFact: author } = await otherJ.login<User>();

            const promise = otherJ.fact(new Comment(post, author, "Hello", "2026-01-02T00:00:00.000Z"));

            await expect(promise).rejects.toBeInstanceOf(Forbidden);
        });
    });

    describe("through getAuthorizedPopulation", () => {
        function givenCommentEnvelopes(authorKey: string): FactEnvelope[] {
            return dehydrateFact({
                type: Comment.Type,
                post: {
                    type: Post.Type,
                    blog: {
                        type: Blog.Type,
                        creator: { type: User.Type, publicKey: CREATOR_KEY },
                        domain: "qedcode.com"
                    },
                    author: { type: User.Type, publicKey: CREATOR_KEY },
                    createdAt: "2026-01-01T00:00:00.000Z"
                },
                author: { type: User.Type, publicKey: authorKey },
                text: "Nice post",
                createdAt: "2026-01-02T00:00:00.000Z"
            }).map(fact => ({ fact, signatures: [] }));
        }

        async function whenGetAuthorizedPopulation(envelopes: FactEnvelope[], candidateKeys: string[]) {
            const rules = commentAuthorization(new AuthorizationRules(blogModel));
            const store = new MemoryStore();
            await store.save(envelopes);
            const envelope = envelopes[envelopes.length - 1];
            return await rules.getAuthorizedPopulationForEnvelope(candidateKeys, envelope, envelopes, store);
        }

        it("should name the creator when they comment in their own name", async () => {
            const population = await whenGetAuthorizedPopulation(givenCommentEnvelopes(CREATOR_KEY), [CREATOR_KEY, OTHER_KEY]);

            expect(population).toEqual({ quantifier: "some", authorizedKeys: [CREATOR_KEY] });
        });

        it("should name nobody when the author is not the creator", async () => {
            const population = await whenGetAuthorizedPopulation(givenCommentEnvelopes(OTHER_KEY), [CREATOR_KEY, OTHER_KEY]);

            expect(population).toEqual({ quantifier: "none" });
        });
    });
});

// Formulation B of issue #231: one Workspace joined to the workspace of both
// endpoints of a Link, then the owners of that workspace.

class Workspace {
    static Type = "Workspace" as const;
    type = Workspace.Type;
    constructor(
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
    .type(Workspace)
    .type(Owner, o => o
        .predecessor("workspace", Workspace)
        .predecessor("user", User)
    )
    .type(Item, i => i
        .predecessor("workspace", Workspace)
    )
    .type(Link, l => l
        .predecessor("item", Item)
        .predecessor("parent", Item)
    )
);

const linkAuthorization = (a: AuthorizationRules) => a
    .type(Link, (link: LabelOf<Link>, facts: FactRepository) =>
        facts.ofType(Workspace)
            .join(w => w, link.item.workspace)
            .join(w => w, link.parent.workspace)
            .selectMany(w => facts.ofType(Owner)
                .join(o => o.workspace, w)
                .selectMany(o => facts.ofType(User)
                    .join(u => u, o.user)
                )
            )
    );

describe("Authorization of formulation B of a two-endpoint link", () => {
    const alice = new User("alice-public-key");
    const ownedWorkspace = new Workspace("owned");
    const foreignWorkspace = new Workspace("foreign");
    const owned = new Owner(ownedWorkspace, alice);
    const first = new Item(ownedWorkspace, "first");
    const second = new Item(ownedWorkspace, "second");
    const foreign = new Item(foreignWorkspace, "foreign");

    let j: Jinaga;

    beforeEach(() => {
        j = JinagaTest.create({
            model: linkModel,
            authorization: linkAuthorization,
            user: alice,
            initialState: [alice, ownedWorkspace, foreignWorkspace, owned, first, second, foreign]
        });
    });

    it("should allow a link whose endpoints share a workspace alice owns", async () => {
        const link = await j.fact(new Link(second, first));

        expect(link.item.label).toEqual("second");
        expect(link.parent.label).toEqual("first");
    });

    it("should refuse a link whose endpoints are in different workspaces", async () => {
        const promise = j.fact(new Link(second, foreign));

        await expect(promise).rejects.toBeInstanceOf(Forbidden);
    });
});
