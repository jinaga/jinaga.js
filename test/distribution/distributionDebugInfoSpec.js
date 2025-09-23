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
describe("distribution debug information", () => {
    _src_1.Trace.off();
    const creator = new _src_1.User("creator");
    const reader = new _src_1.User("reader");
    const blog = new blogModel_1.Blog(creator, "domain");
    const post = new blogModel_1.Post(blog, creator, new Date());
    it("should provide detailed failure information in test mode", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Post)
            .join(post => post.blog, blog));
        const j = _src_1.JinagaTest.create({
            model: blogModel_1.model,
            user: reader,
            initialState: [
                creator,
                reader,
                blog,
                post
            ],
            distribution: blogModel_1.distribution
        });
        try {
            yield j.query(specification, blog);
            fail("Expected query to throw 'Not authorized' error");
        }
        catch (error) {
            expect(error.message).toContain("Not authorized");
            expect(error.message).toContain("The user does not match");
            // Check for enhanced debug information that should be present in test mode
            expect(error.message).toContain("Expected hashes:");
            expect(error.message).toContain("User hash:");
            // Verify the user fact contains the reader's hash
            expect(error.message).toContain(j.hash(reader));
        }
    }));
    it("should include matching set information when available", () => __awaiter(void 0, void 0, void 0, function* () {
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Comment)
            .join(comment => comment.post.blog, blog));
        const comment = new blogModel_1.Comment(post, reader, "test comment", new Date());
        const j = _src_1.JinagaTest.create({
            model: blogModel_1.model,
            user: reader,
            initialState: [
                creator,
                reader,
                blog,
                post,
                comment
            ],
            distribution: blogModel_1.distribution
        });
        try {
            yield j.query(specification, blog);
            fail("Expected query to throw 'Not authorized' error");
        }
        catch (error) {
            expect(error.message).toContain("Not authorized");
            expect(error.message).toContain("The user does not match");
            // Verify that detailed debug information is present
            expect(error.message).toContain("Expected hashes:");
            expect(error.message).toContain("User hash:");
            // Verify the user fact contains the reader's information
            expect(error.message).toContain(j.hash(reader));
        }
    }));
});
//# sourceMappingURL=distributionDebugInfoSpec.js.map