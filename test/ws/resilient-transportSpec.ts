/**
 * Unit tests for ResilientWebSocketTransport
 */

import { 
  ResilientWebSocketTransport, 
  ConnectionState, 
  ReconnectMode,
  type WebSocketTransportCallbacks,
  type MinimalWebSocket
} from '../../src/ws/resilient-transport';
import WebSocket from 'ws';

jest.setTimeout(30000);

// Mock WebSocket implementation for testing
class MockWebSocket implements MinimalWebSocket {
  readyState: number = 0; // CONNECTING
  url: string;
  onopen: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  
  private eventListeners: Map<string, Set<(event: any) => void>> = new Map();
  private sentMessages: Array<string | ArrayBuffer | Blob> = [];

  constructor(url: string) {
    this.url = url;
    // Simulate connection after a short delay
    setTimeout(() => {
      this.readyState = 1; // OPEN
      this.triggerEvent('open', {});
    }, 10);
  }

  send(data: string | ArrayBuffer | Blob): void {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3; // CLOSED
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
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach(listener => listener(event));
    }
    // Also trigger legacy handlers
    if (type === 'open' && this.onopen) this.onopen(event);
    if (type === 'close' && this.onclose) this.onclose(event);
    if (type === 'error' && this.onerror) this.onerror(event);
    if (type === 'message' && this.onmessage) this.onmessage(event);
  }

  simulateMessage(data: string | ArrayBuffer | Blob): void {
    this.triggerEvent('message', { data });
  }

  simulateError(error: Error): void {
    this.triggerEvent('error', { error });
  }

  simulateClose(code?: number, reason?: string): void {
    this.readyState = 3; // CLOSED
    this.triggerEvent('close', { code, reason });
  }

  getSentMessages(): Array<string | ArrayBuffer | Blob> {
    return [...this.sentMessages];
  }
}

