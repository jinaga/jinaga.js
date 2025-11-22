/**
 * Resilient WebSocket Transport Framework
 * 
 * Provides a robust client-server communication channel using WebSocket technology
 * with automatic failover, transparent reconnection, and message reliability.
 * 
 * Based on SignalR patterns for connection resiliency.
 */

export enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
  Disconnecting = 'disconnecting',
  Closed = 'closed'
}

export enum ReconnectMode {
  None = 'none',
  Stateless = 'stateless',
  Stateful = 'stateful'
}

export interface WebSocketTransportOptions {
  /** Maximum number of reconnection attempts (0 = unlimited) */
  maxReconnectAttempts?: number;
  /** Initial delay in milliseconds before first reconnection attempt */
  reconnectInitialDelayMs?: number;
  /** Maximum delay in milliseconds between reconnection attempts */
  reconnectMaxDelayMs?: number;
  /** Reconnection mode: stateless (reset) or stateful (preserve state) */
  reconnectMode?: ReconnectMode;
  /** Heartbeat interval in milliseconds (0 = disabled) */
  heartbeatIntervalMs?: number;
  /** Connection timeout in milliseconds */
  connectionTimeoutMs?: number;
  /** Close timeout in milliseconds for graceful shutdown */
  closeTimeoutMs?: number;
  /** Maximum number of messages to buffer during disconnection */
  maxBufferedMessages?: number;
  /** Enable store-and-forward for messages during disconnection */
  enableMessageBuffering?: boolean;
}

export interface ConnectionStateChangeEvent {
  previousState: ConnectionState;
  currentState: ConnectionState;
  error?: Error;
}

export interface MessageEvent {
  data: string | ArrayBuffer | Blob;
  timestamp: number;
}

export interface ReconnectEvent {
  attempt: number;
  delayMs: number;
  error?: Error;
}

/**
 * Callbacks for transport events
 */
export interface WebSocketTransportCallbacks {
  /** Called when connection state changes */
  onStateChange?: (event: ConnectionStateChangeEvent) => void;
  /** Called when a message is received */
  onMessage?: (event: MessageEvent) => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Called when reconnection is attempted */
  onReconnect?: (event: ReconnectEvent) => void;
  /** Called when connection is successfully established */
  onConnected?: () => void;
  /** Called when connection is closed */
  onClosed?: () => void;
}

/**
 * Minimal WebSocket interface for cross-platform compatibility
 */
export interface MinimalWebSocket {
  readonly readyState: number;
  readonly url: string;
  send(data: string | ArrayBuffer | Blob): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'close' | 'error' | 'message', listener: (event: any) => void): void;
  removeEventListener(type: 'open' | 'close' | 'error' | 'message', listener: (event: any) => void): void;
}

/**
 * WebSocket constructor type for cross-platform support
 */
export type WebSocketConstructor = new (url: string, protocols?: string | string[]) => MinimalWebSocket;

/**
 * Buffered message for store-and-forward
 */
interface BufferedMessage {
  data: string | ArrayBuffer | Blob;
  timestamp: number;
  attempts: number;
}

/**
 * Connection state for stateful reconnection
 */
interface ConnectionStateData {
  connectionId?: string;
  lastMessageTimestamp?: number;
  bufferedMessages: BufferedMessage[];
}

/**
 * Resilient WebSocket Transport
 * 
 * Implements a robust WebSocket connection with:
 * - Automatic reconnection with exponential backoff
 * - Message buffering during disconnection
 * - Heartbeat detection for connection health
 * - Graceful shutdown handling
 * - Stateful and stateless reconnection modes
 */
export class ResilientWebSocketTransport {
  private state: ConnectionState = ConnectionState.Disconnected;
  private socket: MinimalWebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private connectionTimeoutTimer: NodeJS.Timeout | null = null;
  private closeTimeoutTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private isShuttingDown = false;
  private isReceiving = false;
  private isSending = false;
  private receiveAbortController: AbortController | null = null;
  private sendAbortController: AbortController | null = null;
  
  private readonly messageQueue: BufferedMessage[] = [];
  private readonly connectionStateData: ConnectionStateData = {
    bufferedMessages: []
  };

