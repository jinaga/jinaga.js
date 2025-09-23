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
// Define a test fact type that will be owned by the single-use principal
class TestFact {
    constructor(owner, value) {
        this.owner = owner;
        this.value = value;
        this.type = TestFact.Type;
    }
}
TestFact.Type = "TestFact";
describe('SingleUse with Store', () => {
    it('should create and sign facts with a single-use principal', () => __awaiter(void 0, void 0, void 0, function* () {
        // Arrange
        const store = new _src_1.MemoryStore();
        const fork = new _src_1.PassThroughFork(store);
        const observableSource = new _src_1.ObservableSource(store);
        const authentication = new _src_1.AuthenticationTest(store, null, null, null);
        const factManager = new _src_1.FactManager(fork, observableSource, store, {
            feeds: () => __awaiter(void 0, void 0, void 0, function* () { return []; }),
            fetchFeed: () => __awaiter(void 0, void 0, void 0, function* () { return ({ references: [], bookmark: '' }); }),
            streamFeed: () => () => { },
            load: () => __awaiter(void 0, void 0, void 0, function* () { return []; })
        }, []);
        const j = new _src_1.Jinaga(authentication, factManager, null);
        // Act
        const result = yield j.singleUse((principal) => __awaiter(void 0, void 0, void 0, function* () {
            // Create a fact owned by the principal
            const fact = yield j.fact(new TestFact(principal, 'test value'));
            return fact;
        }));
        // Assert
        expect(result).toBeDefined();
        expect(result.type).toBe('TestFact');
        expect(result.owner.type).toBe('Jinaga.User');
        expect(result.owner.publicKey).toBeDefined();
        expect(result.value).toBe('test value');
        // Verify that the fact was saved to the store
        const facts = yield store.load([{
                type: 'TestFact',
                hash: _src_1.Jinaga.hash(result)
            }]);
        // Find the TestFact in the returned facts
        const testFact = facts.find(f => f.fact.type === 'TestFact');
        expect(testFact).toBeDefined();
        expect(testFact.fact.fields.value).toBe('test value');
        // Verify that the fact has a signature
        expect(testFact.signatures.length).toBeGreaterThan(0);
        // Verify that the user fact was saved to the store
        const userFacts = yield store.load([{
                type: 'Jinaga.User',
                hash: _src_1.Jinaga.hash(result.owner)
            }]);
        expect(userFacts.length).toBe(1);
        expect(userFacts[0].fact.type).toBe('Jinaga.User');
        expect(userFacts[0].fact.fields.publicKey).toBeDefined();
        // Verify that the user fact has a signature
        expect(userFacts[0].signatures.length).toBeGreaterThan(0);
    }));
});
//# sourceMappingURL=singleUseStoreSpec.js.map