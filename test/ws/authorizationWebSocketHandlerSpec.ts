import { AuthorizationWebSocketHandler, BookmarkManager, FactEnvelope, FactRecord, FactReference, InverseSpecificationEngine, MemoryStore, ObservableSource, Specification } from '@src';
import WebSocket, { WebSocketServer } from 'ws';

jest.setTimeout(15000);

describe('AuthorizationWebSocketHandler', () => {
  let wss: WebSocketServer;

  beforeAll(async () => {
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>(resolve => wss.once('listening', () => resolve()));
  });

  afterAll(async () => {
    await new Promise<void>(resolve => wss.close(() => resolve()));
  });

  test('sends BOOK sync on SUB when server has newer bookmark', async () => {
    const address = wss.address();
    const port = typeof address === 'string' ? parseInt(address.split(':').pop() || '0', 10) : (address as any).port;
    const wsUrl = `ws://127.0.0.1:${port}`;

    const bookmarks = new BookmarkManager();
    bookmarks.setBookmark('feed1', 'serverB');

    const authStub = {
      async feed() { return { tuples: [], bookmark: '' }; },
      async load() { return []; }
    } as any;

    const store = new MemoryStore();
    const observable = new ObservableSource(store);
    const engine = new InverseSpecificationEngine(
      observable.addSpecificationListener.bind(observable),
      observable.removeSpecificationListener.bind(observable)
    );

    const resolveFeed = (_: string): Specification => ({ given: [{ label: { name: 'g', type: 'T' }, conditions: [] }], matches: [], projection: { type: 'composite', components: [] } });

    wss.once('connection', (socket) => {
      const handler = new AuthorizationWebSocketHandler(authStub, resolveFeed, engine, bookmarks);
      handler.handleConnection(socket as any, null);
    });

    const client = new WebSocket(wsUrl);
    const received: string[] = [];
    client.on('message', (d) => received.push(typeof d === 'string' ? d : String(d)));

    await new Promise<void>(resolve => client.once('open', () => resolve()));

    // Send SUB with an outdated bookmark (single framed message)
    client.send(`SUB\n${JSON.stringify('feed1')}\n${JSON.stringify('clientOld')}\n\n`);

    // Wait for BOOK sync
    await waitFor(() => received.some(m => m.startsWith('BOOK\n') && m.includes('"feed1"') && m.includes('"serverB"')));

    await new Promise<void>(resolve => {
      client.once('close', () => resolve());
      client.close();
    });
  });

  test('streams graph on inverse add (via ObservableSource) and sends BOOK', async () => {
    const address = wss.address();
    const port = typeof address === 'string' ? parseInt(address.split(':').pop() || '0', 10) : (address as any).port;
    const wsUrl = `ws://127.0.0.1:${port}`;

    const bookmarks = new BookmarkManager();

    const factRef: FactReference = { type: 'Test.Fact', hash: 'h123' };
    const fact: FactRecord = { type: 'Test.Fact', hash: 'h123', predecessors: {}, fields: { n: 1 } };
    const envelope: FactEnvelope = { fact, signatures: [] };

    const store = new MemoryStore();
    const observable = new ObservableSource(store);
    const engine = new InverseSpecificationEngine(
      observable.addSpecificationListener.bind(observable),
      observable.removeSpecificationListener.bind(observable)
    );

    const authStub = {
      async feed() { return { tuples: [], bookmark: '' }; },
      async load(_id: any, refs: FactReference[]) { return refs.length ? [envelope] : []; }
    } as any;

    const resolveFeed = (_: string): Specification => ({ given: [{ label: { name: 'g', type: 'Test.Fact' }, conditions: [] }], matches: [], projection: { type: 'composite', components: [] } });

    wss.once('connection', (socket) => {
      const handler = new AuthorizationWebSocketHandler(authStub, resolveFeed, engine, bookmarks);
      handler.handleConnection(socket as any, null);
    });

    const client = new WebSocket(wsUrl);
    const received: string[] = [];
    client.on('message', (d) => received.push(typeof d === 'string' ? d : String(d)));
    await new Promise<void>(resolve => client.once('open', () => resolve()));

    // Subscribe (single framed message) where given type matches our fact
    client.send(`SUB\n${JSON.stringify('feed2')}\n${JSON.stringify('')}\n\n`);

    // Wait for ACK to confirm subscription is active
    await waitFor(() => received.some(m => m.startsWith('ACK\n') && m.includes('"feed2"')));

    // Simulate a new fact saved that matches the inverse given
    await store.save([envelope]);
    await observable.notify([envelope]);

    // Expect a BOOK frame indicating reactive update processed
    await waitFor(() => received.some(m => m.startsWith('BOOK\n') && m.includes('"feed2"')));

    await new Promise<void>(resolve => {
      client.once('close', () => resolve());
      client.close();
    });
  });

  test('denies SUB when distribution rules fail and emits ERR', async () => {
    const address = wss.address();
    const port = typeof address === 'string' ? parseInt(address.split(':').pop() || '0', 10) : (address as any).port;
    const wsUrl = `ws://127.0.0.1:${port}`;

    const bookmarks = new BookmarkManager();

    const authStub = {
      async feed() { return { tuples: [], bookmark: '' }; },
      async load() { return []; },
      async getOrCreateUserFact() { return { type: 'User', hash: 'u1', predecessors: {}, fields: {} }; }
    } as any;

    const observable = new ObservableSource(new MemoryStore());
    const engine = new InverseSpecificationEngine(
      observable.addSpecificationListener.bind(observable),
      observable.removeSpecificationListener.bind(observable)
    );

    const denyDistributionEngine = {
      async canDistributeToAll() {
        return { type: 'failure', reason: 'No rules apply' } as const;
      }
    } as any;

    const feedSpec: Specification = { given: [{ label: { name: 'g', type: 'T' }, conditions: [] }], matches: [], projection: { type: 'composite', components: [] } };
    const resolveFeed = (_: string): Specification => feedSpec;
    const resolveFeedInfo = (_: string) => ({ specification: feedSpec, namedStart: {} as any });

    wss.once('connection', (socket) => {
      const handler = new AuthorizationWebSocketHandler(authStub, resolveFeed, engine, bookmarks, denyDistributionEngine, resolveFeedInfo);
      handler.handleConnection(socket as any, null);
    });

    const client = new WebSocket(wsUrl);
    const received: string[] = [];
    client.on('message', (d) => received.push(typeof d === 'string' ? d : String(d)));
    await new Promise<void>(resolve => client.once('open', () => resolve()));

    client.send(`SUB\n${JSON.stringify('feedX')}\n${JSON.stringify('')}\n\n`);

    await waitFor(() => received.some(m => m.startsWith('ERR\n') && m.includes('feedX') && m.includes('Not authorized')));

    await new Promise<void>(resolve => { client.once('close', () => resolve()); client.close(); });
  });

  test('allows SUB when distribution rules pass', async () => {
    const address = wss.address();
    const port = typeof address === 'string' ? parseInt(address.split(':').pop() || '0', 10) : (address as any).port;
    const wsUrl = `ws://127.0.0.1:${port}`;

    const bookmarks = new BookmarkManager();

    const authStub = {
      async feed() { return { tuples: [], bookmark: '' }; },
      async load() { return []; },
      async getOrCreateUserFact() { return { type: 'User', hash: 'u1', predecessors: {}, fields: {} }; }
    } as any;

    const observable = new ObservableSource(new MemoryStore());
    const engine = new InverseSpecificationEngine(
      observable.addSpecificationListener.bind(observable),
      observable.removeSpecificationListener.bind(observable)
    );

    const allowDistributionEngine = {
      async canDistributeToAll() {
        return { type: 'success' } as const;
      }
    } as any;

    const feedSpec: Specification = { given: [{ label: { name: 'g', type: 'T' }, conditions: [] }], matches: [], projection: { type: 'composite', components: [] } };
    const resolveFeed = (_: string): Specification => feedSpec;
    const resolveFeedInfo = (_: string) => ({ specification: feedSpec, namedStart: {} as any });

    wss.once('connection', (socket) => {
      const handler = new AuthorizationWebSocketHandler(authStub, resolveFeed, engine, bookmarks, allowDistributionEngine, resolveFeedInfo);
      handler.handleConnection(socket as any, null);
    });

    const client = new WebSocket(wsUrl);
    const received: string[] = [];
    client.on('message', (d) => received.push(typeof d === 'string' ? d : String(d)));
    await new Promise<void>(resolve => client.once('open', () => resolve()));

    client.send(`SUB\n${JSON.stringify('feedY')}\n${JSON.stringify('')}\n\n`);

    // Wait for ACK (which means no ERR was sent)
    await waitFor(() => received.some(m => m.startsWith('ACK\n') && m.includes('"feedY"')));
    
    // Verify no ERR was received
    const hasErr = received.some(m => m.startsWith('ERR\n'));
    expect(hasErr).toBe(false);

    await new Promise<void>(resolve => { client.once('close', () => resolve()); client.close(); });
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 20): Promise<void> {
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('Timeout'));
      setTimeout(check, intervalMs);
    };
    check();
  });
}