  private readonly options: Required<WebSocketTransportOptions>;
  private readonly callbacks: WebSocketTransportCallbacks;
  private readonly wsConstructor: WebSocketConstructor;
  private readonly getUrl: () => Promise<string>;

  constructor(
    getUrl: () => Promise<string>,
    callbacks: WebSocketTransportCallbacks,
    wsConstructor?: WebSocketConstructor,
    options?: WebSocketTransportOptions
  ) {
    this.getUrl = getUrl;
    this.callbacks = callbacks;
    
    // Default options
    this.options = {
      maxReconnectAttempts: options?.maxReconnectAttempts ?? 0, // 0 = unlimited
      reconnectInitialDelayMs: options?.reconnectInitialDelayMs ?? 1000,
      reconnectMaxDelayMs: options?.reconnectMaxDelayMs ?? 30000,
      reconnectMode: options?.reconnectMode ?? ReconnectMode.Stateless,
      heartbeatIntervalMs: options?.heartbeatIntervalMs ?? 30000,
      connectionTimeoutMs: options?.connectionTimeoutMs ?? 10000,
      closeTimeoutMs: options?.closeTimeoutMs ?? 5000,
      maxBufferedMessages: options?.maxBufferedMessages ?? 1000,
      enableMessageBuffering: options?.enableMessageBuffering ?? true
    };

    // WebSocket constructor - use provided or detect from environment
    if (wsConstructor) {
      this.wsConstructor = wsConstructor;
    } else {
      // Try to detect WebSocket from global scope
      if (typeof WebSocket !== 'undefined') {
        this.wsConstructor = WebSocket as any;
      } else {
        throw new Error('WebSocket is not available in this environment');
      }
    }
  }

  /**
   * Check if WebSocket is supported in the current environment
   */
  static isWebSocketsSupported(): boolean {
    return typeof WebSocket !== 'undefined';
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.state === ConnectionState.Connected && 
           this.socket !== null && 
           this.socket.readyState === 1; // WebSocket.OPEN
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Transport is shutting down');
    }

    if (this.state === ConnectionState.Connected || this.state === ConnectionState.Connecting) {
      return;
    }

