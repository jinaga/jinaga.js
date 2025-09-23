"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
const blogModel_1 = require("../blogModel");
describe("distribution rules", () => {
    _src_1.Trace.off();
    const creator = new _src_1.User("creator");
    const reader = new _src_1.User("reader");
    const commenter = new _src_1.User("commenter");
    const blog = new blogModel_1.Blog(creator, "domain");
    const post = new blogModel_1.Post(blog, creator, new Date());
    const comment = new blogModel_1.Comment(post, commenter, "text", new Date());
    it("should prevent public access to unpublished posts", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Post)
            .join(post => post.blog, blog));
        const j = givenLoggedIn(undefined);
        yield expect(() => j.query(specification, blog)).rejects.toThrow("Not authorized");
    }));
    it("should permit public access to publications", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Publish)
            .join(publish => publish.post.blog, blog));
        const j = givenLoggedIn(undefined);
        const result = yield j.query(specification, blog);
        expect(result).toHaveLength(0);
    }));
    it("should permit public access to published posts", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Post)
            .join(post => post.blog, blog)
            .exists(post => facts.ofType(blogModel_1.Publish)
            .join(publish => publish.post, post)));
        const j = givenLoggedIn(undefined);
        const result = yield j.query(specification, blog);
        expect(result).toHaveLength(0);
    }));
    it("should permit the creator to access all posts", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Post)
            .join(post => post.blog, blog));
        const j = givenLoggedIn(creator);
        const result = yield j.query(specification, blog);
        expect(result).toHaveLength(1);
    }));
    it("should not permit a reader to access all posts", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Post)
            .join(post => post.blog, blog));
        const j = givenLoggedIn(reader);
        yield expect(() => j.query(specification, blog)).rejects.toThrow("Not authorized");
    }));
    it("should permit reader to access publications", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Publish)
            .join(publish => publish.post.blog, blog));
        const j = givenLoggedIn(reader);
        const result = yield j.query(specification, blog);
        expect(result).toHaveLength(0);
    }));
    it("should permit reader to access published posts", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Post)
            .join(post => post.blog, blog)
            .exists(post => facts.ofType(blogModel_1.Publish)
            .join(publish => publish.post, post)));
        const j = givenLoggedIn(reader);
        const result = yield j.query(specification, blog);
        expect(result).toHaveLength(0);
    }));
    it("should permit creator to access all comments", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Comment)
            .join(comment => comment.post.blog, blog));
        const j = givenLoggedIn(creator);
        const result = yield j.query(specification, blog);
        expect(result).toHaveLength(1);
    }));
    it(("should not permit public access to comments"), () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Comment)
            .join(comment => comment.post.blog, blog));
        const j = givenLoggedIn(undefined);
        yield expect(() => j.query(specification, blog)).rejects.toThrow("Not authorized");
    }));
    it("should not permit reader to access all comments", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Comment)
            .join(comment => comment.post.blog, blog));
        const j = givenLoggedIn(reader);
        yield expect(() => j.query(specification, blog)).rejects.toThrow("Not authorized");
    }));
    it("should not permit commenter to access all comments", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Comment)
            .join(comment => comment.post.blog, blog));
        const j = givenLoggedIn(commenter);
        yield expect(() => j.query(specification, blog)).rejects.toThrow("Not authorized");
    }));
    it("should permit commenter to access their own comments", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog, _src_1.User).match((blog, commenter, facts) => facts.ofType(blogModel_1.Post)
            .join(post => post.blog, blog)
            .exists(post => facts.ofType(blogModel_1.Publish)
            .join(publish => publish.post, post))
            .selectMany(post => facts.ofType(blogModel_1.Comment)
            .join(comment => comment.post, post)
            .join(comment => comment.author, commenter)));
        const j = givenLoggedIn(commenter);
        const result = yield j.query(specification, blog, commenter);
        expect(result).toHaveLength(0);
    }));
    it("should not permit reader to access someone else's comments", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog, _src_1.User).match((blog, commenter, facts) => facts.ofType(blogModel_1.Comment)
            .join(comment => comment.post.blog, blog)
            .join(comment => comment.author, commenter));
        const j = givenLoggedIn(reader);
        yield expect(() => j.query(specification, blog, commenter)).rejects.toThrow("Not authorized");
    }));
    it("should permit access to published blogs and my own comments", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(_src_1.User, blogModel_1.Blog).match((user, blog, facts) => facts.ofType(blogModel_1.Post)
            .join(post => post.blog, blog)
            .exists(post => facts.ofType(blogModel_1.Publish)
            .join(publish => publish.post, post))
            .select(post => ({
            post,
            comments: facts.ofType(blogModel_1.Comment)
                .join(comment => comment.post, post)
                .join(comment => comment.author, user)
        })));
        const j = givenLoggedIn(commenter);
        const result = yield j.query(specification, commenter, blog);
        expect(result).toHaveLength(0);
    }));
    function givenLoggedIn(user) {
        return _src_1.JinagaTest.create({
            model: blogModel_1.model,
            user,
            initialState: [
                creator,
                reader,
                commenter,
                blog,
                post,
                comment
            ],
            distribution: blogModel_1.distribution
        });
    }
});
//# sourceMappingURL=distributionRuleSpec.js.map