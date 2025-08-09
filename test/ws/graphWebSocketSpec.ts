import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
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
  const sockets: Set<WebSocket> = new Set();

  beforeAll(async () => {
    wss = new WebSocketServer({ port: 0 });
    wss.on('connection', (socket) => sockets.add(socket));
    await new Promise<void>(resolve => wss.once('listening', () => resolve()));
  });

  afterAll(async () => {
    // Close all connected sockets then the server
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
    await new Promise<void>(resolve => wss.close(() => resolve()));
  });

  test('streams graph facts and advances bookmark via BOOK', async () => {
    const address = wss.address();
    const port = typeof address === 'string' ? parseInt(address.split(':').pop() || '0', 10) : (address as any).port;
    const wsUrl = `ws://127.0.0.1:${port}`;

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

    const httpStub: any = createHttpStub();
    const network = new WsGraphNetwork(httpStub, store, wsUrl);

    // Server: upon client connect, attach AuthorizationWebSocketHandler that serves initial feed
    wss.once('connection', (socket) => {
      const serverStore = new MemoryStore();
      const observable = new ObservableSource(serverStore);
      const engine = new InverseSpecificationEngine(
        observable.addSpecificationListener.bind(observable),
        observable.removeSpecificationListener.bind(observable)
      );
      const bookmarks = new BookmarkManager();
      const authStub = {
        async feed(_user: any, _spec: Specification, _start: FactReference[], _bookmark: string) {
          return { tuples: [{ facts: [envelope.fact], bookmark: 't1' }], bookmark: 'b1' };
        },
        async load(_user: any, refs: FactReference[]) {
          return refs.length ? [envelope] : [];
        }
      };
      const resolveFeed = (_: string): Specification => ({ given: [{ name: 'g', type: 'Test.Fact' }], matches: [], projection: { type: 'composite', components: [] } });
      const handler = new AuthorizationWebSocketHandler(authStub as any, resolveFeed, engine, bookmarks);
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