import { DistributionRules } from "../src/distribution/distribution-rules";
import { User } from "../src/model/user";
import { buildModel } from "../src/specification/model";

export class Blog {
  static Type = "Blog" as const;
  type = Blog.Type;

  constructor(
    public creator: User,
    public domain: string
  ) { }
}

export class Post {
  static Type = "Post" as const;
  type = Post.Type;

  constructor(
    public blog: Blog,
    public author: User,
    public createdAt: Date | string
  ) { }
}

export class Publish {
  static Type = "Publish" as const;
  type = Publish.Type;

  constructor(
    public post: Post,
    public date: Date | string
  ) { }
}

export class Comment {
  static Type = "Comment" as const;
  type = Comment.Type;

  constructor(
    public post: Post,
    public author: User,
    public text: string,
    public createdAt: Date | string
  ) { }
}

export class CommentApproved {
  static Type = "CommentApproved" as const;
  type = CommentApproved.Type;

  constructor(
    public comment: Comment,
    public approvedAt: Date | string
  ) { }
}

export const model = buildModel(b => b
  .type(User)
  .type(Blog, x => x
    .predecessor("creator", User)
  )
  .type(Post, x => x
    .predecessor("blog", Blog)
    .predecessor("author", User)
  )
  .type(Publish, x => x
    .predecessor("post", Post)
  )
  .type(Comment, x => x
    .predecessor("post", Post)
    .predecessor("author", User)
  )
  .type(CommentApproved, x => x
    .predecessor("comment", Comment)
  )
);

export const distribution = (r: DistributionRules) => r
  // Everyone can see published posts
  .share(model.given(Blog).match((blog, facts) =>
    facts.ofType(Post)
      .join(post => post.blog, blog)
      .exists(post => facts.ofType(Publish)
        .join(publish => publish.post, post)
      )
  )).withEveryone()
  // The creator can see all posts
  .share(model.given(Blog).match((blog, facts) =>
    facts.ofType(Post)
      .join(post => post.blog, blog)
  )).with(model.given(Blog).match((blog, facts) =>
      facts.ofType(User)
        .join(user => user, blog.creator)
  ))
  // The creator can see all comments
  .share(model.given(Blog).match((blog, facts) =>
    facts.ofType(Post)
      .join(post => post.blog, blog)
      .selectMany(post => facts.ofType(Comment)
        .join(comment => comment.post, post)
      )
  )).with(model.given(Blog).match((blog, facts) =>
    facts.ofType(User)
      .join(user => user, blog.creator)
  ))
  // A comment author can see their own comments on published posts
  .share(model.given(Blog, User).match((blog, author, facts) =>
    facts.ofType(Post)
      .join(post => post.blog, blog)
      .exists(post => facts.ofType(Publish)
        .join(publish => publish.post, post)
      )
      .selectMany(post => facts.ofType(Comment)
        .join(comment => comment.post, post)
        .join(comment => comment.author, author)
      )
  )).with(model.given(Blog, User).match((blog, author, facts) =>
    facts.ofType(User)
      .join(user => user, author)
  ))
  ;
