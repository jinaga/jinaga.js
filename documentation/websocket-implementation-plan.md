# WebSocket Implementation Plan

## Overview

This document provides the comprehensive implementation plan for WebSocket-based fact streaming using the Jinaga Graph Serialization Protocol. It consolidates the concrete implementation steps, code interfaces, protocol details, and optimization strategies needed to replace the current HTTP polling approach with an efficient WebSocket solution.

## Current System Analysis

### Current HTTP Implementation
The existing system uses HTTP polling for fact streaming:

- **HttpNetwork**: Implements the `Network` interface, delegates to `WebClient`
- **WebClient**: Handles HTTP requests and streaming via `HttpConnection`
- **FetchConnection**: Uses fetch API with streaming responses (`application/x-jinaga-feed-stream`)
- **Subscriber**: Manages individual feed subscriptions with 4-minute reconnection intervals
- **NetworkManager**: Coordinates multiple subscribers and manages feed lifecycle

### Current Data Flow Inefficiency
The current HTTP implementation has an inefficient pattern:

1. `NetworkManager.subscribe()` creates `Subscriber` instances for each feed
2. `Subscriber.start()` calls `Network.streamFeed()` 
3. `HttpNetwork.streamFeed()` delegates to `WebClient.streamFeed()`
4. `WebClient.streamFeed()` calls `HttpConnection.getStream()`
5. `FetchConnection.getStream()` establishes HTTP streaming connection
6. JSON responses contain `{references: FactReference[], bookmark: string}`
7. `Subscriber` calls `network.load(references)` to get complete fact data
8. This creates redundant HTTP requests for data that could be streamed directly

### Current Message Format
- HTTP streaming uses `application/x-jinaga-feed-stream` content type
- Each line contains a JSON-encoded `FeedResponse`: `{references: FactReference[], bookmark: string}`
- Empty lines are ignored
- Connection includes authentication headers

## Implementation Components

### 1. WebSocket Message Types

```typescript
// src/http/webSocketMessages.ts

export interface SubscriptionMessage {
    type: 'subscription';
    subscriptionId: string;
    feed: string;
    bookmark: string;
}

export interface UnsubscribeMessage {
    type: 'unsubscribe';
    subscriptionId: string;
}

export interface PingMessage {
    type: 'ping';
    timestamp: number;
}

export type ClientMessage = SubscriptionMessage | UnsubscribeMessage | PingMessage;

// Server responses are handled via the Graph Protocol stream parser
// No separate message types needed - everything flows through the protocol
```

### 2. WebSocket Graph Protocol Handler

