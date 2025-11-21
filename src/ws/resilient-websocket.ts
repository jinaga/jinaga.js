/**
 * Resilient WebSocket Framework
 * 
 * Main entry point for the resilient WebSocket communication framework.
 * Provides a unified API for robust client-server WebSocket connections.
 */

export {
  ResilientWebSocketTransport,
  ConnectionState,
  ReconnectMode,
  type WebSocketTransportOptions,
  type WebSocketTransportCallbacks,
  type ConnectionStateChangeEvent,
  type MessageEvent,
  type ReconnectEvent,
  type MinimalWebSocket,
  type WebSocketConstructor
} from './resilient-transport';

export {
  WebSocketConnectionHandler,
  type NegotiationResponse,
  type ConnectionHandlerOptions
} from './connection-handler';

export {
  MessageQueue,
  type QueuedMessage,
  type MessageQueueOptions
} from './message-queue';

import type { WebSocketTransportCallbacks } from './resilient-transport';

/**
 * High-level API for creating resilient WebSocket connections
 */
export class ResilientWebSocket {
  private handler: WebSocketConnectionHandler;

  constructor(
    baseUrl: string,
    callbacks: WebSocketTransportCallbacks,
    options?: ConnectionHandlerOptions
  ) {
    this.handler = new WebSocketConnectionHandler(baseUrl, callbacks, options);
  }

  /**
   * Check if WebSocket is supported
   */
  static isSupported(): boolean {
    return WebSocketConnectionHandler.isWebSocketsSupported();
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    await this.handler.connect();
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    await this.handler.disconnect();
  }

  /**
   * Send a message
   */
  async send(data: string | ArrayBuffer | Blob): Promise<void> {
    await this.handler.send(data);
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.handler.getState();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.handler.isConnected();
  }

  /**
   * Get connection ID
   */
  getConnectionId(): string | null {
    return this.handler.getConnectionId();
  }
}