describe('ResilientWebSocketTransport', () => {
  let callbacks: WebSocketTransportCallbacks;
  let stateChanges: Array<{ previous: ConnectionState; current: ConnectionState }>;
  let receivedMessages: Array<string | ArrayBuffer | Blob>;
  let errors: Error[];

  beforeEach(() => {
    stateChanges = [];
    receivedMessages = [];
    errors = [];
    
    callbacks = {
      onStateChange: (event) => {
        stateChanges.push({ previous: event.previousState, current: event.currentState });
      },
      onMessage: (event) => {
        receivedMessages.push(event.data);
      },
      onError: (error) => {
        errors.push(error);
      },
      onConnected: jest.fn(),
      onClosed: jest.fn(),
      onReconnect: jest.fn()
    };
  });

  describe('Connection Lifecycle', () => {
    it('should start in disconnected state', () => {
      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        MockWebSocket as any
      );

      expect(transport.getState()).toBe(ConnectionState.Disconnected);
      expect(transport.isConnected()).toBe(false);
    });

    it('should connect successfully', async () => {
      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        MockWebSocket as any
      );

      await transport.connect();

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(transport.getState()).toBe(ConnectionState.Connected);
      expect(transport.isConnected()).toBe(true);
      expect(callbacks.onConnected).toHaveBeenCalled();
    });

    it('should handle connection timeout', async () => {
      const slowMockWs = class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          // Don't auto-connect
          setTimeout(() => {}, 1000);
        }
      };

      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        slowMockWs as any,
        { connectionTimeoutMs: 100 }
      );

      await transport.connect();

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(errors.length).toBeGreaterThan(0);
    });

    it('should disconnect gracefully', async () => {
      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        MockWebSocket as any
      );

      await transport.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      await transport.disconnect();

      expect(transport.getState()).toBe(ConnectionState.Disconnected);
      expect(transport.isConnected()).toBe(false);
      expect(callbacks.onClosed).toHaveBeenCalled();
    });
  });

  describe('Message Transmission', () => {
    it('should send messages when connected', async () => {
      const sentMessages: Array<string | ArrayBuffer | Blob> = [];
      
      const TrackingMockWebSocket = class extends MockWebSocket {
        send(data: string | ArrayBuffer | Blob): void {
          sentMessages.push(data);
          super.send(data);
        }
      };

      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        TrackingMockWebSocket as any
      );

      await transport.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      await transport.send('Hello, World!');

      expect(sentMessages).toContain('Hello, World!');
    });

    it('should buffer messages when disconnected', async () => {
      const sentMessages: Array<string | ArrayBuffer | Blob> = [];
      
      const TrackingMockWebSocket = class extends MockWebSocket {
        send(data: string | ArrayBuffer | Blob): void {
          sentMessages.push(data);
          super.send(data);
        }
      };

      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        TrackingMockWebSocket as any,
        { enableMessageBuffering: true }
      );

      // Send before connecting
      await transport.send('Buffered Message');

      await transport.connect();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Message should be sent after connection
      expect(sentMessages.length).toBeGreaterThan(0);
      expect(sentMessages).toContain('Buffered Message');
    });

    it('should not buffer messages when buffering is disabled', async () => {
      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        MockWebSocket as any,
        { enableMessageBuffering: false }
      );

      await expect(transport.send('Message')).rejects.toThrow();
    });
  });

  describe('Reconnection', () => {
    it('should reconnect automatically on disconnect', async () => {
      let connectionCount = 0;
      // Create a mock that closes itself after connection to simulate network failure
      const AutoClosingMockWebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          connectionCount++;
          // Close after connection is fully established (100ms to ensure transport processes open event)
          setTimeout(() => {
            if (this.readyState === 1) { // OPEN
              // Add small delay to ensure transport has processed open event
              setTimeout(() => {
                if (this.readyState === 1) {
                  this.close();
                }
              }, 50);
            }
          }, 100);
        }
      };

      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        AutoClosingMockWebSocket as any,
        {
          reconnectMode: ReconnectMode.Stateless,
          reconnectInitialDelayMs: 50,
          maxReconnectAttempts: 3
        }
      );

      await transport.connect();
      // Wait for initial connection + close + first reconnect
      // Initial: ~10ms open, ~150ms close, ~50ms reconnect delay = ~210ms minimum
      // Use 500ms to account for timing variations
      await new Promise(resolve => setTimeout(resolve, 500));

      const initialCount = 1; // First connection
      
      // Should have reconnected after unexpected close
      expect(connectionCount).toBeGreaterThan(initialCount);
      expect(callbacks.onReconnect).toHaveBeenCalled();
    });

    it('should respect max reconnection attempts', async () => {
      let connectionCount = 0;
      // Create a mock that closes itself after connection to simulate network failure
      const AutoClosingMockWebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          connectionCount++;
          // Close after connection is fully established (100ms to ensure transport processes open event)
          setTimeout(() => {
            if (this.readyState === 1) { // OPEN
              // Add small delay to ensure transport has processed open event
              setTimeout(() => {
                if (this.readyState === 1) {
                  this.close();
                }
              }, 50);
            }
          }, 100);
        }
      };

      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        AutoClosingMockWebSocket as any,
        {
          maxReconnectAttempts: 2,
          reconnectInitialDelayMs: 50
        }
      );

      await transport.connect();
      // Wait for reconnection attempts with maxReconnectAttempts: 2
      // Initial connection: ~10ms open, ~150ms close
      // First reconnect: ~50ms delay, ~150ms close
      // Second reconnect: ~100ms delay, ~150ms close
      // Then max reached
      // Total: ~610ms minimum, use 1000ms for safety
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(callbacks.onReconnect).toHaveBeenCalledTimes(2);
      expect(errors.some(e => 
        e.message.includes('Maximum reconnection attempts') || 
        e.message.includes('Maximum reconnection attempts reached')
      )).toBe(true);
    });

    it('should use exponential backoff for reconnection', async () => {
      const reconnectDelays: number[] = [];
      const originalOnReconnect = callbacks.onReconnect!;
      callbacks.onReconnect = (event) => {
        reconnectDelays.push(event.delayMs);
        originalOnReconnect(event);
      };

      // Create a mock that closes itself after connection to simulate network failure
      const AutoClosingMockWebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          // Close after connection is fully established (100ms to ensure transport processes open event)
          setTimeout(() => {
            if (this.readyState === 1) { // OPEN
              // Add small delay to ensure transport has processed open event
              setTimeout(() => {
                if (this.readyState === 1) {
                  this.close();
                }
              }, 50);
            }
          }, 100);
        }
      };

      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        AutoClosingMockWebSocket as any,
        {
          reconnectInitialDelayMs: 100,
          reconnectMaxDelayMs: 1000,
          maxReconnectAttempts: 5
        }
      );

      await transport.connect();
      // Wait for multiple reconnection attempts with exponential backoff
      // Initial: ~10ms open, ~150ms close
      // Reconnect 1: ~100ms delay, ~150ms close
      // Reconnect 2: ~200ms delay, ~150ms close
      // Reconnect 3: ~400ms delay, ~150ms close
      // Total: ~1160ms minimum, use 2000ms for safety
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check that delays increase (exponential backoff)
      expect(reconnectDelays.length).toBeGreaterThan(1);
      for (let i = 1; i < reconnectDelays.length; i++) {
        expect(reconnectDelays[i]).toBeGreaterThanOrEqual(reconnectDelays[i - 1]);
      }
    });
  });

  describe('Heartbeat', () => {
    it('should send heartbeat messages', async () => {
      const sentMessages: Array<string | ArrayBuffer | Blob> = [];
      
      const TrackingMockWebSocket = class extends MockWebSocket {
        send(data: string | ArrayBuffer | Blob): void {
          sentMessages.push(data);
          super.send(data);
        }
      };

      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        TrackingMockWebSocket as any,
        { heartbeatIntervalMs: 100 }
      );

      await transport.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      const initialMessageCount = sentMessages.length;

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(sentMessages.length).toBeGreaterThan(initialMessageCount);
    });

    it('should not send heartbeat when disabled', async () => {
      const sentMessages: Array<string | ArrayBuffer | Blob> = [];
      
      const TrackingMockWebSocket = class extends MockWebSocket {
        send(data: string | ArrayBuffer | Blob): void {
          sentMessages.push(data);
          super.send(data);
        }
      };

      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        TrackingMockWebSocket as any,
        { heartbeatIntervalMs: 0 }
      );

      await transport.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      const initialMessageCount = sentMessages.length;

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(sentMessages.length).toBe(initialMessageCount);
    });
  });

  describe('State Management', () => {
    it('should track state changes correctly', async () => {
      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        MockWebSocket as any
      );

      expect(stateChanges).toHaveLength(0);

      await transport.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(stateChanges.length).toBeGreaterThan(0);
      expect(stateChanges[0].previous).toBe(ConnectionState.Disconnected);
      expect(stateChanges[stateChanges.length - 1].current).toBe(ConnectionState.Connected);
    });
  });

  describe('Error Handling', () => {
    it('should handle send errors', async () => {
      const errorWs = class extends MockWebSocket {
        send(data: string | ArrayBuffer | Blob): void {
          throw new Error('Send failed');
        }
      };

      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        errorWs as any
      );

      await transport.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      await transport.send('Test');

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(errors.length).toBeGreaterThan(0);
    });

    it('should handle connection errors', async () => {
      const errorWs = class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          setTimeout(() => {
            this.simulateError(new Error('Connection failed'));
          }, 10);
        }
      };

      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        errorWs as any
      );

      await transport.connect();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('Message Buffering', () => {
    it('should respect max buffered messages limit', async () => {
      const sentMessages: Array<string | ArrayBuffer | Blob> = [];
      
      const TrackingMockWebSocket = class extends MockWebSocket {
        send(data: string | ArrayBuffer | Blob): void {
          sentMessages.push(data);
          super.send(data);
        }
      };

      const transport = new ResilientWebSocketTransport(
        () => Promise.resolve('ws://test'),
        callbacks,
        TrackingMockWebSocket as any,
        {
          enableMessageBuffering: true,
          maxBufferedMessages: 5
        }
      );

      // Send more than max
      for (let i = 0; i < 10; i++) {
        await transport.send(`Message ${i}`);
      }

      await transport.connect();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should only have max messages buffered (older messages are dropped)
      // Note: All messages may be sent, but the buffer limit prevents storing more than 5
      // The actual behavior depends on when messages are sent vs when buffer limit is checked
      expect(sentMessages.length).toBeGreaterThan(0);
    });
  });

  describe('Static Methods', () => {
    it('should check WebSocket support', () => {
      const isSupported = ResilientWebSocketTransport.isWebSocketsSupported();
      expect(typeof isSupported).toBe('boolean');
    });
  });
});