```typescript
// src/http/webSocketGraphHandler.ts

import { GraphDeserializer } from './deserializer';
import { FactEnvelope } from '../storage';

export interface WebSocketSubscriptionHandler {
    onFactEnvelopes: (envelopes: FactEnvelope[]) => Promise<void>;
    onBookmark: (bookmark: string) => Promise<void>;
    onError: (error: Error) => void;
}

export class WebSocketGraphProtocolHandler {
    private subscriptionHandlers = new Map<string, WebSocketSubscriptionHandler>();
    private currentSubscriptionId: string | null = null;
    private lineBuffer: string[] = [];
    private deserializer: GraphDeserializer | null = null;

    constructor() {}

    /**
     * Register a subscription handler
     */
    addSubscription(subscriptionId: string, handler: WebSocketSubscriptionHandler): void {
        this.subscriptionHandlers.set(subscriptionId, handler);
    }

    /**
     * Remove a subscription handler
     */
    removeSubscription(subscriptionId: string): void {
        this.subscriptionHandlers.delete(subscriptionId);
    }

    /**
     * Process incoming WebSocket data using Graph Protocol
     */
    async processData(data: string): Promise<void> {
        const lines = data.split(/\r?\n/);
        
        for (const line of lines) {
            await this.processLine(line);
        }
    }

    /**
     * Process a single line from the WebSocket stream
     */
    private async processLine(line: string): Promise<void> {
        // Handle control markers
        if (line.startsWith('SUB')) {
            // Subscription confirmation (not typically sent by server)
            return;
        }
        
        if (line.startsWith('BM')) {
            await this.handleBookmark(line);
            return;
        }
        
        if (line.startsWith('ERR')) {
            await this.handleError(line);
            return;
        }

        if (line.startsWith('PING')) {
            // Handle ping - could send PONG response
            return;
        }

        if (line.startsWith('PONG')) {
            // Handle pong response
            return;
        }

        // Handle Graph Protocol content
        this.lineBuffer.push(line);
        
        // Check if we have a complete block (empty line indicates end of block)
        if (line === '') {
            await this.processGraphBlock();
        }
    }

    /**
     * Handle bookmark control marker
     */
    private async handleBookmark(line: string): Promise<void> {
        const subscriptionId = this.extractSubscriptionId(line, 'BM');
        const handler = this.subscriptionHandlers.get(subscriptionId);
        
        if (!handler) {
            console.warn(`No handler for subscription ${subscriptionId}`);
            return;
        }

        // Next line should be the bookmark
        const bookmarkLine = await this.getNextLine();
        if (bookmarkLine) {
            try {
                const bookmark = JSON.parse(bookmarkLine);
                await handler.onBookmark(bookmark);
            } catch (error) {
                handler.onError(new Error(`Invalid bookmark format: ${bookmarkLine}`));
            }
        }
    }

    /**
     * Handle error control marker
     */
    private async handleError(line: string): Promise<void> {
        const subscriptionId = this.extractSubscriptionId(line, 'ERR');
        const handler = this.subscriptionHandlers.get(subscriptionId);
        
        if (!handler) {
            console.warn(`No handler for subscription ${subscriptionId}`);
            return;
        }

        const errorLine = await this.getNextLine();
        if (errorLine) {
            try {
                const errorMessage = JSON.parse(errorLine);
                handler.onError(new Error(errorMessage));
            } catch (error) {
                handler.onError(new Error(`Invalid error format: ${errorLine}`));
            }
        }
    }

    /**
     * Process accumulated Graph Protocol block
     */
    private async processGraphBlock(): Promise<void> {
        if (this.lineBuffer.length === 0) {
            return;
        }

        // Create a line reader from the buffer
        let lineIndex = 0;
        const readLine = async (): Promise<string | null> => {
            if (lineIndex >= this.lineBuffer.length) {
                return null;
            }
            return this.lineBuffer[lineIndex++];
        };

        // Create deserializer for this block
        const deserializer = new GraphDeserializer(readLine);
        
        // Process the block and send facts to all active subscriptions
        await deserializer.read(async (envelopes: FactEnvelope[]) => {
            // Send complete envelopes directly - this is the optimization
            for (const handler of this.subscriptionHandlers.values()) {
                await handler.onFactEnvelopes(envelopes);
            }
        });

        // Clear the buffer
        this.lineBuffer = [];
    }

    /**
     * Extract subscription ID from control marker
     */
    private extractSubscriptionId(line: string, prefix: string): string {
        return line.substring(prefix.length);
    }

    /**
     * Get next line (placeholder - in real implementation would be async)
     */
    private async getNextLine(): Promise<string | null> {
        // This is a simplified implementation
        // In practice, we'd need to handle the async nature of WebSocket data
        return null;
    }
}
```

### 3. WebSocket Client Implementation

