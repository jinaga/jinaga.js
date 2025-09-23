import { DistributionRules, User } from "@src";
export declare class Blog {
    creator: User;
    domain: string;
    static Type: "Blog";
    type: "Blog";
    constructor(creator: User, domain: string);
}
export declare class Post {
    blog: Blog;
    author: User;
    createdAt: Date | string;
    static Type: "Post";
    type: "Post";
    constructor(blog: Blog, author: User, createdAt: Date | string);
}
export declare class Publish {
    post: Post;
    date: Date | string;
    static Type: "Publish";
    type: "Publish";
    constructor(post: Post, date: Date | string);
}
export declare class Comment {
    post: Post;
    author: User;
    text: string;
    createdAt: Date | string;
    static Type: "Comment";
    type: "Comment";
    constructor(post: Post, author: User, text: string, createdAt: Date | string);
}
export declare class CommentApproved {
    comment: Comment;
    approvedAt: Date | string;
    static Type: "CommentApproved";
    type: "CommentApproved";
    constructor(comment: Comment, approvedAt: Date | string);
}
export declare const model: import("@src").Model;
export declare const distribution: (r: DistributionRules) => DistributionRules;
//# sourceMappingURL=blogModel.d.ts.map