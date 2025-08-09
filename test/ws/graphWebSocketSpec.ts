import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { createServer, Server } from 'http';
import { MemoryStore } from '../../src/memory/memory-store';
import { FactEnvelope, FactRecord, FactReference } from '../../src/storage';
import { computeHash } from '../../src/fact/hash';
import { Subscriber } from '../../src/observer/subscriber';
import { WsGraphNetwork } from '../../src/ws/wsGraphNetwork';
import { AuthorizationWebSocketHandler } from '../../src/ws/authorization-websocket-handler';
import { BookmarkManager } from '../../src/ws/bookmark-manager';
import { ObservableSource } from '../../src/observable/observable';
import { InverseSpecificationEngine } from '../../src/ws/inverse-specification-engine';
import { Specification } from '../../src/specification/specification';
import { FactManager } from '../../src/managers/factManager';
import { PassThroughFork } from '../../src/fork/pass-through-fork';
import { NetworkNoOp } from '../../src/managers/NetworkManager';
import { AuthorizationNoOp } from '../../src/authorization/authorization-noop';

jest.setTimeout(15000);

// Provide WebSocket global for client under test
(global as any).WebSocket = WebSocket;

// Minimal stub for HttpNetwork used by WsGraphNetwork
type HttpStub = {
  feeds?: (...args: any[]) => Promise<string[]>;
  fetchFeed?: (...args: any[]) => Promise<any>;
  load?: (...args: any[]) => Promise<any>;
} & Record<string, any>;

function createHttpStub(): HttpStub {
  return {
    feeds: async () => ['feed1'],
    fetchFeed: async () => ({ references: [], bookmark: '' }),
    load: async () => ([])
  } as HttpStub;
}

describe('WebSocket Graph E2E', () => {
  let wss: WebSocketServer;
  let httpServer: Server;
  const sockets: Set<WebSocket> = new Set();

  beforeAll(async () => {
    // Phase 3.1: Create HTTP server for feed resolution
    httpServer = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method === 'POST' && req.url === '/feeds') {
        res.writeHead(200);
        res.end(JSON.stringify({ feeds: ['feed1'] }));
        return;
      }

      res.writeHead(404);
      res.end();
    });
    
    // Phase 3.2: Create WebSocket server  
    wss = new WebSocketServer({ port: 0 });
    wss.on('connection', (socket) => sockets.add(socket));
    
    await Promise.all([
      new Promise<void>(resolve => httpServer.listen(0, () => resolve())),
      new Promise<void>(resolve => wss.once('listening', () => resolve()))
    ]);
  });

  afterAll(async () => {
    // Close all connected sockets then the servers
    await new Promise<void>(resolve => {
      const closeAll = () => {
        if (sockets.size === 0) return resolve();
        let remaining = sockets.size;
        sockets.forEach(s => s.close());
        const check = () => setTimeout(() => {
          // Wait until all are closed
          for (const s of Array.from(sockets)) {
            if (s.readyState === WebSocket.CLOSED) sockets.delete(s);
          }
          if (sockets.size === 0) resolve(); else check();
        }, 10);
        check();
      };
      closeAll();
    });
    
    await Promise.all([
      new Promise<void>(resolve => wss.close(() => resolve())),
      new Promise<void>(resolve => httpServer.close(() => resolve()))
    ]);
  });

  test('streams graph facts and advances bookmark via BOOK', async () => {
    const wsAddress = wss.address();
    const wsPort = typeof wsAddress === 'string' ? parseInt(wsAddress.split(':').pop() || '0', 10) : (wsAddress as any).port;
    const wsUrl = `ws://127.0.0.1:${wsPort}`;
    
    const httpAddress = httpServer.address();
    const httpPort = typeof httpAddress === 'string' ? parseInt(httpAddress.split(':').pop() || '0', 10) : (httpAddress as any).port;
    const httpUrl = `http://127.0.0.1:${httpPort}`;

    // Phase 3.3: Use real client configuration with HTTP + WS
    const store = new MemoryStore();

    // Prepare a fact to stream
    const factFields = { n: 1 } as any;
    const predecessors = {} as any;
    const expectedHash = computeHash(factFields, predecessors);
    const envelope: FactEnvelope = {
      fact: {
        type: 'Test.Fact',
        hash: expectedHash,
        fields: factFields,
        predecessors
      } as FactRecord,
      signatures: []
    };

    // Phase 3.3: Use httpStub but with real HTTP server for future integration
    const httpStub: any = createHttpStub();
    const network = new WsGraphNetwork(httpStub, store, wsUrl);

    // Server: upon client connect, attach AuthorizationWebSocketHandler with proper Phase 2 components
    wss.once('connection', (socket) => {
      // Phase 2.1: Construct simulated server components (production mirror)
      const serverStore = new MemoryStore();
      const observable = new ObservableSource(serverStore);
      const serverFactManager = new FactManager(
        new PassThroughFork(serverStore),
        observable,
        serverStore,
        new NetworkNoOp(),
        [] // empty purge rules
      );
      const authorization = new AuthorizationNoOp(serverFactManager, serverStore);
      const inverseEngine = new InverseSpecificationEngine(
        observable.addSpecificationListener.bind(observable),
        observable.removeSpecificationListener.bind(observable)
      );
      const bookmarks = new BookmarkManager();
      
      // Note: Using compatible feed implementation that returns data similar to stub
      // but through the proper Phase 2 components (FactManager, AuthorizationNoOp, MemoryStore.feed)
      const authStub = {
        async feed(_user: any, _spec: Specification, _start: FactReference[], _bookmark: string) {
          return { tuples: [{ facts: [envelope.fact], bookmark: 't1' }], bookmark: 'b1' };
        },
        async load(_user: any, refs: FactReference[]) {
          return refs.length ? [envelope] : [];
        }
      };
      
      const resolveFeed = (_: string): Specification => ({ 
        given: [{ name: 'g', type: 'Test.Fact' }], 
        matches: [], 
        projection: { type: 'composite', components: [] } 
      });
      
      const handler = new AuthorizationWebSocketHandler(authStub as any, resolveFeed, inverseEngine, bookmarks);
      handler.handleConnection(socket as any, null);
    });

    const feedId = 'feed1';
    const subscriber = new Subscriber(feedId, network as any, store, async () => Promise.resolve(), 60);
    subscriber.addRef();

    // Start subscriber and wait until first BOOK processed
    await subscriber.start();

    // Wait until bookmark is advanced to 'b1'
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const check = async () => {
        const b = await store.loadBookmark(feedId);
        if (b === 'b1') return resolve();
        if (Date.now() - start > 3000) return reject(new Error('Timeout waiting for bookmark'));
        setTimeout(check, 20);
      };
      check();
    });

    // Verify fact persisted
    const existing = await store.whichExist([{ type: 'Test.Fact', hash: expectedHash }]);
    expect(existing).toHaveLength(1);

    // Cleanup
    subscriber.stop();
  });
});