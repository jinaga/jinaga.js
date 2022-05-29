import { AuthorizationRules, ensure, Jinaga, JinagaTest } from '../../src';

describe("Feedback authorization", () => {
  let j: Jinaga;
  let site: Site;

  beforeEach(async () => {
    site = new Site(new User("Site creator"), "site identifier");

    j = JinagaTest.create({
      authorization,
      user: new User("Logged in user"),
      initialState: [
        site
      ]
    });
  });

  it("should have logged in user", async () => {
    const { userFact: user } = await j.login<User>();

    expect(user.publicKey).toEqual("Logged in user");
  });

  it("should allow a user", async () => {
    const creator = await j.fact(new User("Other user"));

    expect(creator.publicKey).toEqual("Other user");
  });

  it("should not allow site created by a different user", async () => {
    const creator = await j.fact(new User("Other user"));

    const promise = j.fact(new Site(creator, "site identifier"));

    await expect(promise).rejects.not.toBeNull();
  });

  it("should allow a site created by the logged in user", async () => {
    const creator = await j.fact(new User("Logged in user"));

    const site = await j.fact(new Site(creator, "site identifier"));

    expect(site.creator.publicKey).toEqual("Logged in user");
  });

  it("should not allow a comment from another user", async () => {
    const user = await j.fact(new User("Another user"));
    const content = await j.fact(new Content(site, "/path/to/content"));

    const promise = j.fact(new Comment("comment unique id", content, user));

    await expect(promise).rejects.not.toBeNull();
  });

  it("should allow a comment from logged in user", async () => {
    const { userFact: user } = await j.login<User>();
    const content = await j.fact(new Content(site, "/path/to/content"));
    const comment = await j.fact(new Comment("comment unique id", content, user));

    expect(comment.author.publicKey).toEqual(user.publicKey);
  });
});

const j = Jinaga;

class User {
  static Type = "Jinaga.User" as const;
  type = User.Type;

  constructor (
    public publicKey: string
  ) { }
}

class Site {
  static Type = "Feedback.Site" as const;
  type = Site.Type;

  constructor (
    public creator: User,
    public identifier: string
  ) { }

  static creator(site: Site) {
    ensure(site).has("creator", User);
    return j.match(site.creator);
  }
}

class Content {
  static Type = "Feedback.Content" as const;
  type = Content.Type;

  constructor (
    public site: Site,
    public path: string
  ) { }

  static site(content: Content) {
    ensure(content).has("site", Site);
    return j.match(content.site);
  }
}

class Comment {
  static Type = "Feedback.Comment" as const;
  type = Comment.Type;

  constructor (
    public uniqueId: string,
    public content: Content,
    public author: User
  ) { }

  static author(comment: Comment) {
    ensure(comment).has("author", User);
    return j.match(comment.author);
  }
}

function authorization(a: AuthorizationRules) {
  return a
    .any(User.Type)
    .type(Site.Type, j.for(Site.creator))
    .any(Content.Type)
    .type(Comment.Type, j.for(Comment.author))
    ;
}
