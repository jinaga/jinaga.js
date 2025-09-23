"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
const ws_1 = __importStar(require("ws"));
jest.setTimeout(15000);
describe('AuthorizationWebSocketHandler', () => {
    let wss;
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        wss = new ws_1.WebSocketServer({ port: 0 });
        yield new Promise(resolve => wss.once('listening', () => resolve()));
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield new Promise(resolve => wss.close(() => resolve()));
    }));
    test('sends BOOK sync on SUB when server has newer bookmark', () => __awaiter(void 0, void 0, void 0, function* () {
        const address = wss.address();
        const port = typeof address === 'string' ? parseInt(address.split(':').pop() || '0', 10) : address.port;
        const wsUrl = `ws://127.0.0.1:${port}`;
        const bookmarks = new _src_1.BookmarkManager();
        bookmarks.setBookmark('feed1', 'serverB');
        const authStub = {
            feed() {
                return __awaiter(this, void 0, void 0, function* () { return { tuples: [], bookmark: '' }; });
            },
            load() {
                return __awaiter(this, void 0, void 0, function* () { return []; });
            }
        };
        const store = new _src_1.MemoryStore();
        const observable = new _src_1.ObservableSource(store);
        const engine = new _src_1.InverseSpecificationEngine(observable.addSpecificationListener.bind(observable), observable.removeSpecificationListener.bind(observable));
        const resolveFeed = (_) => ({ given: [{ label: { name: 'g', type: 'T' }, conditions: [] }], matches: [], projection: { type: 'composite', components: [] } });
        wss.once('connection', (socket) => {
            const handler = new _src_1.AuthorizationWebSocketHandler(authStub, resolveFeed, engine, bookmarks);
            handler.handleConnection(socket, null);
        });
        const client = new ws_1.default(wsUrl);
        const received = [];
        client.on('message', (d) => received.push(typeof d === 'string' ? d : String(d)));
        yield new Promise(resolve => client.once('open', () => resolve()));
        // Send SUB with an outdated bookmark (single framed message)
        client.send(`SUB\n${JSON.stringify('feed1')}\n${JSON.stringify('clientOld')}\n\n`);
        // Wait for BOOK sync
        yield waitFor(() => received.some(m => m.startsWith('BOOK\n') && m.includes('"feed1"') && m.includes('"serverB"')));
        yield new Promise(resolve => {
            client.once('close', () => resolve());
            client.close();
        });
    }));
    test('streams graph on inverse add (via ObservableSource) and sends BOOK', () => __awaiter(void 0, void 0, void 0, function* () {
        const address = wss.address();
        const port = typeof address === 'string' ? parseInt(address.split(':').pop() || '0', 10) : address.port;
        const wsUrl = `ws://127.0.0.1:${port}`;
        const bookmarks = new _src_1.BookmarkManager();
        const factRef = { type: 'Test.Fact', hash: 'h123' };
        const fact = { type: 'Test.Fact', hash: 'h123', predecessors: {}, fields: { n: 1 } };
        const envelope = { fact, signatures: [] };
        const store = new _src_1.MemoryStore();
        const observable = new _src_1.ObservableSource(store);
        const engine = new _src_1.InverseSpecificationEngine(observable.addSpecificationListener.bind(observable), observable.removeSpecificationListener.bind(observable));
        const authStub = {
            feed() {
                return __awaiter(this, void 0, void 0, function* () { return { tuples: [], bookmark: '' }; });
            },
            load(_id, refs) {
                return __awaiter(this, void 0, void 0, function* () { return refs.length ? [envelope] : []; });
            }
        };
        const resolveFeed = (_) => ({ given: [{ label: { name: 'g', type: 'Test.Fact' }, conditions: [] }], matches: [], projection: { type: 'composite', components: [] } });
        wss.once('connection', (socket) => {
            const handler = new _src_1.AuthorizationWebSocketHandler(authStub, resolveFeed, engine, bookmarks);
            handler.handleConnection(socket, null);
        });
        const client = new ws_1.default(wsUrl);
        const received = [];
        client.on('message', (d) => received.push(typeof d === 'string' ? d : String(d)));
        yield new Promise(resolve => client.once('open', () => resolve()));
        // Subscribe (single framed message) where given type matches our fact
        client.send(`SUB\n${JSON.stringify('feed2')}\n${JSON.stringify('')}\n\n`);
        // Allow time for inverse listeners to register
        yield new Promise(resolve => setTimeout(resolve, 50));
        // Simulate a new fact saved that matches the inverse given
        yield store.save([envelope]);
        yield observable.notify([envelope]);
        // Expect a BOOK frame indicating reactive update processed
        yield waitFor(() => received.some(m => m.startsWith('BOOK\n') && m.includes('"feed2"')));
        yield new Promise(resolve => {
            client.once('close', () => resolve());
            client.close();
        });
    }));
    test('denies SUB when distribution rules fail and emits ERR', () => __awaiter(void 0, void 0, void 0, function* () {
        const address = wss.address();
        const port = typeof address === 'string' ? parseInt(address.split(':').pop() || '0', 10) : address.port;
        const wsUrl = `ws://127.0.0.1:${port}`;
        const bookmarks = new _src_1.BookmarkManager();
        const authStub = {
            feed() {
                return __awaiter(this, void 0, void 0, function* () { return { tuples: [], bookmark: '' }; });
            },
            load() {
                return __awaiter(this, void 0, void 0, function* () { return []; });
            },
            getOrCreateUserFact() {
                return __awaiter(this, void 0, void 0, function* () { return { type: 'User', hash: 'u1', predecessors: {}, fields: {} }; });
            }
        };
        const observable = new _src_1.ObservableSource(new _src_1.MemoryStore());
        const engine = new _src_1.InverseSpecificationEngine(observable.addSpecificationListener.bind(observable), observable.removeSpecificationListener.bind(observable));
        const denyDistributionEngine = {
            canDistributeToAll() {
                return __awaiter(this, void 0, void 0, function* () {
                    return { type: 'failure', reason: 'No rules apply' };
                });
            }
        };
        const feedSpec = { given: [{ label: { name: 'g', type: 'T' }, conditions: [] }], matches: [], projection: { type: 'composite', components: [] } };
        const resolveFeed = (_) => feedSpec;
        const resolveFeedInfo = (_) => ({ specification: feedSpec, namedStart: {} });
        wss.once('connection', (socket) => {
            const handler = new _src_1.AuthorizationWebSocketHandler(authStub, resolveFeed, engine, bookmarks, denyDistributionEngine, resolveFeedInfo);
            handler.handleConnection(socket, null);
        });
        const client = new ws_1.default(wsUrl);
        const received = [];
        client.on('message', (d) => received.push(typeof d === 'string' ? d : String(d)));
        yield new Promise(resolve => client.once('open', () => resolve()));
        client.send(`SUB\n${JSON.stringify('feedX')}\n${JSON.stringify('')}\n\n`);
        yield waitFor(() => received.some(m => m.startsWith('ERR\n') && m.includes('feedX') && m.includes('Not authorized')));
        yield new Promise(resolve => { client.once('close', () => resolve()); client.close(); });
    }));
    test('allows SUB when distribution rules pass', () => __awaiter(void 0, void 0, void 0, function* () {
        const address = wss.address();
        const port = typeof address === 'string' ? parseInt(address.split(':').pop() || '0', 10) : address.port;
        const wsUrl = `ws://127.0.0.1:${port}`;
        const bookmarks = new _src_1.BookmarkManager();
        const authStub = {
            feed() {
                return __awaiter(this, void 0, void 0, function* () { return { tuples: [], bookmark: '' }; });
            },
            load() {
                return __awaiter(this, void 0, void 0, function* () { return []; });
            },
            getOrCreateUserFact() {
                return __awaiter(this, void 0, void 0, function* () { return { type: 'User', hash: 'u1', predecessors: {}, fields: {} }; });
            }
        };
        const observable = new _src_1.ObservableSource(new _src_1.MemoryStore());
        const engine = new _src_1.InverseSpecificationEngine(observable.addSpecificationListener.bind(observable), observable.removeSpecificationListener.bind(observable));
        const allowDistributionEngine = {
            canDistributeToAll() {
                return __awaiter(this, void 0, void 0, function* () {
                    return { type: 'success' };
                });
            }
        };
        const feedSpec = { given: [{ label: { name: 'g', type: 'T' }, conditions: [] }], matches: [], projection: { type: 'composite', components: [] } };
        const resolveFeed = (_) => feedSpec;
        const resolveFeedInfo = (_) => ({ specification: feedSpec, namedStart: {} });
        wss.once('connection', (socket) => {
            const handler = new _src_1.AuthorizationWebSocketHandler(authStub, resolveFeed, engine, bookmarks, allowDistributionEngine, resolveFeedInfo);
            handler.handleConnection(socket, null);
        });
        const client = new ws_1.default(wsUrl);
        const received = [];
        client.on('message', (d) => received.push(typeof d === 'string' ? d : String(d)));
        yield new Promise(resolve => client.once('open', () => resolve()));
        client.send(`SUB\n${JSON.stringify('feedY')}\n${JSON.stringify('')}\n\n`);
        // Expect no ERR
        yield new Promise(resolve => setTimeout(resolve, 50));
        const hasErr = received.some(m => m.startsWith('ERR\n'));
        expect(hasErr).toBe(false);
        yield new Promise(resolve => { client.once('close', () => resolve()); client.close(); });
    }));
});
function waitFor(predicate, timeoutMs = 2000, intervalMs = 20) {
    return __awaiter(this, void 0, void 0, function* () {
        const start = Date.now();
        return new Promise((resolve, reject) => {
            const check = () => {
                if (predicate())
                    return resolve();
                if (Date.now() - start > timeoutMs)
                    return reject(new Error('Timeout'));
                setTimeout(check, intervalMs);
            };
            check();
        });
    });
}
//# sourceMappingURL=authorizationWebSocketHandlerSpec.js.map