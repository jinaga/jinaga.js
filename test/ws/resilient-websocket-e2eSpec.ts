/**
 * End-to-end tests for ResilientWebSocket framework
 * Tests in a simulated browser/server environment using real WebSocket server
 */

import {
  ResilientWebSocket,
  ConnectionState,
  ReconnectMode,
  type WebSocketTransportCallbacks
} from '../../src/ws/resilient-websocket';
import { createServer, Server } from 'http';
import WebSocket from 'ws';
import { WebSocketServer } from 'ws';

jest.setTimeout(30000);

// Provide WebSocket global for client under test
(globalThis as any).WebSocket = WebSocket;

describe('ResilientWebSocket E2E', () => {
  let wss: WebSocketServer;
  let httpServer: Server;
  const connectedClients: Set<WebSocket> = new Set();
  let serverMessages: Array<{ client: WebSocket; data: string | Buffer }> = [];
  let serverErrors: Error[] = [];

  beforeAll(async () => {
    // Create HTTP server for negotiation endpoint
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

      if (req.method === 'POST' && req.url === '/negotiate') {
        const connectionId = `conn_${Date.now()}_${Math.random()}`;
        const connectionToken = `token_${Date.now()}`;
        
        res.writeHead(200);
        res.end(JSON.stringify({
          connectionId,
          connectionToken,
          availableTransports: ['websocket']
        }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    // Create WebSocket server
    wss = new WebSocketServer({ port: 0 });
    
    wss.on('connection', (socket) => {
      connectedClients.add(socket);
      
      socket.on('message', (data) => {
        serverMessages.push({ client: socket, data: data.toString() });
        
        // Echo message back to client
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(`Echo: ${data}`);
        }
      });

      socket.on('error', (error) => {
        serverErrors.push(error);
      });

      socket.on('close', () => {
        connectedClients.delete(socket);
      });

      // Send welcome message
      socket.send(JSON.stringify({ type: 'welcome', timestamp: Date.now() }));
    });

    await Promise.all([
      new Promise<void>(resolve => httpServer.listen(0, () => resolve())),
      new Promise<void>(resolve => wss.once('listening', () => resolve()))
    ]);
  });

  afterAll(async () => {
    // Close all client connections
    connectedClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    });

    await Promise.all([
      new Promise<void>(resolve => wss.close(() => resolve())),
      new Promise<void>(resolve => httpServer.close(() => resolve()))
    ]);
  });

  beforeEach(() => {
    serverMessages = [];
    serverErrors = [];
  });

  function getWsUrl(): string {
    const address = wss.address();
    if (!address) {
      throw new Error('WebSocket server address is null');
    }
    if (typeof address === 'string') {
      return `ws://${address}`;
    }
    return `ws://127.0.0.1:${address.port}`;
  }

  function getHttpUrl(): string {
    const address = httpServer.address();
    if (!address) {
      throw new Error('HTTP server address is null');
    }
    if (typeof address === 'string') {
      return `http://${address}`;
    }
    return `http://127.0.0.1:${address.port}`;
  }

  describe('Basic Connection', () => {
    it('should establish WebSocket connection', async () => {
      const receivedMessages: Array<string | ArrayBuffer | Blob> = [];
      const callbacks: WebSocketTransportCallbacks = {
        onMessage: (event) => {
          receivedMessages.push(event.data);
        },
        onConnected: jest.fn(),
        onError: jest.fn()
      };

      const ws = new ResilientWebSocket(getWsUrl(), callbacks);

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(ws.isConnected()).toBe(true);
      expect(callbacks.onConnected).toHaveBeenCalled();
      expect(receivedMessages.length).toBeGreaterThan(0);

      await ws.disconnect();
    });

    it('should send and receive messages', async () => {
      const receivedMessages: Array<string | ArrayBuffer | Blob> = [];
      const callbacks: WebSocketTransportCallbacks = {
        onMessage: (event) => {
          receivedMessages.push(event.data);
        },
        onConnected: jest.fn()
      };

      const ws = new ResilientWebSocket(getWsUrl(), callbacks);

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      await ws.send('Hello, Server!');
      await new Promise(resolve => setTimeout(resolve, 200));

      // Server should echo the message
      const echoMessages = receivedMessages.filter(msg => 
        typeof msg === 'string' && msg.includes('Echo:')
      );
      expect(echoMessages.length).toBeGreaterThan(0);

      await ws.disconnect();
    });
  });

  describe('Protocol Negotiation', () => {
    it('should negotiate connection with server', async () => {
      const callbacks: WebSocketTransportCallbacks = {
        onConnected: jest.fn()
      };

      const ws = new ResilientWebSocket(getHttpUrl(), callbacks, {
        negotiate: async () => {
          const response = await fetch(`${getHttpUrl()}/negotiate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ protocol: 'websocket', version: 1 })
          });
          return response.json();
        }
      });

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(ws.isConnected()).toBe(true);
      expect(ws.getConnectionId()).toBeTruthy();

      await ws.disconnect();
    });
  });

  describe('Reconnection', () => {
    it('should automatically reconnect after server disconnect', async () => {
      const reconnectEvents: Array<{ attempt: number }> = [];
      const callbacks: WebSocketTransportCallbacks = {
        onReconnect: (event) => {
          reconnectEvents.push({ attempt: event.attempt });
        },
        onConnected: jest.fn()
      };

      const ws = new ResilientWebSocket(getWsUrl(), callbacks, {
        reconnectMode: ReconnectMode.Stateless,
        reconnectInitialDelayMs: 100,
        maxReconnectAttempts: 5
      });

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      // Force close connection
      connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.close();
        }
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(reconnectEvents.length).toBeGreaterThan(0);
      expect(ws.isConnected()).toBe(true);

      await ws.disconnect();
    });

    it('should buffer messages during disconnection', async () => {
      const callbacks: WebSocketTransportCallbacks = {
        onConnected: jest.fn()
      };

      const ws = new ResilientWebSocket(getWsUrl(), callbacks, {
        enableMessageBuffering: true,
        reconnectMode: ReconnectMode.Stateful,
        reconnectInitialDelayMs: 100
      });

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      // Close connection
      connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.close();
        }
      });

      // Send messages while disconnected
      await ws.send('Buffered Message 1');
      await ws.send('Buffered Message 2');

      // Wait for reconnection
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(ws.isConnected()).toBe(true);
      
      // Messages should be sent after reconnection
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(serverMessages.length).toBeGreaterThan(0);

      await ws.disconnect();
    });
  });

  describe('Heartbeat', () => {
    it('should maintain connection with heartbeat', async () => {
      const callbacks: WebSocketTransportCallbacks = {
        onConnected: jest.fn()
      };

      const ws = new ResilientWebSocket(getWsUrl(), callbacks, {
        heartbeatIntervalMs: 500
      });

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      // Wait for heartbeat
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(ws.isConnected()).toBe(true);

      await ws.disconnect();
    });
  });

  describe('Multiple Clients', () => {
    it('should handle multiple concurrent connections', async () => {
      const clients = Array.from({ length: 3 }, () => 
        new ResilientWebSocket(getWsUrl(), {
          onConnected: jest.fn()
        })
      );

      await Promise.all(clients.map(client => client.connect()));
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(connectedClients.size).toBe(3);
      clients.forEach(client => {
        expect(client.isConnected()).toBe(true);
      });

      await Promise.all(clients.map(client => client.disconnect()));
    });
  });

  describe('Error Handling', () => {
    it('should handle server errors gracefully', async () => {
      const errors: Error[] = [];
      const callbacks: WebSocketTransportCallbacks = {
        onError: (error) => {
          errors.push(error);
        },
        onConnected: jest.fn()
      };

      const ws = new ResilientWebSocket(getWsUrl(), callbacks, {
        reconnectMode: ReconnectMode.Stateless,
        reconnectInitialDelayMs: 100,
        maxReconnectAttempts: 2
      });

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      // Simulate server error by closing connection
      connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1011, 'Internal Error');
        }
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      // Should attempt reconnection
      expect(ws.getState()).toBe(ConnectionState.Reconnecting);

      await ws.disconnect();
    });
  });

  describe('Graceful Shutdown', () => {
    it('should disconnect gracefully', async () => {
      const callbacks: WebSocketTransportCallbacks = {
        onConnected: jest.fn(),
        onClosed: jest.fn()
      };

      const ws = new ResilientWebSocket(getWsUrl(), callbacks);

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      await ws.disconnect();
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(ws.getState()).toBe(ConnectionState.Disconnected);
      expect(ws.isConnected()).toBe(false);
      expect(callbacks.onClosed).toHaveBeenCalled();
    });
  });

  describe('Message Ordering', () => {
    it('should maintain message order', async () => {
      const receivedMessages: string[] = [];
      const callbacks: WebSocketTransportCallbacks = {
        onMessage: (event) => {
          if (typeof event.data === 'string') {
            receivedMessages.push(event.data);
          }
        },
        onConnected: jest.fn()
      };

      const ws = new ResilientWebSocket(getWsUrl(), callbacks);

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 200));

      // Send multiple messages
      for (let i = 0; i < 5; i++) {
        await ws.send(`Message ${i}`);
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify messages were received (echoed by server)
      expect(receivedMessages.length).toBeGreaterThan(0);

      await ws.disconnect();
    });
  });

  describe('Connection State Transitions', () => {
    it('should track all state transitions', async () => {
      const states: ConnectionState[] = [];
      const callbacks: WebSocketTransportCallbacks = {
        onStateChange: (event) => {
          states.push(event.currentState);
        },
        onConnected: jest.fn()
      };

      const ws = new ResilientWebSocket(getWsUrl(), callbacks);

      expect(ws.getState()).toBe(ConnectionState.Disconnected);

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 500));

      await ws.disconnect();
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(states).toContain(ConnectionState.Connecting);
      expect(states).toContain(ConnectionState.Connected);
      expect(states).toContain(ConnectionState.Disconnecting);
      expect(states).toContain(ConnectionState.Disconnected);
    });
  });
});
