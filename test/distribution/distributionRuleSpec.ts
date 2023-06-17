import { JinagaTest } from "../../src/jinaga-test";
import { User } from "../../src/model/user";
import { Blog, Post, Publish, distribution, model } from "../blogModel";

describe("distribution rules", () => {
  const creator = new User("creator");
  const reader = new User("reader");
  const blog = new Blog(creator, "domain");

  it("should prevent public access to unpublished posts", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
    );

    const j = givenLoggedIn(undefined);
    await expect(() => j.query(specification, blog)).rejects;
  });

  it("should permit public access to publications", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Publish)
        .join(publish => publish.post.blog, blog)
    );

    const j = givenLoggedIn(undefined);
    await expect(() => j.query(specification, blog)).resolves;
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
    await expect(() => j.query(specification, blog)).rejects;
  });

  it("should permit the creator to access all posts", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
    );

    const j = givenLoggedIn(creator);
    await expect(() => j.query(specification, blog)).resolves;
  });

  it("should not permit a reader to access all posts", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
    );

    const j = givenLoggedIn(reader);
    await expect(() => j.query(specification, blog)).rejects;
  });

  it("should permit reader to access publications", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Publish)
        .join(publish => publish.post.blog, blog)
    );

    const j = givenLoggedIn(reader);
    await expect(() => j.query(specification, blog)).resolves;
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
    await expect(() => j.query(specification, blog)).resolves;
  });

  function givenLoggedIn(user: User | undefined) {
    return JinagaTest.create({
      model,
      user,
      initialState: [
        creator,
        reader,
        blog
      ],
      distribution
    });
  }
});
