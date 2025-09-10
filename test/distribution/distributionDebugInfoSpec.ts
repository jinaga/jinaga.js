import { JinagaTest, Trace, User } from "@src";
import { Blog, Comment, Post, distribution, model } from "../blogModel";

describe("distribution debug information", () => {
  Trace.off();

  const creator = new User("creator");
  const reader = new User("reader");
  const blog = new Blog(creator, "domain");
  const post = new Post(blog, creator, new Date());

  it("should return empty result when user lacks permissions in test mode", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Post)
        .join(post => post.blog, blog)
    );

    const j = JinagaTest.create({
      model,
      user: reader,
      initialState: [
        creator,
        reader,
        blog,
        post
      ],
      distribution
    });

    const result = await j.query(specification, blog);
    expect(result).toStrictEqual([]);
  });

  it("should return empty result when user lacks permissions for comments", async () => {
    const specification = model.given(Blog).match((blog, facts) =>
      facts.ofType(Comment)
        .join(comment => comment.post.blog, blog)
    );

    const comment = new Comment(post, reader, "test comment", new Date());

    const j = JinagaTest.create({
      model,
      user: reader,
      initialState: [
        creator,
        reader,
        blog,
        post,
        comment
      ],
      distribution
    });

    const result = await j.query(specification, blog);
    expect(result).toStrictEqual([]);
  });
});