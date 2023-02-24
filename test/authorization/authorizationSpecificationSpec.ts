import { AuthorizationRules, buildModel, Jinaga, JinagaTest } from '../../src';

describe("Feedback authorization from specification", () => {
  describe("as a user", () => {
    let j: Jinaga;
    let site: Site;
    let content: Content;
  
    beforeEach(async () => {
      site = new Site(new User("Site creator"), "site identifier");
      content = new Content(site, "/path/to/content");
  
      j = JinagaTest.create({
        model,
        authorization,
        user: new User("Logged in user"),
        initialState: [
          site,
          content
        ]
      });
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
  
      const promise = j.fact(new Comment("comment unique id", content, user));
  
      await expect(promise).rejects.not.toBeNull();
    });
  
    it("should allow a comment from logged in user", async () => {
      const { userFact: user } = await j.login<User>();
      const comment = await j.fact(new Comment("comment unique id", content, user));
  
      expect(comment.author.publicKey).toEqual(user.publicKey);
    });
  
    it("should not allow a post from another user", async () => {
      const promise = j.fact(new Content(site, "/path/to/new/content"));
  
      await expect(promise).rejects.not.toBeNull();
    });

    it("should not allow user to invite themselves", async () => {
      const { userFact: self } = await j.login<User>();
      const promise = j.fact(new GuestBlogger(site, self));
  
      await expect(promise).rejects.not.toBeNull();
    });
  });

  describe("as a site creator", () => {
    let j: Jinaga;
    let site: Site;
    let content: Content;
  
    beforeEach(async () => {
      const siteCreator = new User("Site creator");
      site = new Site(siteCreator, "site identifier");
      content = new Content(site, "/path/to/content");
  
      j = JinagaTest.create({
        model,
        authorization,
        user: siteCreator,
        initialState: [
          site,
          content
        ]
      });
    });

    it("should allow a post from the site creator", async () => {
      const newContent = await j.fact(new Content(site, "/path/to/new/content"));
  
      expect(j.hash(newContent.site)).toEqual(j.hash(site));
    });

    it("should allow an invitation to a guest blogger", async () => {
      const guest = await j.fact(new User("Guest blogger"));
      const guestBlogger = await j.fact(new GuestBlogger(site, guest));
  
      expect(j.hash(guestBlogger.site)).toEqual(j.hash(site));
      expect(j.hash(guestBlogger.guest)).toEqual(j.hash(guest));
    });
  });

  describe("as a guest blogger", () => {
    let j: Jinaga;
    let site: Site;
  
    beforeEach(async () => {
      const siteCreator = new User("Site creator");
      site = new Site(siteCreator, "site identifier");
      const guestUser = new User("Guest user");
      const guestBlogger = new GuestBlogger(site, guestUser);
  
      j = JinagaTest.create({
        model,
        authorization,
        user: guestUser,
        initialState: [
          site,
          guestBlogger
        ]
      });
    });

    it("should allow a post from the guest blogger", async () => {
      const newContent = await j.fact(new Content(site, "/path/to/new/content"));
  
      expect(j.hash(newContent.site)).toEqual(j.hash(site));
    });
  });
});

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
}

class GuestBlogger {
  static Type = "Feedback.GuestBlogger" as const;
  type = GuestBlogger.Type;

  constructor (
    public site: Site,
    public guest: User
  ) { }
}

class Content {
  static Type = "Feedback.Content" as const;
  type = Content.Type;

  constructor (
    public site: Site,
    public path: string
  ) { }
}

class Comment {
  static Type = "Feedback.Comment" as const;
  type = Comment.Type;

  constructor (
    public uniqueId: string,
    public content: Content,
    public author: User
  ) { }
}

const model = buildModel(b => b
  .type(User)
  .type(Site, f => f
    .predecessor("creator", User)
  )
  .type(GuestBlogger, f => f
    .predecessor("site", Site)
    .predecessor("guest", User)
  )
  .type(Content, f => f
    .predecessor("site", Site)
  )
  .type(Comment, f => f
    .predecessor("content", Content)
    .predecessor("author", User)
  )
);

function authorization(a: AuthorizationRules) {
  return a
    .any(User)
    .type(Site, site => site.creator)
    .type(GuestBlogger, guestBlogger => guestBlogger.site.creator)
    .type(Content, content => content.site.creator)
    .type(Content, (content, facts) =>
      facts.ofType(GuestBlogger)
        .join(guestBlogger => guestBlogger.site, content.site)
        .selectMany(guestBlogger => facts.ofType(User)
          .join(user => user, guestBlogger.guest)
        )
    )
    .type(Comment, comment => comment.author)
    ;
}