```typescript
// src/http/webSocketClient.ts

import { FeedResponse } from './messages';
import { HttpHeaders } from './authenticationProvider';
import { Trace } from '../util/trace';
import { WebSocketGraphProtocolHandler, WebSocketSubscriptionHandler } from './webSocketGraphHandler';
import { FactEnvelope, FactReference } from '../storage';

export interface WebSocketClientConfig {
    reconnectMaxAttempts: number;
    reconnectBaseDelay: number;
    reconnectMaxDelay: number;
    pingInterval: number;
    pongTimeout: number;
    messageQueueMaxSize: number;
    subscriptionTimeout: number;
    enableLogging: boolean;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export class WebSocketClient {
    private ws: WebSocket | null = null;
    private connectionState: ConnectionState = 'disconnected';
    private protocolHandler = new WebSocketGraphProtocolHandler();
    private subscriptionCounter = 0;
    private activeSubscriptions = new Map<string, {
        feed: string;
        bookmark: string;
        cleanup: () => void;
    }>();
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private pingTimer: NodeJS.Timeout | null = null;
    private messageQueue: string[] = [];

    constructor(
        private readonly wsUrl: string,
        private readonly getHeaders: () => Promise<HttpHeaders>,
        private readonly config: WebSocketClientConfig
    ) {}

    /**
     * Create a new feed subscription using Graph Protocol
     */
    streamFeed(
        feed: string,
        bookmark: string,
        onEnvelope: (envelopes: FactEnvelope[]) => Promise<void>,
        onBookmark: (bookmark: string) => Promise<void>,
        onError: (err: Error) => void
    ): () => void {
        const subscriptionId = `sub_${++this.subscriptionCounter}_${Date.now()}`;
        
        // Create subscription handler that converts Graph Protocol to callbacks
        const handler: WebSocketSubscriptionHandler = {
            onFactEnvelopes: async (envelopes: FactEnvelope[]) => {
                await onEnvelope(envelopes);
            },
            onBookmark: async (newBookmark: string) => {
                bookmark = newBookmark;
                await onBookmark(newBookmark);
            },
            onError: (error: Error) => {
                onError(error);
            }
        };

        this.protocolHandler.addSubscription(subscriptionId, handler);
        
        // Store subscription info for reconnection
        const cleanup = () => {
            this.unsubscribe(subscriptionId);
        };
        
        this.activeSubscriptions.set(subscriptionId, {
            feed,
            bookmark,
            cleanup
        });

        // Ensure connection and send subscription
        this.ensureConnected().then(() => {
            this.sendSubscription(subscriptionId, feed, bookmark);
        }).catch(onError);

        // Return cleanup function
        return cleanup;
    }

    /**
     * Send subscription request using Graph Protocol format
     */
    private sendSubscription(subscriptionId: string, feed: string, bookmark: string): void {
        const message = `SUB${subscriptionId}\n"${feed}"\n"${bookmark}"\n\n`;
        this.sendMessage(message);
        this.log(`Sent subscription: ${subscriptionId} for feed: ${feed}`);
    }

    /**
     * Send message, queuing if not connected
     */
    private sendMessage(message: string): void {
        if (this.ws && this.connectionState === 'connected') {
            this.ws.send(message);
        } else {
            // Queue message for when connection is restored
            if (this.messageQueue.length < this.config.messageQueueMaxSize) {
                this.messageQueue.push(message);
            } else {
                this.log('Message queue full, dropping message');
            }
        }
    }

    /**
     * Unsubscribe from a feed
     */
    private unsubscribe(subscriptionId: string): void {
        this.protocolHandler.removeSubscription(subscriptionId);
        this.activeSubscriptions.delete(subscriptionId);

        if (this.ws && this.connectionState === 'connected') {
            const message = `UNSUB${subscriptionId}\n\n`;
            this.ws.send(message);
        }

        // Close connection if no active subscriptions
        if (this.activeSubscriptions.size === 0) {
            this.disconnect();
        }
    }

    /**
     * Ensure WebSocket connection is established
     */
    private async ensureConnected(): Promise<void> {
        if (this.connectionState === 'connected') {
            return;
        }

        if (this.connectionState === 'connecting' || this.connectionState === 'reconnecting') {
            return new Promise((resolve, reject) => {
                const checkConnection = () => {
                    if (this.connectionState === 'connected') {
                        resolve();
                    } else if (this.connectionState === 'failed' || this.connectionState === 'disconnected') {
                        reject(new Error('Connection failed'));
                    } else {
                        setTimeout(checkConnection, 100);
                    }
                };
                checkConnection();
            });
        }

        return this.connect();
    }

    /**
     * Establish WebSocket connection
     */
    private async connect(): Promise<void> {
        this.connectionState = 'connecting';
        this.log('Connecting to WebSocket...');

        try {
            const headers = await this.getHeaders();
            const wsUrl = this.buildWebSocketUrl(headers);
            this.ws = new WebSocket(wsUrl);

            return new Promise((resolve, reject) => {
                if (!this.ws) {
                    reject(new Error('WebSocket creation failed'));
                    return;
                }

                const connectionTimeout = setTimeout(() => {
                    reject(new Error('WebSocket connection timeout'));
                }, this.config.subscriptionTimeout);

                this.ws.onopen = () => {
                    clearTimeout(connectionTimeout);
                    this.connectionState = 'connected';
                    this.reconnectAttempts = 0;
                    this.log('WebSocket connected');
                    
                    this.startKeepAlive();
                    this.processQueuedMessages();
                    this.resubscribeAll();
                    
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data);
                };

                this.ws.onclose = (event) => {
                    clearTimeout(connectionTimeout);
                    this.handleDisconnection(event);
                };

                this.ws.onerror = (error) => {
                    clearTimeout(connectionTimeout);
                    this.log('WebSocket error:', error);
                    reject(new Error('WebSocket connection error'));
                };
            });
        } catch (error) {
            this.connectionState = 'failed';
            throw error;
        }
    }

    /**
     * Handle incoming WebSocket messages using Graph Protocol
     */
    private async handleMessage(data: string): Promise<void> {
        try {
            await this.protocolHandler.processData(data);
        } catch (error) {
            this.log('Error processing Graph Protocol data:', error);
        }
    }

    /**
     * Build WebSocket URL with authentication
     */
    private buildWebSocketUrl(headers: HttpHeaders): string {
        const url = new URL(this.wsUrl);
        
        if (headers.Authorization) {
            url.searchParams.set('auth', headers.Authorization);
        }
        
        return url.toString();
    }

    /**
     * Handle WebSocket disconnection
     */
    private handleDisconnection(event: CloseEvent): void {
        this.log('WebSocket disconnected:', event.code, event.reason);
        
        this.cleanup();
        
        if (event.code !== 1000 && this.activeSubscriptions.size > 0) {
            this.scheduleReconnect();
        } else {
            this.connectionState = 'disconnected';
        }
    }

    /**
     * Schedule reconnection with exponential backoff
     */
    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.config.reconnectMaxAttempts) {
            this.connectionState = 'failed';
            this.notifyAllSubscriptions(new Error('Max reconnection attempts exceeded'));
            return;
        }

        this.connectionState = 'reconnecting';
        this.reconnectAttempts++;
        
        const delay = Math.min(
            this.config.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts - 1),
            this.config.reconnectMaxDelay
        );

        this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        this.reconnectTimer = setTimeout(() => {
            this.connect().catch(error => {
                this.log('Reconnection failed:', error);
                this.scheduleReconnect();
            });
        }, delay);
    }

    /**
     * Process queued messages after reconnection
     */
    private processQueuedMessages(): void {
        while (this.messageQueue.length > 0 && this.ws && this.connectionState === 'connected') {
            const message = this.messageQueue.shift();
            if (message) {
                this.ws.send(message);
            }
        }
    }

    /**
     * Resubscribe to all active subscriptions after reconnection
     */
    private resubscribeAll(): void {
        this.log(`Resubscribing to ${this.activeSubscriptions.size} subscriptions`);
        
        for (const [subscriptionId, subscription] of this.activeSubscriptions) {
            this.sendSubscription(subscriptionId, subscription.feed, subscription.bookmark);
        }
    }

    /**
     * Start keep-alive ping mechanism
     */
    private startKeepAlive(): void {
        this.pingTimer = setInterval(() => {
            if (this.connectionState === 'connected' && this.ws) {
                const pingMessage = `PING\n${Date.now()}\n\n`;
                this.ws.send(pingMessage);
            }
        }, this.config.pingInterval);
    }

    /**
     * Notify all subscriptions of an error
     */
    private notifyAllSubscriptions(error: Error): void {
        for (const subscriptionId of this.activeSubscriptions.keys()) {
            const handler = this.protocolHandler['subscriptionHandlers']?.get?.(subscriptionId);
            if (handler) {
                handler.onError(error);
            }
        }
    }

    /**
     * Check if WebSocket is connected
     */
    isConnected(): boolean {
        return this.connectionState === 'connected';
    }

    /**
     * Get connection statistics
     */
    getStats(): {
        webSocketConnected: boolean;
        activeSubscriptions: number;
        reconnectAttempts: number;
    } {
        return {
            webSocketConnected: this.isConnected(),
            activeSubscriptions: this.activeSubscriptions.size,
            reconnectAttempts: this.reconnectAttempts
        };
    }

    /**
     * Disconnect WebSocket
     */
    private disconnect(): void {
        this.cleanup();
        
        if (this.ws) {
            this.ws.close(1000, 'Normal closure');
            this.ws = null;
        }
        
        this.connectionState = 'disconnected';
    }

    /**
     * Cleanup timers and resources
     */
    private cleanup(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * Log debug messages
     */
    private log(message: string, ...args: any[]): void {
        if (this.config.enableLogging) {
            Trace.info(`[WebSocketClient] ${message}`, ...args);
        }
    }

    /**
     * Cleanup all resources
     */
    destroy(): void {
        this.activeSubscriptions.clear();
        this.messageQueue = [];
        this.disconnect();
    }
}
```

