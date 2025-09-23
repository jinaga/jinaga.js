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
// Define a fake Fork implementation that captures saved facts
class FakeFork {
    constructor() {
        this.savedEnvelopes = [];
    }
    save(envelopes) {
        return __awaiter(this, void 0, void 0, function* () {
            this.savedEnvelopes = this.savedEnvelopes.concat(envelopes);
            return Promise.resolve();
        });
    }
    load(references) {
        return __awaiter(this, void 0, void 0, function* () {
            return Promise.resolve([]);
        });
    }
    processQueueNow() {
        return __awaiter(this, void 0, void 0, function* () {
            return Promise.resolve();
        });
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            return Promise.resolve();
        });
    }
}
// Define an Environment fact type that will be owned by the single-use principal
class Environment {
    constructor(creator, identifier) {
        this.creator = creator;
        this.identifier = identifier;
        this.type = Environment.Type;
    }
}
Environment.Type = "Enterprise.Environment";
describe('SingleUse with FakeFork', () => {
    it('should create single-use principal', () => __awaiter(void 0, void 0, void 0, function* () {
        // Arrange
        const store = new _src_1.MemoryStore();
        const fakeFork = new FakeFork();
        const observableSource = new _src_1.ObservableSource(store);
        const authentication = new _src_1.AuthenticationTest(store, null, null, null);
        const factManager = new _src_1.FactManager(fakeFork, observableSource, store, {
            feeds: () => __awaiter(void 0, void 0, void 0, function* () { return []; }),
            fetchFeed: () => __awaiter(void 0, void 0, void 0, function* () { return ({ references: [], bookmark: '' }); }),
            streamFeed: () => () => { },
            load: () => __awaiter(void 0, void 0, void 0, function* () { return []; })
        }, []);
        const j = new _src_1.Jinaga(authentication, factManager, null);
        // Act
        yield j.singleUse((principal) => __awaiter(void 0, void 0, void 0, function* () {
            // Assert
            expect(principal).toBeDefined();
            expect(principal.type).toBe('Jinaga.User');
            expect(principal.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
            return 0;
        }));
    }));
    it('should sign facts created by single-use principal', () => __awaiter(void 0, void 0, void 0, function* () {
        // Arrange
        const store = new _src_1.MemoryStore();
        const fakeFork = new FakeFork();
        const observableSource = new _src_1.ObservableSource(store);
        const authentication = new _src_1.AuthenticationTest(store, null, null, null);
        const factManager = new _src_1.FactManager(fakeFork, observableSource, store, {
            feeds: () => __awaiter(void 0, void 0, void 0, function* () { return []; }),
            fetchFeed: () => __awaiter(void 0, void 0, void 0, function* () { return ({ references: [], bookmark: '' }); }),
            streamFeed: () => () => { },
            load: () => __awaiter(void 0, void 0, void 0, function* () { return []; })
        }, []);
        const j = new _src_1.Jinaga(authentication, factManager, null);
        // Act
        const publicKey = yield j.singleUse((principal) => __awaiter(void 0, void 0, void 0, function* () {
            yield j.fact(new Environment(principal, "Production"));
            return principal.publicKey;
        }));
        // Assert
        // Find the Environment fact in the saved envelopes
        const environmentFact = fakeFork.savedEnvelopes
            .filter(envelope => envelope.fact.type === "Enterprise.Environment")
            .map(envelope => envelope.fact);
        expect(environmentFact.length).toBe(1);
        // Find the signature for the Environment fact
        const environmentSignature = fakeFork.savedEnvelopes
            .filter(envelope => envelope.fact.type === "Enterprise.Environment")
            .flatMap(envelope => envelope.signatures);
        expect(environmentSignature.length).toBe(1);
        // Verify the signature uses the principal's public key
        expect(environmentSignature[0].publicKey).toBe(publicKey);
    }));
});
//# sourceMappingURL=singleUseForkSpec.js.map