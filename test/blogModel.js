"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.distribution = exports.model = exports.CommentApproved = exports.Comment = exports.Publish = exports.Post = exports.Blog = void 0;
const _src_1 = require("@src");
class Blog {
    constructor(creator, domain) {
        this.creator = creator;
        this.domain = domain;
        this.type = Blog.Type;
    }
}
exports.Blog = Blog;
Blog.Type = "Blog";
class Post {
    constructor(blog, author, createdAt) {
        this.blog = blog;
        this.author = author;
        this.createdAt = createdAt;
        this.type = Post.Type;
    }
}
exports.Post = Post;
Post.Type = "Post";
class Publish {
    constructor(post, date) {
        this.post = post;
        this.date = date;
        this.type = Publish.Type;
    }
}
exports.Publish = Publish;
Publish.Type = "Publish";
class Comment {
    constructor(post, author, text, createdAt) {
        this.post = post;
        this.author = author;
        this.text = text;
        this.createdAt = createdAt;
        this.type = Comment.Type;
    }
}
exports.Comment = Comment;
Comment.Type = "Comment";
class CommentApproved {
    constructor(comment, approvedAt) {
        this.comment = comment;
        this.approvedAt = approvedAt;
        this.type = CommentApproved.Type;
    }
}
exports.CommentApproved = CommentApproved;
CommentApproved.Type = "CommentApproved";
exports.model = (0, _src_1.buildModel)(b => b
    .type(_src_1.User)
    .type(Blog, x => x
    .predecessor("creator", _src_1.User))
    .type(Post, x => x
    .predecessor("blog", Blog)
    .predecessor("author", _src_1.User))
    .type(Publish, x => x
    .predecessor("post", Post))
    .type(Comment, x => x
    .predecessor("post", Post)
    .predecessor("author", _src_1.User))
    .type(CommentApproved, x => x
    .predecessor("comment", Comment)));
const distribution = (r) => r
    // Everyone can see published posts
    .share(exports.model.given(Blog).match(blog => blog.successors(Post, post => post.blog)
    .exists(post => post.successors(Publish, publish => publish.post)))).withEveryone()
    // The creator can see all posts and comments
    .share(exports.model.given(Blog).select(blog => ({
    posts: blog.successors(Post, post => post.blog),
    comments: blog.successors(Comment, comment => comment.post.blog)
}))).with(exports.model.given(Blog).match(blog => blog.creator.predecessor()))
    // A comment author can see their own comments on published posts
    .share(exports.model.given(Blog, _src_1.User).match((blog, author) => blog.successors(Post, post => post.blog)
    .exists(post => post.successors(Publish, publish => publish.post))
    .selectMany(post => post.successors(Comment, comment => comment.post)
    .join(comment => comment.author, author)))).with(exports.model.given(Blog, _src_1.User).select((blog, author) => author));
exports.distribution = distribution;
//# sourceMappingURL=blogModel.js.map