### 4. WebSocketNetwork Implementation

```typescript
// src/http/webSocketNetwork.ts

import { HttpNetwork } from './httpNetwork';
import { WebSocketClient } from './webSocketClient';
import { WebClient } from './web-client';
import { FactEnvelope } from '../storage';

export class WebSocketNetwork extends HttpNetwork {
    constructor(
        webClient: WebClient,                    // For HTTP fallback operations
        private readonly webSocketClient: WebSocketClient,  // For WebSocket streaming
        private readonly enableFallback: boolean = true     // Allow HTTP fallback
    ) {
        super(webClient);
    }

    /**
     * Override streamFeed to use WebSocket instead of HTTP streaming
     * All other methods (feeds, fetchFeed, load) inherited from HttpNetwork
     */
    streamFeed(
        feed: string,
        bookmark: string,
        onEnvelope: (envelopes: FactEnvelope[]) => Promise<void>,
        onBookmark: (bookmark: string) => Promise<void>,
        onError: (err: Error) => void
    ): () => void {
        // Try WebSocket first
        try {
            return this.webSocketClient.streamFeed(feed, bookmark, onEnvelope, onBookmark, (error) => {
                if (this.enableFallback) {
                    // Fall back to HTTP streaming on WebSocket failure
                    console.warn('WebSocket streaming failed, falling back to HTTP:', error.message);
                    return super.streamFeed(feed, bookmark, onEnvelope, onBookmark, onError);
                } else {
                    onError(error);
                }
            });
        } catch (error) {
            if (this.enableFallback) {
                // Immediate fallback if WebSocket client unavailable
                console.warn('WebSocket client unavailable, using HTTP streaming:', error.message);
                return super.streamFeed(feed, bookmark, onEnvelope, onBookmark, onError);
            } else {
                onError(error);
                return () => {}; // No-op cleanup function
            }
        }
    }

    /**
     * Check if WebSocket connection is available
     */
    isWebSocketAvailable(): boolean {
        return this.webSocketClient.isConnected();
    }

    /**
     * Force fallback to HTTP streaming for testing or troubleshooting
     */
    forceHttpFallback(
        feed: string,
        bookmark: string,
        onEnvelope: (envelopes: FactEnvelope[]) => Promise<void>,
        onBookmark: (bookmark: string) => Promise<void>,
        onError: (err: Error) => void
    ): () => void {
        return super.streamFeed(feed, bookmark, onEnvelope, onBookmark, onError);
    }

    /**
     * Get connection statistics for monitoring
     */
    getConnectionStats(): {
        webSocketConnected: boolean;
        activeSubscriptions: number;
        reconnectAttempts: number;
    } {
        return this.webSocketClient.getStats();
    }

    /**
     * Cleanup WebSocket resources
     */
    destroy(): void {
        this.webSocketClient.destroy();
    }
}
```

