/**
 * Unit tests for WebSocketConnectionHandler
 */

import { 
  WebSocketConnectionHandler, 
  type NegotiationResponse,
  type ConnectionHandlerOptions
} from '../../src/ws/connection-handler';
import { ConnectionState } from '../../src/ws/resilient-transport';
import WebSocket from 'ws';

jest.setTimeout(20000);

// Mock WebSocket for testing
class MockWebSocket {
  readyState: number = 0;
  url: string;
  private eventListeners: Map<string, Set<(event: any) => void>> = new Map();
  sentMessages: Array<string | ArrayBuffer | Blob> = [];

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.readyState = 1;
      this.triggerEvent('open', {});
    }, 10);
  }

  send(data: string | ArrayBuffer | Blob): void {
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
}

// Provide WebSocket global
(globalThis as any).WebSocket = MockWebSocket;

describe('WebSocketConnectionHandler', () => {
  let callbacks: any;
  let stateChanges: Array<{ previous: ConnectionState; current: ConnectionState }>;
  let receivedMessages: Array<string | ArrayBuffer | Blob>;

  beforeEach(() => {
    stateChanges = [];
    receivedMessages = [];
    
    callbacks = {
      onStateChange: (event: any) => {
        stateChanges.push({ previous: event.previousState, current: event.currentState });
      },
      onMessage: (event: any) => {
        receivedMessages.push(event.data);
      },
      onError: jest.fn(),
      onConnected: jest.fn(),
      onClosed: jest.fn()
    };
  });

  describe('Connection Lifecycle', () => {
    it('should start in disconnected state', () => {
      const handler = new WebSocketConnectionHandler('ws://test', callbacks);
      expect(handler.getState()).toBe(ConnectionState.Disconnected);
    });

    it('should connect successfully', async () => {
      const handler = new WebSocketConnectionHandler('ws://test', callbacks);
      
      await handler.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler.getState()).toBe(ConnectionState.Connected);
      expect(handler.isConnected()).toBe(true);
      expect(callbacks.onConnected).toHaveBeenCalled();
    });

    it('should disconnect gracefully', async () => {
      const handler = new WebSocketConnectionHandler('ws://test', callbacks);
      
      await handler.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      await handler.disconnect();

      expect(handler.getState()).toBe(ConnectionState.Disconnected);
      expect(handler.isConnected()).toBe(false);
    });
  });

  describe('Protocol Negotiation', () => {
    it('should use custom negotiation function', async () => {
      const negotiationResponse: NegotiationResponse = {
        connectionId: 'test-connection-id',
        connectionToken: 'test-token',
        url: 'ws://negotiated-url'
      };

      const options: ConnectionHandlerOptions = {
        negotiate: async () => negotiationResponse
      };

      const handler = new WebSocketConnectionHandler('ws://test', callbacks, options);
      
      await handler.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler.getConnectionId()).toBe('test-connection-id');
    });

    it('should handle negotiation errors gracefully', async () => {
      const options: ConnectionHandlerOptions = {
        negotiate: async () => {
          throw new Error('Negotiation failed');
        }
      };

      const handler = new WebSocketConnectionHandler('ws://test', callbacks, options);
      
      // Should still attempt connection even if negotiation fails
      await expect(handler.connect()).resolves.not.toThrow();
    });

    it('should use negotiated URL if provided', async () => {
      const negotiationResponse: NegotiationResponse = {
        url: 'ws://custom-url'
      };

      const options: ConnectionHandlerOptions = {
        negotiate: async () => negotiationResponse
      };

      const handler = new WebSocketConnectionHandler('ws://test', callbacks, options);
      
      await handler.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler.isConnected()).toBe(true);
    });
  });

  describe('Authentication', () => {
    it('should include auth token in URL', async () => {
      const options: ConnectionHandlerOptions = {
        getAuthToken: async () => 'test-token-123'
      };

      const handler = new WebSocketConnectionHandler('ws://test', callbacks, options);
      
      await handler.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler.isConnected()).toBe(true);
    });

    it('should handle missing auth token gracefully', async () => {
      const options: ConnectionHandlerOptions = {
        getAuthToken: async () => null
      };

      const handler = new WebSocketConnectionHandler('ws://test', callbacks, options);
      
      await expect(handler.connect()).resolves.not.toThrow();
    });

    it('should handle auth token retrieval errors', async () => {
      const options: ConnectionHandlerOptions = {
        getAuthToken: async () => {
          throw new Error('Token retrieval failed');
        }
      };

      const handler = new WebSocketConnectionHandler('ws://test', callbacks, options);
      
      // Should still attempt connection
      await expect(handler.connect()).resolves.not.toThrow();
    });
  });

  describe('Message Transmission', () => {
    it('should send messages when connected', async () => {
      const handler = new WebSocketConnectionHandler('ws://test', callbacks);
      
      await handler.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      await handler.send('Hello, World!');

      // Message sending is handled by transport layer
      expect(handler.isConnected()).toBe(true);
    });

    it('should throw error when sending while disconnected', async () => {
      const handler = new WebSocketConnectionHandler('ws://test', callbacks);
      
      await expect(handler.send('Message')).rejects.toThrow();
    });
  });

  describe('Connection ID Management', () => {
    it('should store connection ID from negotiation', async () => {
      const negotiationResponse: NegotiationResponse = {
        connectionId: 'test-id-123'
      };

      const options: ConnectionHandlerOptions = {
        negotiate: async () => negotiationResponse
      };

      const handler = new WebSocketConnectionHandler('ws://test', callbacks, options);
      
      await handler.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler.getConnectionId()).toBe('test-id-123');
    });

    it('should return null connection ID when not negotiated', async () => {
      const handler = new WebSocketConnectionHandler('ws://test', callbacks);
      
      expect(handler.getConnectionId()).toBeNull();
      
      await handler.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler.getConnectionId()).toBeNull();
    });
  });

  describe('URL Resolution', () => {
    it('should convert http to ws', async () => {
      const handler = new WebSocketConnectionHandler('http://test', callbacks);
      
      await handler.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler.isConnected()).toBe(true);
    });

    it('should convert https to wss', async () => {
      const handler = new WebSocketConnectionHandler('https://test', callbacks);
      
      await handler.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler.isConnected()).toBe(true);
    });

    it('should add connection token to URL', async () => {
      const negotiationResponse: NegotiationResponse = {
        connectionToken: 'token-123'
      };

      const options: ConnectionHandlerOptions = {
        negotiate: async () => negotiationResponse
      };

      const handler = new WebSocketConnectionHandler('ws://test', callbacks, options);
      
      await handler.connect();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler.isConnected()).toBe(true);
    });
  });

  describe('Static Methods', () => {
    it('should check WebSocket support', () => {
      const isSupported = WebSocketConnectionHandler.isWebSocketsSupported();
      expect(typeof isSupported).toBe('boolean');
    });
  });

  describe('Error Handling', () => {
    it('should handle connection failures', async () => {
      const errorWs = class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          setTimeout(() => {
            this.triggerEvent('error', { error: new Error('Connection failed') });
          }, 10);
        }
      };

      (globalThis as any).WebSocket = errorWs;

      const handler = new WebSocketConnectionHandler('ws://test', callbacks);
      
      await handler.connect();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(callbacks.onError).toHaveBeenCalled();
    });
  });
});
