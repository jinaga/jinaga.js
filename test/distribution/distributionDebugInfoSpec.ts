import { JinagaTest, Trace, User } from "@src";
import { Blog, Comment, Post, distribution, model } from "../blogModel";

describe("distribution debug information", () => {
  Trace.off();

  const creator = new User("creator");
  const reader = new User("reader");
  const blog = new Blog(creator, "domain");
  const post = new Post(blog, creator, new Date());

  it("should provide detailed failure information in test mode", async () => {
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

    try {
      await j.query(specification, blog);
      fail("Expected query to throw 'Not authorized' error");
    } catch (error: any) {
      expect(error.message).toContain("Not authorized");
      expect(error.message).toContain("The user does not match");
      
      // Check for enhanced debug information that should be present in test mode
      expect(error.message).toContain("Expected hashes:");
      expect(error.message).toContain("User hash:");

      // Verify the user fact contains the reader's hash
      expect(error.message).toContain(j.hash(reader));
    }
  });

  it("should include matching set information when available", async () => {
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

    try {
      await j.query(specification, blog);
      fail("Expected query to throw 'Not authorized' error");
    } catch (error: any) {
      expect(error.message).toContain("Not authorized");
      expect(error.message).toContain("The user does not match");
      
      // Verify that detailed debug information is present
      expect(error.message).toContain("Expected hashes:");
      expect(error.message).toContain("User hash:");

      // Verify the user fact contains the reader's information
      expect(error.message).toContain(j.hash(reader));
    }
  });
});