    await this.establishConnection();
  }

  /**
   * Disconnect from the WebSocket server
   */
  async disconnect(): Promise<void> {
    this.isShuttingDown = true;
    await this.closeConnection(true);
  }

  /**
   * Send a message through the WebSocket connection
   * Messages are buffered if the connection is not ready
   */
  async send(data: string | ArrayBuffer | Blob): Promise<void> {
    if (this.isConnected()) {
      try {
        this.socket!.send(data);
        return;
      } catch (error) {
        // If send fails, buffer the message and trigger reconnection
        this.handleSendError(error as Error);
      }
    }

    // Buffer message if buffering is enabled
    if (this.options.enableMessageBuffering) {
      this.bufferMessage(data);
      
      // Try to reconnect if not already connecting
      if (this.state === ConnectionState.Disconnected && !this.isShuttingDown) {
        await this.connect();
      }
    } else {
      throw new Error('Cannot send message: not connected');
    }
  }

  /**
   * Establish a new WebSocket connection
   */
  private async establishConnection(): Promise<void> {
    this.setState(ConnectionState.Connecting);

    try {
      const url = await this.getUrl();
      const socket = new this.wsConstructor(url);
      this.socket = socket;

      // Set up connection timeout
      this.connectionTimeoutTimer = setTimeout(() => {
        if (this.state === ConnectionState.Connecting) {
          socket.close();
          this.handleConnectionError(new Error('Connection timeout'));
        }
      }, this.options.connectionTimeoutMs);

      // Set up event listeners
      socket.addEventListener('open', () => this.handleOpen());
      socket.addEventListener('message', (event) => this.handleMessage(event));
      socket.addEventListener('error', (event) => this.handleError(event));
      socket.addEventListener('close', (event) => this.handleClose(event));

      // Start receive loop
      this.startReceiveLoop();

    } catch (error) {
      this.handleConnectionError(error as Error);
      throw error;
    }
  }

  /**
   * Handle WebSocket open event
   */
  private handleOpen(): void {
    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }

    // Don't reset reconnectAttempt here - it should accumulate to respect maxReconnectAttempts
    // The counter tracks total reconnection attempts, not just failed ones
    this.setState(ConnectionState.Connected);

    // Start heartbeat if enabled
    if (this.options.heartbeatIntervalMs > 0) {
      this.startHeartbeat();
    }

    // Start send loop to process buffered messages
    this.startSendLoop();

    // Flush buffered messages if stateful reconnect
    if (this.options.reconnectMode === ReconnectMode.Stateful) {
      this.flushBufferedMessages();
    }

    this.callbacks.onConnected?.();
  }

  /**
   * Handle WebSocket message event
   */
  private handleMessage(event: any): void {
    const data = event.data;
    const timestamp = Date.now();

    // Update last message timestamp for stateful reconnect
    if (this.options.reconnectMode === ReconnectMode.Stateful) {
      this.connectionStateData.lastMessageTimestamp = timestamp;
    }

    // Handle heartbeat pong (if server sends pong frames)
    if (this.isHeartbeatMessage(data)) {
      return; // Heartbeat handled, don't forward to application
    }

    // Forward message to application
    this.callbacks.onMessage?.({
      data,
      timestamp
    });
  }

  /**
   * Handle WebSocket error event
   */
  private handleError(event: any): void {
    const error = event.error || new Error('WebSocket error');
    this.callbacks.onError?.(error);
  }

  /**
   * Handle WebSocket close event
   */
  private handleClose(event: any): void {
    this.stopHeartbeat();
    this.stopReceiveLoop();
    this.stopSendLoop();

    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }

    if (this.isShuttingDown) {
      this.setState(ConnectionState.Closed);
      this.callbacks.onClosed?.();
    } else {
      // Attempt reconnection
      this.scheduleReconnect();
    }
  }

  /**
   * Handle connection error
   */
  private handleConnectionError(error: Error): void {
    this.setState(ConnectionState.Disconnected, error);
    this.callbacks.onError?.(error);
    
    if (!this.isShuttingDown) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle send error
   */
  private handleSendError(error: Error): void {
    // Connection may have been lost, trigger reconnection
    if (this.socket) {
      this.socket.close();
    }
    this.handleConnectionError(error);
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.isShuttingDown) {
      return;
    }

    if (this.options.maxReconnectAttempts > 0 && 
        this.reconnectAttempt >= this.options.maxReconnectAttempts) {
      this.setState(ConnectionState.Disconnected);
      this.callbacks.onError?.(new Error('Maximum reconnection attempts reached'));
      return;
    }

    if (this.reconnectTimer) {
      return; // Already scheduled
    }

    this.setState(ConnectionState.Reconnecting);

    // Calculate exponential backoff delay
    const delayMs = Math.min(
      this.options.reconnectInitialDelayMs * Math.pow(2, this.reconnectAttempt),
      this.options.reconnectMaxDelayMs
    );

    this.reconnectAttempt++;

    this.callbacks.onReconnect?.({
      attempt: this.reconnectAttempt,
      delayMs
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.establishConnection();
      } catch (error) {
        this.handleConnectionError(error as Error);
      }
    }, delayMs);
  }

  /**
   * Close the connection gracefully
   */
  private async closeConnection(graceful: boolean): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopHeartbeat();
    this.stopReceiveLoop();
    this.stopSendLoop();

    if (this.socket) {
      this.setState(ConnectionState.Disconnecting);

      if (graceful) {
        // Attempt graceful close
        try {
          // Cancel pending reads
          this.receiveAbortController?.abort();
          
          // Send close frame
          this.socket.close(1000, 'Normal closure');

          // Wait for close with timeout
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              // Force close on timeout
              this.socket?.close();
              resolve();
            }, this.options.closeTimeoutMs);

            const checkClose = () => {
              if (!this.socket || this.socket.readyState === 3) { // CLOSED
                clearTimeout(timeout);
                resolve();
              } else {
                setTimeout(checkClose, 50);
              }
            };
            checkClose();
          });
        } catch (error) {
          // Force close on error
          this.socket.close();
        }
      } else {
        // Force close
        this.socket.close();
      }

      this.socket = null;
    }

    this.setState(ConnectionState.Disconnected);
  }

  /**
   * Set connection state and notify listeners
   */
  private setState(newState: ConnectionState, error?: Error): void {
    const previousState = this.state;
    this.state = newState;

    this.callbacks.onStateChange?.({
      previousState,
      currentState: newState,
      error
    });
  }

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        try {
          // Send ping frame (WebSocket ping)
          // Note: Browser WebSocket API doesn't expose ping directly,
          // so we send a custom heartbeat message
          this.socket!.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        } catch (error) {
          this.handleSendError(error as Error);
        }
      }
    }, this.options.heartbeatIntervalMs);
  }

  /**
   * Stop heartbeat mechanism
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Check if message is a heartbeat message
   */
  private isHeartbeatMessage(data: any): boolean {
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return parsed.type === 'ping' || parsed.type === 'pong';
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Start receive loop for processing incoming messages
   */
  private startReceiveLoop(): void {
    if (this.isReceiving) {
      return;
    }

    this.isReceiving = true;
    this.receiveAbortController = new AbortController();

    // Receive loop is handled by WebSocket event listeners
    // This method exists for extensibility and consistency with send loop
  }

  /**
   * Stop receive loop
   */
  private stopReceiveLoop(): void {
    this.isReceiving = false;
    this.receiveAbortController?.abort();
    this.receiveAbortController = null;
  }

  /**
   * Start send loop for processing buffered messages
   */
  private startSendLoop(): void {
    if (this.isSending) {
      return;
    }

    this.isSending = true;
    this.sendAbortController = new AbortController();

    // Process buffered messages asynchronously
    this.processSendQueue();
  }

  /**
   * Process send queue
   */
  private async processSendQueue(): Promise<void> {
    while (this.isSending && !this.sendAbortController?.signal.aborted) {
      if (!this.isConnected()) {
        break;
      }

      const message = this.messageQueue.shift();
      if (!message) {
        // No more messages, wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      try {
        this.socket!.send(message.data);
        // Remove from stateful buffer if present
        const index = this.connectionStateData.bufferedMessages.findIndex(
          m => m.timestamp === message.timestamp
        );
        if (index >= 0) {
          this.connectionStateData.bufferedMessages.splice(index, 1);
        }
      } catch (error) {
        // Re-queue message on failure
        message.attempts++;
        this.messageQueue.unshift(message);
        this.handleSendError(error as Error);
        break;
      }
    }

    this.isSending = false;
  }

  /**
   * Stop send loop
   */
  private stopSendLoop(): void {
    this.isSending = false;
    this.sendAbortController?.abort();
    this.sendAbortController = null;
  }

  /**
   * Buffer a message for later transmission
   */
  private bufferMessage(data: string | ArrayBuffer | Blob): void {
    // Check buffer limit
    const totalBuffered = this.messageQueue.length + 
                         this.connectionStateData.bufferedMessages.length;
    
    if (totalBuffered >= this.options.maxBufferedMessages) {
      // Remove oldest message
      if (this.messageQueue.length > 0) {
        this.messageQueue.shift();
      } else if (this.connectionStateData.bufferedMessages.length > 0) {
        this.connectionStateData.bufferedMessages.shift();
      }
    }

    const bufferedMessage: BufferedMessage = {
      data,
      timestamp: Date.now(),
      attempts: 0
    };

    this.messageQueue.push(bufferedMessage);

    // Also add to stateful buffer if using stateful reconnect
    if (this.options.reconnectMode === ReconnectMode.Stateful) {
      this.connectionStateData.bufferedMessages.push(bufferedMessage);
    }
  }

  /**
   * Flush buffered messages (for stateful reconnect)
   */
  private flushBufferedMessages(): void {
    // Re-queue stateful messages
    for (const message of this.connectionStateData.bufferedMessages) {
      if (!this.messageQueue.some(m => m.timestamp === message.timestamp)) {
        this.messageQueue.push(message);
      }
    }

    // Start send loop if not already running
    if (!this.isSending && this.messageQueue.length > 0) {
      this.startSendLoop();
    }
  }
}
