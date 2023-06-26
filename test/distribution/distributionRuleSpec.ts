import { Trace } from "../../src/jinaga";
import { JinagaTest } from "../../src/jinaga-test";
import { User } from "../../src/model/user";
import { Blog, Comment, Post, Publish, distribution, model } from "../blogModel";

describe("distribution rules", () => {
  Trace.off();

  const creator = new User("creator");
  const reader = new User("reader");
  const commenter = new User("commenter");
  const blog = new Blog(creator, "domain");
  const post = new Post(blog, creator, new Date());
  const comment = new Comment(post, commenter, "text", new Date());

  it("should prevent public access to unpublished posts", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
    );

    const j = givenLoggedIn(undefined);
    await expect(() => j.query(specification, blog)).rejects.toThrow("Not authorized");
  });

  it("should permit public access to publications", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Publish)
        .join(publish => publish.post.blog, blog)
    );

    const j = givenLoggedIn(undefined);
    const result = await j.query(specification, blog);
    expect(result).toHaveLength(0);
  });

  it("should permit public access to published posts", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
        .exists(post => facts.ofType(Publish)
          .join(publish => publish.post, post)
        )
    );

    const j = givenLoggedIn(undefined);
    const result = await j.query(specification, blog);
    expect(result).toHaveLength(0);
  });

  it("should permit the creator to access all posts", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
    );

    const j = givenLoggedIn(creator);
    const result = await j.query(specification, blog);
    expect(result).toHaveLength(1);
  });

  it("should not permit a reader to access all posts", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
    );

    const j = givenLoggedIn(reader);
    await expect(() => j.query(specification, blog)).rejects.toThrow("Not authorized");
  });

  it("should permit reader to access publications", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Publish)
        .join(publish => publish.post.blog, blog)
    );

    const j = givenLoggedIn(reader);
    const result = await j.query(specification, blog);
    expect(result).toHaveLength(0);
  });

  it("should permit reader to access published posts", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
        .exists(post => facts.ofType(Publish)
          .join(publish => publish.post, post)
        )
    );

    const j = givenLoggedIn(reader);
    const result = await j.query(specification, blog);
    expect(result).toHaveLength(0);
  });

  it("should permit creator to access all comments", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Comment)
        .join(comment => comment.post.blog, blog)
    );

    const j = givenLoggedIn(creator);
    const result = await j.query(specification, blog);
    expect(result).toHaveLength(1);
  });

  it(("should not permit public access to comments"), async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Comment)
        .join(comment => comment.post.blog, blog)
    );

    const j = givenLoggedIn(undefined);
    await expect(() => j.query(specification, blog)).rejects.toThrow("Not authorized");
  });

  it("should not permit reader to access all comments", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Comment)
        .join(comment => comment.post.blog, blog)
    );

    const j = givenLoggedIn(reader);
    await expect(() => j.query(specification, blog)).rejects.toThrow("Not authorized");
  });

  it("should not permit commenter to access all comments", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Comment)
        .join(comment => comment.post.blog, blog)
    );

    const j = givenLoggedIn(commenter);
    await expect(() => j.query(specification, blog)).rejects.toThrow("Not authorized");
  });

  it("should permit commenter to access their own comments", async () => {
    const specification = model.given(Blog, User).match((blog, commenter, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
        .exists(post => facts.ofType(Publish)
          .join(publish => publish.post, post)
        )
        .selectMany(post => facts.ofType(Comment)
          .join(comment => comment.post, post)
          .join(comment => comment.author, commenter)
        )
    );

    const j = givenLoggedIn(commenter);
    const result = await j.query(specification, blog, commenter);
    expect(result).toHaveLength(0);
  });

  it("should not permit reader to access someone else's comments", async () => {
    const specification = model.given(Blog, User).match((blog, commenter, facts) =>
      facts.ofType(Comment)
        .join(comment => comment.post.blog, blog)
        .join(comment => comment.author, commenter)
    );

    const j = givenLoggedIn(reader);
    await expect(() => j.query(specification, blog, commenter)).rejects.toThrow("Not authorized");
  });

  it("should permit access to published blogs and my own comments", async () => {
    const specification = model.given(User, Blog).match((user, blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
        .exists(post => facts.ofType(Publish)
          .join(publish => publish.post, post)
        )
        .select(post => ({
          post,
          comments: facts.ofType(Comment)
            .join(comment => comment.post, post)
            .join(comment => comment.author, user)
        }))
    );

    const j = givenLoggedIn(commenter);
    const result = await j.query(specification, commenter, blog);
    expect(result).toHaveLength(0);
  });

  function givenLoggedIn(user: User | undefined) {
    return JinagaTest.create({
      model,
      user,
      initialState: [
        creator,
        reader,
        commenter,
        blog,
        post,
        comment
      ],
      distribution
    });
  }
});
