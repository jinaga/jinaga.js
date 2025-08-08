import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { AuthorizationWebSocketHandler } from '../../src/ws/authorization-websocket-handler';
import { BookmarkManager } from '../../src/ws/bookmark-manager';
import { InverseSpecificationEngine } from '../../src/ws/inverse-specification-engine';
import { FactEnvelope, FactRecord, FactReference } from '../../src/storage';
import { Specification } from '../../src/specification/specification';
import { serializeGraph } from '../../src/http/serializer';

// Mock invertSpecification to return both add and remove operations
jest.mock('../../src/specification/inverse', () => {
  const dummySpec: Specification = { given: [{ name: 'g', type: 'T' }], matches: [], projection: { type: 'composite', components: [] } };
  return {
    invertSpecification: jest.fn(() => ([
      { inverseSpecification: dummySpec, operation: 'add', givenSubset: [], parentSubset: [], path: '', resultSubset: [] },
      { inverseSpecification: dummySpec, operation: 'remove', givenSubset: [], parentSubset: [], path: '', resultSubset: [] },
    ]))
  };
});

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

    const callbacks: Array<(results: any[]) => Promise<void>> = [];
    const engine = new InverseSpecificationEngine(
      (_spec, onResult) => {
        callbacks.push(onResult);
        return { onResult } as any;
      },
      (_listener) => { /* no-op */ }
    );

    const resolveFeed = (_: string): Specification => ({ given: [{ name: 'g', type: 'T' }], matches: [], projection: { type: 'composite', components: [] } });

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

  test('streams graph on inverse add and sends BOOK on remove', async () => {
    const address = wss.address();
    const port = typeof address === 'string' ? parseInt(address.split(':').pop() || '0', 10) : (address as any).port;
    const wsUrl = `ws://127.0.0.1:${port}`;

    const bookmarks = new BookmarkManager();

    const factRef: FactReference = { type: 'Test.Fact', hash: 'h123' };
    const fact: FactRecord = { type: 'Test.Fact', hash: 'h123', predecessors: {}, fields: { n: 1 } };
    const envelope: FactEnvelope = { fact, signatures: [] };

    const authStub = {
      async feed() { return { tuples: [], bookmark: '' }; },
      async load(_id: any, refs: FactReference[]) { return refs.length ? [envelope] : []; }
    } as any;

    const callbacks: Array<(results: any[]) => Promise<void>> = [];
    const engine = new InverseSpecificationEngine(
      (_spec, onResult) => {
        callbacks.push(onResult);
        return { onResult } as any;
      },
      (_listener) => { /* no-op */ }
    );

    const resolveFeed = (_: string): Specification => ({ given: [{ name: 'g', type: 'T' }], matches: [], projection: { type: 'composite', components: [] } });

    wss.once('connection', (socket) => {
      const handler = new AuthorizationWebSocketHandler(authStub, resolveFeed, engine, bookmarks);
      handler.handleConnection(socket as any, null);
    });

    const client = new WebSocket(wsUrl);
    const received: string[] = [];
    client.on('message', (d) => received.push(typeof d === 'string' ? d : String(d)));
    await new Promise<void>(resolve => client.once('open', () => resolve()));

    // Subscribe (single framed message)
    client.send(`SUB\n${JSON.stringify('feed2')}\n${JSON.stringify('')}\n\n`);

    // Wait until inverse listeners are registered on the server
    await waitFor(() => callbacks.length >= 2);

    // Trigger first callback (either add or remove)
    const result = [{ tuple: { x: factRef }, result: {} } as any];
    callbacks[0] && (await callbacks[0](result));

    // Wait for at least one BOOK
    await waitFor(() => received.some(m => m.startsWith('BOOK\n') && m.includes('"feed2"')));

    // Trigger second callback
    callbacks[1] && (await callbacks[1](result));

    // After both callbacks, expect at least one graph payload to have been received
    const hasGraph = received.some(m => !m.startsWith('BOOK\n') && !m.startsWith('ERR\n'));
    expect(hasGraph).toBe(true);

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

    const callbacks: Array<(results: any[]) => Promise<void>> = [];
    const engine = new InverseSpecificationEngine(
      (_spec, onResult) => {
        callbacks.push(onResult);
        return { onResult } as any;
      },
      (_listener) => { /* no-op */ }
    );

    const denyDistributionEngine = {
      async canDistributeToAll() {
        return { type: 'failure', reason: 'No rules apply' } as const;
      }
    } as any;

    const feedSpec: Specification = { given: [{ name: 'g', type: 'T' }], matches: [], projection: { type: 'composite', components: [] } };
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

    // Ensure no listeners were registered (callbacks should remain empty)
    expect(callbacks.length).toBe(0);

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

    const callbacks: Array<(results: any[]) => Promise<void>> = [];
    const engine = new InverseSpecificationEngine(
      (_spec, onResult) => {
        callbacks.push(onResult);
        return { onResult } as any;
      },
      (_listener) => { /* no-op */ }
    );

    const allowDistributionEngine = {
      async canDistributeToAll() {
        return { type: 'success' } as const;
      }
    } as any;

    const feedSpec: Specification = { given: [{ name: 'g', type: 'T' }], matches: [], projection: { type: 'composite', components: [] } };
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

    // Expect no ERR; allow time for subscription to register (callbacks length > 0 eventually)
    await waitFor(() => callbacks.length > 0);
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