# WebSocket Implementation Plan

## Overview

This document provides the comprehensive implementation plan for WebSocket-based fact streaming using the Jinaga Graph Serialization Protocol. It consolidates the concrete implementation steps, code interfaces, protocol details, and optimization strategies needed to replace the current HTTP polling approach with an efficient WebSocket solution.

## Protocol Implementation Using Jinaga Graph Format

### Bookmark Control Markers

The Jinaga Graph Protocol will be extended with new control markers for bookmark management:

```
BM{subscriptionId}
"{bookmark}"

```

**Format:**
- Line 1: `BM` followed by subscription ID
- Line 2: JSON-encoded bookmark string  
- Line 3: Empty line separator

### WebSocket Message Structure

WebSocket messages will use the Jinaga Graph Protocol format with control markers for subscription management:

#### Subscription Request (Client → Server)
```
SUB{subscriptionId}
"{feed}"
"{bookmark}"

```

#### Subscription Response Stream (Server → Client)
```
# Facts using standard Jinaga Graph Protocol
PK0
"public-key-1"

"MyApp.BlogPost"
{}
{"title":"Hello World","content":"..."}
PK0
"signature-data"

"MyApp.Comment"
{"post":0}
{"text":"Great post!"}

# Bookmark update
BM{subscriptionId}
"bookmark_abc123"

# More facts...
"MyApp.Comment"
{"post":0}
{"text":"Thanks!"}

# Final bookmark
BM{subscriptionId}
"bookmark_def456"

```

#### Subscription Termination (Client → Server)
```
UNSUB{subscriptionId}

```

#### Error Response (Server → Client)
```
ERR{subscriptionId}
"{error_message}"

```

## Implementation Components

### WebSocket Message Types

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

// Enhanced FeedResponse to support both references and complete envelopes
export interface EnhancedFeedResponse {
    references?: FactReference[];  // Legacy: hash references only
    envelopes?: FactEnvelope[];    // Optimized: complete fact data
    bookmark: string;
}

// Server responses are handled via the Graph Protocol stream parser
// No separate message types needed - everything flows through the protocol
```

### WebSocket Graph Protocol Handler

```typescript
// src/http/webSocketGraphHandler.ts

import { GraphDeserializer } from './deserializer';
import { FactEnvelope } from '../storage';