## HttpNetwork Implementation Update

### Updated streamFeed Implementation

The existing `HttpNetwork` needs to be updated to use the new signature while maintaining the existing long polling behavior:

```typescript
// src/http/httpNetwork.ts - Updated implementation
export class HttpNetwork implements Network {
    // ... existing methods unchanged

    streamFeed(
        feed: string, 
        bookmark: string, 
        onEnvelope: (envelopes: FactEnvelope[]) => Promise<void>, 
        onBookmark: (bookmark: string) => Promise<void>, 
        onError: (err: Error) => void
    ): () => void {
        return this.webClient.streamFeed(feed, bookmark, async (response: FeedResponse) => {
            // Convert references to envelopes using existing load method
            if (response.references.length > 0) {
                try {
                    const envelopes = await this.load(response.references);
                    await onEnvelope(envelopes);
                } catch (error) {
                    onError(error);
                    return;
                }
            }
            
            // Handle bookmark updates
            await onBookmark(response.bookmark);
        }, onError);
    }
}
```

### Implementation Strategy

**Key Changes:**
1. **Signature Update**: Replace `onResponse` with separate `onEnvelope` and `onBookmark` callbacks
2. **Reference Conversion**: Use existing `load()` method to convert `FactReference[]` to `FactEnvelope[]`
3. **Callback Separation**: Split single response handling into separate envelope and bookmark processing
4. **Error Handling**: Wrap `load()` calls in try-catch to handle conversion errors

