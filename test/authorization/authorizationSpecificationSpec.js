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
describe("Feedback authorization from specification", () => {
    describe("as a user", () => {
        let j;
        let site;
        let content;
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            site = new Site(new User("Site creator"), "site identifier");
            content = new Content(site, "/path/to/content");
            j = _src_1.JinagaTest.create({
                model,
                authorization,
                user: new User("Logged in user"),
                initialState: [
                    site,
                    content
                ]
            });
        }));
        it("should allow a user", () => __awaiter(void 0, void 0, void 0, function* () {
            const creator = yield j.fact(new User("Other user"));
            expect(creator.publicKey).toEqual("Other user");
        }));
        it("should not allow site created by a different user", () => __awaiter(void 0, void 0, void 0, function* () {
            const creator = yield j.fact(new User("Other user"));
            const promise = j.fact(new Site(creator, "site identifier"));
            yield expect(promise).rejects.not.toBeNull();
        }));
        it("should allow a site created by the logged in user", () => __awaiter(void 0, void 0, void 0, function* () {
            const creator = yield j.fact(new User("Logged in user"));
            const site = yield j.fact(new Site(creator, "site identifier"));
            expect(site.creator.publicKey).toEqual("Logged in user");
        }));
        it("should not allow a comment from another user", () => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield j.fact(new User("Another user"));
            const promise = j.fact(new Comment("comment unique id", content, user));
            yield expect(promise).rejects.not.toBeNull();
        }));
        it("should allow a comment from logged in user", () => __awaiter(void 0, void 0, void 0, function* () {
            const { userFact: user } = yield j.login();
            const comment = yield j.fact(new Comment("comment unique id", content, user));
            expect(comment.author.publicKey).toEqual(user.publicKey);
        }));
        it("should not allow a post from another user", () => __awaiter(void 0, void 0, void 0, function* () {
            const promise = j.fact(new Content(site, "/path/to/new/content"));
            yield expect(promise).rejects.not.toBeNull();
        }));
        it("should not allow user to invite themselves", () => __awaiter(void 0, void 0, void 0, function* () {
            const { userFact: self } = yield j.login();
            const promise = j.fact(new GuestBlogger(site, self));
            yield expect(promise).rejects.not.toBeNull();
        }));
    });
    describe("as a site creator", () => {
        let j;
        let site;
        let content;
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            const siteCreator = new User("Site creator");
            site = new Site(siteCreator, "site identifier");
            content = new Content(site, "/path/to/content");
            j = _src_1.JinagaTest.create({
                model,
                authorization,
                user: siteCreator,
                initialState: [
                    site,
                    content
                ]
            });
        }));
        it("should allow a post from the site creator", () => __awaiter(void 0, void 0, void 0, function* () {
            const newContent = yield j.fact(new Content(site, "/path/to/new/content"));
            expect(j.hash(newContent.site)).toEqual(j.hash(site));
        }));
        it("should allow an invitation to a guest blogger", () => __awaiter(void 0, void 0, void 0, function* () {
            const guest = yield j.fact(new User("Guest blogger"));
            const guestBlogger = yield j.fact(new GuestBlogger(site, guest));
            expect(j.hash(guestBlogger.site)).toEqual(j.hash(site));
            expect(j.hash(guestBlogger.guest)).toEqual(j.hash(guest));
        }));
    });
    describe("as a guest blogger", () => {
        let j;
        let site;
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            const siteCreator = new User("Site creator");
            site = new Site(siteCreator, "site identifier");
            const guestUser = new User("Guest user");
            const guestBlogger = new GuestBlogger(site, guestUser);
            j = _src_1.JinagaTest.create({
                model,
                authorization,
                user: guestUser,
                initialState: [
                    site,
                    guestBlogger
                ]
            });
        }));
        it("should allow a post from the guest blogger", () => __awaiter(void 0, void 0, void 0, function* () {
            const newContent = yield j.fact(new Content(site, "/path/to/new/content"));
            expect(j.hash(newContent.site)).toEqual(j.hash(site));
        }));
    });
});
describe("Authorization rules description", () => {
    it("should be able to save authorization rules", () => {
        const description = (0, _src_1.describeAuthorizationRules)(model, authorization);
        expect(description).not.toBeNull();
    });
    it("should be able to load authorization rules", () => {
        const description = (0, _src_1.describeAuthorizationRules)(model, authorization);
        const loaded = _src_1.AuthorizationRules.loadFromDescription(description);
        expect(loaded.hasRule(Content.Type)).toBeTruthy();
    });
});
class User {
    constructor(publicKey) {
        this.publicKey = publicKey;
        this.type = User.Type;
    }
}
User.Type = "Jinaga.User";
class Site {
    constructor(creator, identifier) {
        this.creator = creator;
        this.identifier = identifier;
        this.type = Site.Type;
    }
}
Site.Type = "Feedback.Site";
class GuestBlogger {
    constructor(site, guest) {
        this.site = site;
        this.guest = guest;
        this.type = GuestBlogger.Type;
    }
}
GuestBlogger.Type = "Feedback.GuestBlogger";
class Content {
    constructor(site, path) {
        this.site = site;
        this.path = path;
        this.type = Content.Type;
    }
}
Content.Type = "Feedback.Content";
class Comment {
    constructor(uniqueId, content, author) {
        this.uniqueId = uniqueId;
        this.content = content;
        this.author = author;
        this.type = Comment.Type;
    }
}
Comment.Type = "Feedback.Comment";
const model = (0, _src_1.buildModel)(b => b
    .type(User)
    .type(Site, f => f
    .predecessor("creator", User))
    .type(GuestBlogger, f => f
    .predecessor("site", Site)
    .predecessor("guest", User))
    .type(Content, f => f
    .predecessor("site", Site))
    .type(Comment, f => f
    .predecessor("content", Content)
    .predecessor("author", User)));
function authorization(a) {
    return a
        .any(User)
        .type(Site, site => site.creator)
        .type(GuestBlogger, guestBlogger => guestBlogger.site.creator)
        .type(Content, content => content.site.creator)
        .type(Content, content => content.site.successors(GuestBlogger, guestBlogger => guestBlogger.site)
        .selectMany(guestBlogger => guestBlogger.guest.predecessor()))
        .type(Comment, comment => comment.author);
}
//# sourceMappingURL=authorizationSpecificationSpec.js.map