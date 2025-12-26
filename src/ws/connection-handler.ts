/**
 * WebSocket Connection Handler
 * 
 * Handles connection initialization, protocol negotiation, and authentication
 * for resilient WebSocket connections.
 */

import { ResilientWebSocketTransport, WebSocketTransportCallbacks, WebSocketTransportOptions, ConnectionState } from './resilient-transport';

export interface NegotiationResponse {
  connectionId?: string;
  connectionToken?: string;
  url?: string;
  availableTransports?: string[];
  error?: string;
}

export interface ConnectionHandlerOptions extends WebSocketTransportOptions {
  /** Function to negotiate connection parameters with server */
  negotiate?: () => Promise<NegotiationResponse>;
  /** Function to get authentication token */
  getAuthToken?: () => Promise<string | null>;
  /** Custom headers to include in negotiation */
  headers?: Record<string, string>;
  /** WebSocket subprotocols to negotiate */
  protocols?: string | string[];
}

/**
 * Connection Handler for WebSocket connections
 * 
 * Manages the connection lifecycle including:
 * - Protocol negotiation
 * - Authentication token exchange
 * - URL resolution and upgrade
 * - Connection state management
 */
export class WebSocketConnectionHandler {
  private transport: ResilientWebSocketTransport | null = null;
  private connectionId: string | null = null;
  private connectionToken: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly callbacks: WebSocketTransportCallbacks,
    private readonly options: ConnectionHandlerOptions = {}
  ) {}

  /**
   * Check if WebSocket is supported
   */
  static isWebSocketsSupported(): boolean {
    return ResilientWebSocketTransport.isWebSocketsSupported();
  }

  /**
   * Initialize and establish connection
   */
  async connect(): Promise<void> {
    if (this.transport && this.transport.isConnected()) {
      return;
    }

    // Step 1: Negotiate connection parameters
    const negotiation = await this.negotiateConnection();

    // Step 2: Resolve WebSocket URL
    const wsUrl = await this.resolveWebSocketUrl(negotiation);

    // Step 3: Create transport and connect
    this.transport = new ResilientWebSocketTransport(
      () => Promise.resolve(wsUrl),
      {
        ...this.callbacks,
        onConnected: () => {
          this.callbacks.onConnected?.();
        },
        onStateChange: (event) => {
          // Update connection ID on successful connection
          if (event.currentState === ConnectionState.Connected && negotiation.connectionId) {
            this.connectionId = negotiation.connectionId;
          }
          this.callbacks.onStateChange?.(event);
        }
      },
      undefined, // Use default WebSocket constructor
      this.options
    );

    await this.transport.connect();
  }

  /**
   * Disconnect from server
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.disconnect();
      this.transport = null;
    }
    this.connectionId = null;
    this.connectionToken = null;
  }

  /**
   * Send a message through the connection
   */
  async send(data: string | ArrayBuffer | Blob): Promise<void> {
    if (!this.transport) {
      throw new Error('Connection not established');
    }
    await this.transport.send(data);
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.transport?.getState() ?? ConnectionState.Disconnected;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.transport?.isConnected() ?? false;
  }

  /**
   * Get connection ID (if available)
   */
  getConnectionId(): string | null {
    return this.connectionId;
  }

  /**
   * Negotiate connection parameters with server
   */
  private async negotiateConnection(): Promise<NegotiationResponse> {
    if (this.options.negotiate) {
      try {
        return await this.options.negotiate();
      } catch (error) {
        // If custom negotiation fails, proceed with direct WebSocket connection
        // This allows for servers that don't require negotiation
        return {};
      }
    }

    // Default negotiation: try to negotiate via HTTP endpoint
    try {
      const negotiateUrl = new URL('/negotiate', this.baseUrl).toString();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.options.headers
      };

      // Add authentication token if available
      if (this.options.getAuthToken) {
        const token = await this.options.getAuthToken();
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      }

      const response = await fetch(negotiateUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          protocol: 'websocket',
          version: 1
        })
      });

      if (!response.ok) {
        throw new Error(`Negotiation failed: ${response.statusText}`);
      }

      const negotiation: NegotiationResponse = await response.json();
      
      if (negotiation.error) {
        throw new Error(`Negotiation error: ${negotiation.error}`);
      }

      return negotiation;
    } catch (error) {
      // If negotiation fails, proceed with direct WebSocket connection
      // This allows for servers that don't require negotiation
      return {};
    }
  }

  /**
   * Resolve WebSocket URL from negotiation response
   */
  private async resolveWebSocketUrl(negotiation: NegotiationResponse): Promise<string> {
    // Use negotiated URL if provided
    if (negotiation.url) {
      return negotiation.url;
    }

    // Otherwise, construct URL from base URL
    const url = new URL(this.baseUrl);
    
    // Convert http/https to ws/wss
    if (url.protocol === 'https:') {
      url.protocol = 'wss:';
    } else if (url.protocol === 'http:') {
      url.protocol = 'ws:';
    }

    // Add connection token if available
    if (negotiation.connectionToken) {
      this.connectionToken = negotiation.connectionToken;
      url.searchParams.set('id', negotiation.connectionToken);
    }

    // Add connection ID if available
    if (negotiation.connectionId) {
      url.searchParams.set('connectionId', negotiation.connectionId);
    }

    // Add authentication token if available (browsers can't set custom WS headers)
    if (this.options.getAuthToken) {
      try {
        const token = await this.options.getAuthToken();
        if (token) {
          url.searchParams.set('access_token', token);
        }
      } catch {
        // Ignore auth token retrieval failures
      }
    }

    return url.toString();
  }
}