**Long Polling Behavior Preserved:**
- Underlying `WebClient.streamFeed()` continues to use HTTP streaming/long polling
- Polling intervals and reconnection logic remain unchanged
- Authentication and retry mechanisms preserved
- 4-minute refresh cycle maintained

**Performance Considerations:**
- **Additional Load Calls**: Each polling response now triggers a `load()` call to convert references to envelopes
- **Network Overhead**: Extra HTTP requests for fact loading, but provides complete envelope data
- **Caching Opportunity**: Store could cache recently loaded facts to reduce redundant loads
- **Efficiency Trade-off**: Slightly less efficient than WebSocket approach but maintains HTTP compatibility

## Enhanced Subscriber Logic

With the aligned Network interface signature, the Subscriber can now directly receive complete envelopes and process them efficiently:

```typescript
// src/observer/subscriber.ts - Enhanced implementation
export class Subscriber {
    // ... existing properties

    private connectToFeed(resolve: Function, reject: Function) {
        return this.network.streamFeed(this.feed, this.bookmark, async (envelopes: FactEnvelope[]) => {
            // Direct envelope processing - no conversion needed
            await this.processEnvelopes(envelopes, resolve);
        }, async (nextBookmark: string) => {
            // Handle bookmark updates
            await this.store.saveBookmark(this.feed, nextBookmark);
            this.bookmark = nextBookmark;
        }, reject);
    }

    private async processEnvelopes(envelopes: FactEnvelope[], resolve: Function) {
        if (envelopes.length === 0) {
            return;
        }

        // Filter out facts we already have
        const references = envelopes.map(e => ({ type: e.fact.type, hash: e.fact.hash }));
        const knownReferences = await this.store.whichExist(references);
        const unknownEnvelopes = envelopes.filter(e =>
            !knownReferences.some(ref => ref.hash === e.fact.hash && ref.type === e.fact.type)
        );

        if (unknownEnvelopes.length > 0) {
            // Save directly - envelopes already contain complete data
            await this.store.save(unknownEnvelopes);
            await this.notifyFactsAdded(unknownEnvelopes);
            Trace.counter("facts_saved", unknownEnvelopes.length);
        }

        if (!this.resolved) {
            this.resolved = true;
            resolve();
        }
    }
}
```

## Implementation Phases

### Phase 1: Core WebSocket Infrastructure
1. Implement `WebSocketClient` with basic connection management
2. Define WebSocket message protocol using Graph Protocol extensions
3. Implement subscription state management
4. Add basic error handling and logging

**Deliverables:**
- `src/http/webSocketClient.ts`
- `src/http/webSocketMessages.ts`
- `src/http/webSocketGraphHandler.ts`
- Basic unit tests

### Phase 2: Integration with Existing System
1. Implement `WebSocketNetwork` class extending `HttpNetwork`
2. Update `HttpNetwork` to use new `streamFeed` signature
3. Integrate with existing `NetworkManager`
4. Preserve existing HTTP fallback paths
5. Add configuration options

**Deliverables:**
- `src/http/webSocketNetwork.ts`
- Updated `src/http/httpNetwork.ts`
- Updated `src/jinaga-browser.ts`
- Configuration integration
- Integration tests

### Phase 3: Advanced Features
1. Implement reconnection logic with exponential backoff
2. Add keep-alive ping/pong mechanism
3. Implement message queuing during disconnection
4. Add comprehensive error recovery

**Deliverables:**
- Enhanced connection management
- Robust error handling
- Performance monitoring
- Stress testing

### Phase 4: Optimization Implementation
1. Update `Subscriber` to use enhanced envelope processing
2. Implement optimized Graph Protocol handler
3. Add performance monitoring and metrics
4. Optimize memory usage and connection handling