export interface WebSocketSubscriptionHandler {
    onFacts: (facts: FactEnvelope[]) => Promise<void>;
    onEnvelopes?: (envelopes: FactEnvelope[]) => Promise<void>;  // Optimized path
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
            // Send complete envelopes to handlers that support optimization
            // Fall back to legacy onFacts for backward compatibility
            for (const handler of this.subscriptionHandlers.values()) {
                if (handler.onEnvelopes) {
                    // Optimized path: pass complete envelopes
                    await handler.onEnvelopes(envelopes);
                } else {
                    // Legacy path: maintain existing behavior
                    await handler.onFacts(envelopes);
                }
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

### WebSocket Client Implementation

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
    enableLogging: boolean;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export class WebSocketClient {
    private ws: WebSocket | null = null;
    private connectionState: ConnectionState = 'disconnected';
    private protocolHandler = new WebSocketGraphProtocolHandler();
    private subscriptionCounter = 0;
    private activeSubscriptions = new Set<string>();
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private pingTimer: NodeJS.Timeout | null = null;

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
        onResponse: (response: FeedResponse) => Promise<void>,
        onError: (err: Error) => void
    ): () => void {
        const subscriptionId = `sub_${++this.subscriptionCounter}_${Date.now()}`;
        
        // Create subscription handler that converts Graph Protocol to FeedResponse
        const handler: WebSocketSubscriptionHandler = {
            // Optimized path: use complete envelopes when available
            onEnvelopes: async (envelopes: FactEnvelope[]) => {
                // Pass complete envelopes for efficient processing
                const enhancedResponse: EnhancedFeedResponse = {
                    envelopes,
                    bookmark
                };
                await onResponse(enhancedResponse as FeedResponse);
            },
            // Legacy fallback: convert to references for backward compatibility
            onFacts: async (facts: FactEnvelope[]) => {
                // Convert FactEnvelopes to FactReferences for legacy FeedResponse
                const references: FactReference[] = facts.map(envelope => ({
                    type: envelope.fact.type,
                    hash: envelope.fact.hash
                }));
                
                await onResponse({ references, bookmark });
            },
            onBookmark: async (newBookmark: string) => {
                bookmark = newBookmark;
                // Send empty fact batch with updated bookmark
                await onResponse({ references: [], bookmark: newBookmark });
            },
            onError: (error: Error) => {
                onError(error);
            }
        };

        this.protocolHandler.addSubscription(subscriptionId, handler);
        this.activeSubscriptions.add(subscriptionId);

        // Ensure connection and send subscription
        this.ensureConnected().then(() => {
            this.sendSubscription(subscriptionId, feed, bookmark);
        }).catch(onError);

        // Return cleanup function
        return () => {
            this.unsubscribe(subscriptionId);
        };
    }

    /**
     * Send subscription request using Graph Protocol format
     */
    private sendSubscription(subscriptionId: string, feed: string, bookmark: string): void {
        if (this.ws && this.connectionState === 'connected') {
            const message = `SUB${subscriptionId}\n"${feed}"\n"${bookmark}"\n\n`;
            this.ws.send(message);
            this.log(`Sent subscription: ${subscriptionId} for feed: ${feed}`);
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
                }, 10000);

                this.ws.onopen = () => {
                    clearTimeout(connectionTimeout);
                    this.connectionState = 'connected';
                    this.reconnectAttempts = 0;
                    this.log('WebSocket connected');
                    
                    this.startKeepAlive();
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
     * Resubscribe to all active subscriptions after reconnection
     */
    private resubscribeAll(): void {
        // Note: In a real implementation, we'd need to track feed and bookmark
        // for each subscription to properly resubscribe
        this.log(`Resubscribing to ${this.activeSubscriptions.size} subscriptions`);
        // Implementation would iterate through active subscriptions and resend SUB messages
    }

    /**
     * Start keep-alive ping mechanism
     */
    private startKeepAlive(): void {
        this.pingTimer = setInterval(() => {
            if (this.connectionState === 'connected' && this.ws) {
                // Send ping using Graph Protocol format
                const pingMessage = `PING\n${Date.now()}\n\n`;
                this.ws.send(pingMessage);
            }
        }, this.config.pingInterval);
    }

    /**
     * Notify all subscriptions of an error
     */
    private notifyAllSubscriptions(error: Error): void {
        for (const subscriptionId of this.activeSubscriptions) {
            const handler = this.protocolHandler.subscriptionHandlers?.get?.(subscriptionId);
            if (handler) {
                handler.onError(error);
            }
        }
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
        this.disconnect();
    }
}
```

## Optimization Strategies

### Enhanced FeedResponse Interface

Extend the existing `FeedResponse` interface to optionally include complete envelopes:

```typescript
// src/http/messages.ts - Simple extension
export interface FeedResponse {
    references: FactReference[];
    bookmark: string;
    envelopes?: FactEnvelope[];  // NEW: Complete fact data when available
}
```

### Enhanced WebSocket Subscription Handler

Modify the `WebSocketSubscriptionHandler` to support both optimized and legacy paths:

```typescript
// src/http/webSocketGraphHandler.ts - Add optional optimized callback
export interface WebSocketSubscriptionHandler {
    onFacts: (facts: FactEnvelope[]) => Promise<void>;
    onEnvelopes?: (envelopes: FactEnvelope[]) => Promise<void>;  // NEW: Optimized path
    onBookmark: (bookmark: string) => Promise<void>;
    onError: (error: Error) => void;
}
```

### WebSocket Client Optimization

Update the `WebSocketClient.streamFeed()` method:

```typescript
// src/http/webSocketClient.ts - Enhanced subscription handler
const handler: WebSocketSubscriptionHandler = {
    // NEW: Optimized path - use complete envelopes
    onEnvelopes: async (envelopes: FactEnvelope[]) => {
        await onResponse({ 
            references: envelopes.map(e => ({ type: e.fact.type, hash: e.fact.hash })),
            envelopes,  // Include complete data
            bookmark 
        });
    },
    // EXISTING: Legacy fallback
    onFacts: async (facts: FactEnvelope[]) => {
        const references = facts.map(envelope => ({
            type: envelope.fact.type,
            hash: envelope.fact.hash
        }));
        await onResponse({ references, bookmark });
    },
    // ... rest unchanged
};
```

### Graph Protocol Handler Update

Modify `WebSocketGraphProtocolHandler.processGraphBlock()`:

```typescript
// src/http/webSocketGraphHandler.ts - Use optimized path when available
await deserializer.read(async (envelopes: FactEnvelope[]) => {
    for (const handler of this.subscriptionHandlers.values()) {
        if (handler.onEnvelopes) {
            // NEW: Optimized path - pass complete envelopes
            await handler.onEnvelopes(envelopes);
        } else {
            // EXISTING: Legacy path - maintain compatibility
            await handler.onFacts(envelopes);
        }
    }
});
```

### Subscriber Enhancement

Enhance `Subscriber.connectToFeed()` to detect and use complete envelopes:

```typescript
// src/observer/subscriber.ts - Detect optimized responses
return this.network.streamFeed(this.feed, this.bookmark, async (factReferences, nextBookmark) => {
    // Access the original response to check for envelopes
    const response = arguments[2] as FeedResponse; // Third argument is the full response
    
    if (response?.envelopes) {
        // OPTIMIZED: Process complete envelopes directly
        const references = response.envelopes.map(e => ({ type: e.fact.type, hash: e.fact.hash }));
        const knownReferences = await this.store.whichExist(references);
        const unknownEnvelopes = response.envelopes.filter(e => 
            !knownReferences.some(ref => ref.hash === e.fact.hash && ref.type === e.fact.type)
        );
        
        if (unknownEnvelopes.length > 0) {
            // Save directly - no load() needed!
            await this.store.save(unknownEnvelopes);
            await this.store.saveBookmark(this.feed, nextBookmark);
            this.bookmark = nextBookmark;
            await this.notifyFactsAdded(unknownEnvelopes);
            Trace.counter("facts_saved", unknownEnvelopes.length);
        }
    } else {
        // LEGACY: Existing reference-based processing unchanged
        const knownFactReferences = await this.store.whichExist(factReferences);
        const unknownFactReferences = factReferences.filter(fr => !knownFactReferences.includes(fr));
        if (unknownFactReferences.length > 0) {
            const graph = await this.network.load(unknownFactReferences); // Still needed for legacy
            await this.store.save(graph);
            // ... rest of existing logic
        }
    }
    
    if (!this.resolved) {
        this.resolved = true;
        resolve();
    }
}, err => {
    // ... existing error handling
});
```

## Server-Side Protocol Implementation

### WebSocket Server Graph Protocol Handler

```typescript
// Server-side implementation (for reference)

export class WebSocketServerGraphHandler {
    private subscriptions = new Map<string, {
        feed: string;
        bookmark: string;
        connection: WebSocket;
    }>();

    handleSubscription(ws: WebSocket, subscriptionId: string, feed: string, bookmark: string): void {
        this.subscriptions.set(subscriptionId, { feed, bookmark, connection: ws });
        
        // Start streaming facts for this feed
        this.streamFeed(subscriptionId, feed, bookmark);
    }

    private async streamFeed(subscriptionId: string, feed: string, bookmark: string): Promise<void> {
        const subscription = this.subscriptions.get(subscriptionId);
        if (!subscription) return;

        // Get facts from feed starting at bookmark
        const facts = await this.getFeedFacts(feed, bookmark);
        
        if (facts.length > 0) {
            // Serialize facts using Graph Protocol
            const serializer = new GraphSerializer((chunk: string) => {
                subscription.connection.send(chunk);
            });
            
            serializer.serialize(facts);
            
            // Send bookmark update
            const newBookmark = this.getNextBookmark(feed, facts);
            const bookmarkMessage = `BM${subscriptionId}\n"${newBookmark}"\n\n`;
            subscription.connection.send(bookmarkMessage);
        }
    }

    handleUnsubscription(subscriptionId: string): void {
        this.subscriptions.delete(subscriptionId);
    }

    private async getFeedFacts(feed: string, bookmark: string): Promise<FactEnvelope[]> {
        // Implementation would fetch facts from storage
        return [];
    }

    private getNextBookmark(feed: string, facts: FactEnvelope[]): string {
        // Implementation would compute next bookmark
        return 'next_bookmark';
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
1. Implement `WebSocketNetwork` class
2. Integrate with existing `NetworkManager`
3. Preserve existing HTTP fallback paths
4. Add configuration options

**Deliverables:**
- `src/http/webSocketNetwork.ts`
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
1. Implement enhanced `FeedResponse` interface
2. Add envelope-based processing to `Subscriber`
3. Implement optimized Graph Protocol handler
4. Add performance monitoring and metrics

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

## Protocol Benefits

### Advantages of Using Graph Protocol

1. **Consistency**: Same serialization format used for HTTP and WebSocket
2. **Efficiency**: Optimized binary-like text format with deduplication
3. **Streaming**: Built-in support for incremental processing
4. **Signatures**: Cryptographic integrity maintained
5. **Extensibility**: Control markers allow protocol extensions

### Bookmark Integration

1. **Seamless**: Bookmarks flow naturally with fact streams
2. **Efficient**: No separate message overhead
3. **Reliable**: Bookmark updates are ordered with fact delivery
4. **Compatible**: Existing bookmark logic unchanged

## Performance Improvements

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
- **New Clients**: Automatically use optimized path when `envelopes` are available
- **Mixed Environments**: New clients gracefully fall back when connecting to old servers

### Server Compatibility  
- **Old Servers**: Send only `references` - new clients handle this gracefully
- **New Servers**: Can send both `references` and `envelopes` for maximum compatibility
- **Protocol**: No wire protocol changes - optimization is purely client-side processing

### Implementation Complexity

- Reuses existing Graph Protocol implementation
- Minimal new code required
- Well-defined protocol extensions
- Clear separation of concerns

This implementation plan leverages the existing, battle-tested Jinaga Graph Serialization Protocol while adding the minimal extensions needed for WebSocket-based feed streaming with bookmark management and optimized fact processing that eliminates redundant network operations.