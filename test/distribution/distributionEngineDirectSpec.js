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
describe("DistributionEngine direct usage", () => {
    const creator = new _src_1.User("creator");
    const reader = new _src_1.User("reader");
    const blog = new blogModel_1.Blog(creator, "domain");
    const post = new blogModel_1.Post(blog, creator, new Date());
    it("should provide detailed debug info when isTest=true", () => __awaiter(void 0, void 0, void 0, function* () {
        const store = new _src_1.MemoryStore();
        const distributionRules = (0, blogModel_1.distribution)(new _src_1.DistributionRules([]));
        // Create engine with isTest=true
        const engine = new _src_1.DistributionEngine(distributionRules, store, true);
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Post)
            .join(post => post.blog, blog)).specification;
        const namedStart = { "blog": (0, _src_1.dehydrateFact)(blog)[0] };
        const userFact = (0, _src_1.dehydrateFact)(reader)[0];
        const result = yield engine.canDistributeToAll([specification], namedStart, userFact);
        expect(result.type).toBe('failure');
        if (result.type === 'failure') {
            expect(result.reason).toContain("The user does not match");
            expect(result.reason).toContain("Expected hashes: []");
            expect(result.reason).toContain("User hash:");
        }
    }));
    it("should NOT provide detailed debug info when isTest=false", () => __awaiter(void 0, void 0, void 0, function* () {
        const store = new _src_1.MemoryStore();
        const distributionRules = (0, blogModel_1.distribution)(new _src_1.DistributionRules([]));
        // Create engine with isTest=false (default)
        const engine = new _src_1.DistributionEngine(distributionRules, store, false);
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Post)
            .join(post => post.blog, blog)).specification;
        const namedStart = { "blog": (0, _src_1.dehydrateFact)(blog)[0] };
        const userFact = (0, _src_1.dehydrateFact)(reader)[0];
        const result = yield engine.canDistributeToAll([specification], namedStart, userFact);
        expect(result.type).toBe('failure');
        if (result.type === 'failure') {
            expect(result.reason).toContain("The user does not match");
            expect(result.reason).not.toContain("Matching set:");
            expect(result.reason).not.toContain("User fact:");
        }
    }));
    it("should NOT provide detailed debug info when isTest is omitted (default behavior)", () => __awaiter(void 0, void 0, void 0, function* () {
        const store = new _src_1.MemoryStore();
        const distributionRules = (0, blogModel_1.distribution)(new _src_1.DistributionRules([]));
        // Create engine without isTest parameter (should default to false)
        const engine = new _src_1.DistributionEngine(distributionRules, store);
        const specification = blogModel_1.model.given(blogModel_1.Blog).match((blog, facts) => facts.ofType(blogModel_1.Post)
            .join(post => post.blog, blog)).specification;
        const namedStart = { "blog": (0, _src_1.dehydrateFact)(blog)[0] };
        const userFact = (0, _src_1.dehydrateFact)(reader)[0];
        const result = yield engine.canDistributeToAll([specification], namedStart, userFact);
        expect(result.type).toBe('failure');
        if (result.type === 'failure') {
            expect(result.reason).toContain("The user does not match");
            expect(result.reason).not.toContain("Expected hashes:");
            expect(result.reason).not.toContain("User hash:");
        }
    }));
});
//# sourceMappingURL=distributionEngineDirectSpec.js.map