import { User } from "../src/model/user"
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
);