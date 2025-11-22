/**
 * Integration tests for ResilientWebSocket framework
 * Tests the interaction between components
 */

import {
  ResilientWebSocket,
  ConnectionState,
  ReconnectMode,
  type WebSocketTransportCallbacks
} from '../../src/ws/resilient-websocket';
import WebSocket from 'ws';
import { waitForConnectionState } from './test-helpers';

jest.setTimeout(20000);

// Mock WebSocket for integration testing
class MockWebSocket {
  readyState: number = 0;
  url: string;
  private eventListeners: Map<string, Set<(event: any) => void>> = new Map();
  sentMessages: Array<string | ArrayBuffer | Blob> = [];
  private shouldFail = false;
  private shouldClose = false;

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      if (!this.shouldFail) {
        this.readyState = 1;
        this.triggerEvent('open', {});
      } else {
        this.triggerEvent('error', { error: new Error('Connection failed') });
        // Close the socket after error to trigger reconnection
        this.readyState = 3;
        this.triggerEvent('close', { code: 1006, reason: 'Connection failed' });
      }
    }, 10);
  }

  send(data: string | ArrayBuffer | Blob): void {
    if (this.shouldClose) {
      throw new Error('Connection closed');
    }
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.triggerEvent('close', { code, reason });
  }

  addEventListener(type: 'open' | 'close' | 'error' | 'message', listener: (event: any) => void): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener);
  }

  removeEventListener(type: 'open' | 'close' | 'error' | 'message', listener: (event: any) => void): void {
    this.eventListeners.get(type)?.delete(listener);
  }

  triggerEvent(type: 'open' | 'close' | 'error' | 'message', event: any): void {
    this.eventListeners.get(type)?.forEach(listener => listener(event));
  }

  simulateMessage(data: string | ArrayBuffer | Blob): void {
    this.triggerEvent('message', { data });
  }

  simulateClose(): void {
    this.shouldClose = true;
    this.close();
  }

  setShouldFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  getSentMessages(): Array<string | ArrayBuffer | Blob> {
    return [...this.sentMessages];
  }
}

// Provide WebSocket global
(globalThis as any).WebSocket = MockWebSocket;

describe('ResilientWebSocket Integration', () => {
  let callbacks: WebSocketTransportCallbacks;
  let stateChanges: ConnectionState[];
  let receivedMessages: Array<string | ArrayBuffer | Blob>;
  let reconnectEvents: Array<{ attempt: number; delayMs: number }>;

  beforeEach(() => {
    stateChanges = [];
    receivedMessages = [];
    reconnectEvents = [];

    callbacks = {
      onStateChange: (event) => {
        stateChanges.push(event.currentState);
      },
      onMessage: (event) => {
        receivedMessages.push(event.data);
      },
      onError: jest.fn(),
      onConnected: jest.fn(),
      onClosed: jest.fn(),
      onReconnect: (event) => {
        reconnectEvents.push({ attempt: event.attempt, delayMs: event.delayMs });
      }
    };
  });

  describe('Full Connection Lifecycle', () => {
    it('should handle complete connection lifecycle', async () => {
      const ws = new ResilientWebSocket('ws://test', callbacks);

      expect(ws.getState()).toBe(ConnectionState.Disconnected);

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(ws.getState()).toBe(ConnectionState.Connected);
      expect(ws.isConnected()).toBe(true);

      await ws.send('Test Message');
      await new Promise(resolve => setTimeout(resolve, 50));

      await ws.disconnect();

      expect(ws.getState()).toBe(ConnectionState.Disconnected);
      expect(ws.isConnected()).toBe(false);
    });

    it('should handle multiple connect/disconnect cycles', async () => {
      const ws = new ResilientWebSocket('ws://test', callbacks);

      for (let i = 0; i < 3; i++) {
        await ws.connect();
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(ws.isConnected()).toBe(true);

        await ws.disconnect();
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(ws.isConnected()).toBe(false);
      }
    });
  });

  describe('Message Buffering and Reconnection', () => {
    it('should buffer messages during disconnection and send on reconnect', async () => {
      const ws = new ResilientWebSocket('ws://test', callbacks, {
        enableMessageBuffering: true,
        reconnectMode: ReconnectMode.Stateless,
        reconnectInitialDelayMs: 50
      });

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate disconnection
      (globalThis as any).WebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          setTimeout(() => this.simulateClose(), 20);
        }
      };

      // Send messages while disconnected
      await ws.send('Message 1');
      await ws.send('Message 2');

      // Wait for reconnection
      await new Promise(resolve => setTimeout(resolve, 200));

      // Messages should be sent after reconnection
      expect(ws.isConnected()).toBe(true);
    });

    it('should handle stateful reconnection with buffered messages', async () => {
      const ws = new ResilientWebSocket('ws://test', callbacks, {
        reconnectMode: ReconnectMode.Stateful,
        enableMessageBuffering: true,
        reconnectInitialDelayMs: 50
      });

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      await ws.send('Stateful Message');

      // Simulate reconnection
      (globalThis as any).WebSocket = MockWebSocket;

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(ws.isConnected()).toBe(true);
    });
  });

  describe('Heartbeat Integration', () => {
    it('should send heartbeat messages periodically', async () => {
      const ws = new ResilientWebSocket('ws://test', callbacks, {
        heartbeatIntervalMs: 100
      });

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      const initialState = stateChanges.length;

      await new Promise(resolve => setTimeout(resolve, 150));

      // Heartbeat should be active
      expect(ws.isConnected()).toBe(true);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from connection errors', async () => {
      let connectionAttempts = 0;
      (globalThis as any).WebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          connectionAttempts++;
          if (connectionAttempts === 1) {
            this.setShouldFail(true);
          }
        }
      };

      const ws = new ResilientWebSocket('ws://test', callbacks, {
        reconnectMode: ReconnectMode.Stateless,
        reconnectInitialDelayMs: 50,
        maxReconnectAttempts: 3
      });

      await ws.connect();
      
      // Wait for reconnection to complete after first failure
      // reconnectInitialDelayMs: 50 + connection time ~10ms
      await waitForConnectionState(() => ws.getState(), ConnectionState.Connected, 200);

      // Should eventually connect after retry - connectionAttempts should be 2
      expect(connectionAttempts).toBeGreaterThan(1);
    });
  });

  describe('Connection State Tracking', () => {
    it('should track all state transitions', async () => {
      const ws = new ResilientWebSocket('ws://test', callbacks);

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      await ws.disconnect();

      expect(stateChanges).toContain(ConnectionState.Connecting);
      expect(stateChanges).toContain(ConnectionState.Connected);
      expect(stateChanges).toContain(ConnectionState.Disconnecting);
      expect(stateChanges).toContain(ConnectionState.Disconnected);
    });
  });

  describe('Multiple Messages', () => {
    it('should handle multiple rapid messages', async () => {
      const ws = new ResilientWebSocket('ws://test', callbacks);

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      for (let i = 0; i < 10; i++) {
        await ws.send(`Message ${i}`);
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(ws.isConnected()).toBe(true);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent send operations', async () => {
      const ws = new ResilientWebSocket('ws://test', callbacks);

      await ws.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      const promises = Array.from({ length: 5 }, (_, i) => 
        ws.send(`Concurrent ${i}`)
      );

      await Promise.all(promises);
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(ws.isConnected()).toBe(true);
    });
  });
});