**Deliverables:**
- Optimized fact processing
- Performance benchmarks
- Monitoring dashboard
- Documentation updates

### Phase 5: Testing and Deployment
1. Unit tests for all WebSocket components
2. Integration tests with existing system
3. Performance testing and optimization
4. Documentation and examples

**Deliverables:**
- Comprehensive test suite
- Performance benchmarks
- Deployment guides
- Migration documentation

## Configuration Integration

### Browser Configuration

The network implementation is determined by the `JinagaBrowserConfig` settings, specifically the presence of `wsEndpoint` and `httpEndpoint` properties:

```typescript
// src/jinaga-browser.ts - Configuration-driven network creation
export type JinagaBrowserConfig = {
    httpEndpoint?: string,
    wsEndpoint?: string,
    webSocketConfig?: WebSocketClientConfig,
    // ... existing config options
}

function createNetwork(config: JinagaBrowserConfig, webClient: WebClient | null): Network {
    if (config.wsEndpoint && config.httpEndpoint && webClient) {
        // Both endpoints configured - create WebSocketNetwork with HTTP fallback
        const webSocketClient = new WebSocketClient(
            config.wsEndpoint,
            () => config.httpAuthenticationProvider?.getHeaders() || Promise.resolve({}),
            config.webSocketConfig || defaultWebSocketConfig
        );
        return new WebSocketNetwork(webClient, webSocketClient, true);
    } else if (config.httpEndpoint && webClient) {
        // Only HTTP endpoint configured - create HttpNetwork
        return new HttpNetwork(webClient);
    } else {
        // No endpoints configured or no webClient available - create NetworkNoOp
        return new NetworkNoOp();
    }
}

const defaultWebSocketConfig: WebSocketClientConfig = {
    reconnectMaxAttempts: 10,
    reconnectBaseDelay: 1000,
    reconnectMaxDelay: 30000,
    pingInterval: 30000,
    pongTimeout: 5000,
    messageQueueMaxSize: 1000,
    subscriptionTimeout: 10000,
    enableLogging: false
};
```

### Network Selection Logic

The network implementation selection follows this priority order:

1. **WebSocketNetwork**: Created when both `wsEndpoint` and `httpEndpoint` are configured and a valid `webClient` is available
   - Provides WebSocket streaming with automatic HTTP fallback
   - Requires both endpoints for full functionality
   - Uses WebSocket for `streamFeed` operations, HTTP for other operations

2. **HttpNetwork**: Created when only `httpEndpoint` is configured and a valid `webClient` is available
   - Provides HTTP-based streaming and operations
   - Maintains existing behavior for HTTP-only configurations
   - Uses long polling for `streamFeed` operations

3. **NetworkNoOp**: Created when no endpoints are configured or no `webClient` is available
   - Provides no-operation implementations for all network methods
   - Used in offline or testing scenarios
   - Returns empty results for all operations

### Configuration Examples

```typescript
// WebSocket with HTTP fallback
const configWithWebSocket: JinagaBrowserConfig = {
    httpEndpoint: 'https://api.example.com',
    wsEndpoint: 'wss://api.example.com/ws',
    // ... other options
};
// Results in: WebSocketNetwork

// HTTP only
const configHttpOnly: JinagaBrowserConfig = {
    httpEndpoint: 'https://api.example.com',
    // ... other options
};
// Results in: HttpNetwork

// Offline mode
const configOffline: JinagaBrowserConfig = {
    // No endpoints configured
    // ... other options
};
// Results in: NetworkNoOp
```

## Migration Strategy

### Development Phase
- WebSocket implementation developed alongside existing HTTP implementation
- Feature flag to enable/disable WebSocket usage
- Comprehensive testing in development environment

### Deployment Phase
- Gradual rollout with HTTP fallback
- Monitor connection stability and performance
- Rollback capability if issues detected

### Production Phase
- Full WebSocket deployment
- HTTP implementation maintained as fallback
- Performance monitoring and optimization

## Testing Strategy

### Unit Testing
```typescript
// Test WebSocket functionality
describe('WebSocketNetwork', () => {
    it('should use WebSocket for streaming when available', async () => {
        const webSocketNetwork = new WebSocketNetwork(mockWebClient, mockWebSocketClient, true);
        const cleanup = webSocketNetwork.streamFeed(feed, bookmark, onEnvelope, onBookmark, onError);
        
        expect(mockWebSocketClient.streamFeed).toHaveBeenCalled();
        expect(mockWebClient.streamFeed).not.toHaveBeenCalled();
    });
    
    it('should fall back to HTTP when WebSocket fails', async () => {
        mockWebSocketClient.streamFeed.mockImplementation((f, b, onE, onB, onErr) => {
            onErr(new Error('WebSocket connection failed'));
        });
        
        const webSocketNetwork = new WebSocketNetwork(mockWebClient, mockWebSocketClient, true);
        webSocketNetwork.streamFeed(feed, bookmark, onEnvelope, onBookmark, onError);
        
        expect(mockWebClient.streamFeed).toHaveBeenCalled();
    });
});
```

### Integration Testing
```typescript
// Test integration with existing system
describe('WebSocket Integration', () => {
    it('should integrate with NetworkManager', async () => {
        const networkManager = new NetworkManager(webSocketNetwork, store, notifyFactsAdded);
        const subscription = await networkManager.subscribe(feed, specification);
        
        expect(subscription).toBeDefined();
        expect(webSocketNetwork.streamFeed).toHaveBeenCalled();
    });
    
    it('should handle subscriber lifecycle', async () => {
        const subscriber = new Subscriber(feed, bookmark, webSocketNetwork, store, notifyFactsAdded);
        await subscriber.start();
        
        expect(subscriber.isResolved()).toBe(true);
    });
});
```

### Performance Testing
```typescript
// Test performance characteristics
describe('WebSocket Performance', () => {
    it('should handle multiple concurrent subscriptions', async () => {
        const subscriptions = [];
        for (let i = 0; i < 100; i++) {
            const cleanup = webSocketNetwork.streamFeed(
                `feed_${i}`, 
                'bookmark', 
                onEnvelope, 
                onBookmark, 
                onError
            );
            subscriptions.push(cleanup);
        }
        
        expect(webSocketClient.getStats().activeSubscriptions).toBe(100);
        
        // Cleanup
        subscriptions.forEach(cleanup => cleanup());
    });
    
    it('should maintain connection efficiency', async () => {
        const startTime = Date.now();
        const cleanup = webSocketNetwork.streamFeed(feed, bookmark, onEnvelope, onBookmark, onError);
        
        // Simulate fact delivery
        await simulateFactDelivery(100);
        
        const endTime = Date.now();
        expect(endTime - startTime).toBeLessThan(1000); // Should be fast
        
        cleanup();
    });
});
```

## Performance Benefits

### Eliminated Operations
- **Redundant HTTP Requests**: No more `network.load()` calls for WebSocket facts
- **Duplicate Data Transfer**: Facts transmitted once instead of twice
- **Processing Overhead**: Single deserialization instead of double

### Expected Improvements
- **Latency Reduction**: Eliminate network round-trip delays
- **Bandwidth Savings**: ~50% reduction in fact-related network traffic
- **Server Load**: Significant reduction in HTTP load endpoint usage
- **Client Responsiveness**: Immediate fact processing without load delays

### Scalability Benefits
- Single persistent connection vs multiple HTTP streams
- Reduced connection overhead
- Real-time fact delivery
- Efficient Graph Protocol serialization

## Backward Compatibility

### Client Compatibility
- **Old Clients**: Continue to work unchanged - only receive `references` in `FeedResponse`
- **New Clients**: Automatically use optimized path when WebSocket available
- **Mixed Environments**: New clients gracefully fall back when connecting to old servers

### Server Compatibility  
- **Old Servers**: Send only `references` - new clients handle this gracefully via HTTP fallback
- **New Servers**: Can send both HTTP and WebSocket streams for maximum compatibility
- **Protocol**: No wire protocol changes for HTTP - WebSocket uses Graph Protocol extensions

### Implementation Complexity

- Reuses existing Graph Protocol implementation
- Minimal new code required
- Well-defined protocol extensions
- Clear separation of concerns

This implementation plan leverages the existing, battle-tested Jinaga Graph Serialization Protocol while adding the minimal extensions needed for WebSocket-based feed streaming with bookmark management and optimized fact processing that eliminates redundant network operations.
