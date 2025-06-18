# WebSocket Network Architecture

## Overview

This document outlines the comprehensive design for replacing the current HTTP polling-based `streamFeed` implementation with a WebSocket-based approach that maintains a single persistent connection while supporting multiple concurrent subscriptions. The implementation uses the existing Jinaga Graph Serialization Protocol with minimal extensions for bookmark management and includes critical analysis of inefficiency patterns and architectural solutions.

## Current Architecture Analysis

### Current HTTP Implementation
- **HttpNetwork**: Implements the `Network` interface, delegates to `WebClient`
- **WebClient**: Handles HTTP requests and streaming via `HttpConnection`
- **FetchConnection**: Uses fetch API with streaming responses (`application/x-jinaga-feed-stream`)
- **Subscriber**: Manages individual feed subscriptions with 4-minute reconnection intervals
- **NetworkManager**: Coordinates multiple subscribers and manages feed lifecycle

### Current Data Flow
1. `NetworkManager.subscribe()` creates `Subscriber` instances for each feed
2. `Subscriber.start()` calls `Network.streamFeed()` 
3. `HttpNetwork.streamFeed()` delegates to `WebClient.streamFeed()`
4. `WebClient.streamFeed()` calls `HttpConnection.getStream()`
5. `FetchConnection.getStream()` establishes HTTP streaming connection
6. JSON responses are parsed line-by-line and passed to `onResponse` callback
7. Connection is refreshed every 4 minutes to prevent timeouts

### Current Message Format
- HTTP streaming uses `application/x-jinaga-feed-stream` content type
- Each line contains a JSON-encoded `FeedResponse`: `{references: FactReference[], bookmark: string}`
- Empty lines are ignored
- Connection includes authentication headers

## Critical Inefficiency Analysis

### Root Cause: Interface Mismatch
The current WebSocket implementation plan contains a critical inefficiency where complete fact data transmitted via the Jinaga Graph Protocol is being discarded in favor of hash-based references, which then triggers redundant `load()` calls to retrieve the same fact data that was already available.

#### Current Inefficient Data Flow
```
1. WebSocket → Jinaga Graph Protocol → GraphDeserializer
2. GraphDeserializer → FactEnvelope[] (COMPLETE FACT DATA)
3. WebSocketSubscriptionHandler.onFacts() → DISCARDS fact data
4. Converts FactEnvelope[] → FactReference[] (hash + type only)
5. Passes FactReference[] to existing Subscriber logic
6. store.whichExist(references) → filters unknown facts
7. network.load(unknownReferences) → REDUNDANT CALL for data we already had
8. store.save(envelopes) → persists facts retrieved redundantly
```

#### Performance Impact
- **Redundant HTTP Requests**: Each `network.load()` call creates additional HTTP requests
- **Duplicate Data Transfer**: Facts are transmitted twice (WebSocket + HTTP load)
- **Connection Overhead**: Additional HTTP connections for load operations
- **Processing Overhead**: Facts deserialized twice, signature verification performed twice
- **Latency Impact**: Additional round trips and blocking operations

## WebSocket Architecture Design

### Core Components

#### 1. WebSocketNetwork (New) - Extends HttpNetwork

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

### WebSocketNetwork Design Benefits

**1. Inheritance Strategy:**
- **Code Reuse**: Inherits `feeds()`, `fetchFeed()`, and `load()` methods from `HttpNetwork`
- **Proven Logic**: Reuses existing HTTP authentication, error handling, and retry mechanisms
- **Minimal Implementation**: Only `streamFeed()` method needs to be overridden

**2. Graceful Fallback:**
- **Automatic Fallback**: WebSocket failures automatically fall back to HTTP streaming via `super.streamFeed()`
- **Configurable Behavior**: Fallback can be enabled/disabled via constructor parameter
- **Transparent Operation**: Callers don't need to handle fallback logic

**3. Operational Features:**
- **Connection Monitoring**: `isWebSocketAvailable()` and `getConnectionStats()` for health checks
- **Testing Support**: `forceHttpFallback()` allows testing HTTP path even when WebSocket available
- **Resource Management**: `destroy()` method for proper cleanup

**4. Interface Compatibility:**
- **Drop-in Replacement**: Implements same `Network` interface as `HttpNetwork`
- **No Code Changes**: Existing `NetworkManager` and `Subscriber` code works unchanged
- **Configuration-Driven**: Can be swapped in via configuration

#### 2. WebSocketClient (New)
```typescript
export class WebSocketClient {
    private ws: WebSocket | null = null;
    private connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' = 'disconnected';
    private subscriptions = new Map<string, WebSocketSubscription>();
    private messageQueue: WebSocketMessage[] = [];
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    
    constructor(
        private readonly wsUrl: string,
        private readonly getHeaders: () => Promise<HttpHeaders>,
        private readonly config: WebSocketClientConfig
    ) {}

    // Connection lifecycle
    private async connect(): Promise<void>
    private disconnect(): void
    private reconnect(): void
    
    // Subscription management
    streamFeed(feed: string, bookmark: string, onEnvelope: (envelopes: FactEnvelope[]) => Promise<void>, onBookmark: (bookmark: string) => Promise<void>, onError: (err: Error) => void): () => void
    private subscribe(subscription: WebSocketSubscription): void
    private unsubscribe(subscriptionId: string): void
    
    // Message handling
    private sendMessage(message: WebSocketMessage): void
    private handleMessage(data: string): void
    private processQueuedMessages(): void
}
```

#### 3. WebSocket Protocol Using Jinaga Graph Format

The WebSocket implementation uses the existing Jinaga Graph Serialization Protocol with control marker extensions:

##### Protocol Extensions
```
# Subscription request (Client → Server)
SUB{subscriptionId}
"{feed}"
"{bookmark}"

# Bookmark update (Server → Client)
BM{subscriptionId}
"{bookmark}"

# Unsubscribe (Client → Server)
UNSUB{subscriptionId}

# Error (Server → Client)
ERR{subscriptionId}
"{error_message}"

# Ping/Pong for keep-alive
PING
{timestamp}

PONG
{timestamp}
```

##### Fact Streaming Format
Server responses use standard Jinaga Graph Protocol:
```
# Public key declarations
PK0
"public-key-string"

# Fact blocks
"MyApp.BlogPost"
{}
{"title":"Hello World"}
PK0
"signature-data"

# Bookmark after fact batch
BM{subscriptionId}
"bookmark_abc123"

# More facts...
"MyApp.Comment"
{"post":0}
{"text":"Great post!"}

# Final bookmark
BM{subscriptionId}
"bookmark_def456"
```

#### 4. WebSocket Graph Protocol Handler
```typescript
interface WebSocketSubscriptionHandler {
    onFacts: (facts: FactEnvelope[]) => Promise<void>;
    onBookmark: (bookmark: string) => Promise<void>;
    onError: (error: Error) => void;
}

class WebSocketGraphProtocolHandler {
    private subscriptionHandlers = new Map<string, WebSocketSubscriptionHandler>();
    private deserializer: GraphDeserializer;
    
    addSubscription(subscriptionId: string, handler: WebSocketSubscriptionHandler): void;
    removeSubscription(subscriptionId: string): void;
    processData(data: string): Promise<void>;
}
```

### Connection Lifecycle Management

#### Connection Establishment
1. WebSocket connection established on first `streamFeed` call
2. Authentication handled via WebSocket subprotocols or initial message
3. Connection state tracked and managed centrally
4. Failed connections trigger exponential backoff reconnection

#### Subscription Management
1. Each `streamFeed` call creates a unique subscription ID
2. Subscribe message sent to server with feed and bookmark
3. Server responses correlated via subscription ID
4. Unsubscribe message sent when stream is closed
5. Connection closed only when all subscriptions terminated

#### Reconnection Strategy
1. Automatic reconnection on connection loss
2. Exponential backoff: 1s, 2s, 4s, 8s, max 30s
3. Resubscribe to all active feeds after reconnection
4. Maintain subscription state during reconnection
5. Error callbacks triggered if reconnection fails permanently

### Message Flow

#### Subscription Flow
```
Client                          Server
  |                               |
  |-- Subscribe(feed, bookmark) ->|
  |                               |
  |<-- FeedData(refs, bookmark) --|
  |<-- FeedData(refs, bookmark) --|
  |<-- Bookmark(bookmark) --------|  (periodic bookmark updates)
  |                               |
  |-- Unsubscribe(subscriptionId) |
  |                               |
```

#### Error Handling Flow
```
Client                          Server
  |                               |
  |-- SUB{id}                   ->|
  |    "{feed}"                   |
  |    "{bookmark}"               |
  |                               |
  |<-- ERR{id}                 ---|
  |    "Invalid bookmark"         |
  |                               |
  (onError callback triggered)
```

#### Reconnection Flow
```
Client                          Server
  |                               |
  (connection lost)
  |                               |
  |-- Reconnect ---------------->|
  |-- SUB{id1}                   |
  |    "{feed1}" "{bookmark1}"   |
  |-- SUB{id2}                   |
  |    "{feed2}" "{bookmark2}"   |
  |                               |
  |<-- Graph Protocol Facts -----|
```

### Thread Safety and Concurrency

#### Subscription State Management
- All subscription operations synchronized via internal locks
- Subscription map protected against concurrent access
- Message queue thread-safe for concurrent producers

#### Connection State Management
- Connection state changes atomic
- Reconnection logic prevents multiple concurrent attempts
- Message sending queued during disconnected states

#### Callback Execution
- Response callbacks executed asynchronously
- Error callbacks isolated to prevent cascading failures
- Subscription cleanup guaranteed even on callback exceptions

### Configuration

```typescript
interface WebSocketClientConfig {
    // Connection settings
    reconnectMaxAttempts: number;        // Default: 10
    reconnectBaseDelay: number;          // Default: 1000ms
    reconnectMaxDelay: number;           // Default: 30000ms
    
    // Keep-alive settings
    pingInterval: number;                // Default: 30000ms
    pongTimeout: number;                 // Default: 5000ms
    
    // Message settings
    messageQueueMaxSize: number;         // Default: 1000
    subscriptionTimeout: number;         // Default: 10000ms
}
```

### Error Handling

#### Connection Errors
- Network failures trigger reconnection
- Authentication failures reported to all subscriptions
- Protocol errors close connection and report to subscriptions

#### Subscription Errors
- Invalid feed/bookmark reported to specific subscription
- Server-side errors mapped to subscription callbacks
- Timeout errors trigger subscription cleanup

#### Message Errors
- Malformed messages logged and ignored
- Unknown message types logged and ignored
- Correlation failures for subscription messages logged

### Backward Compatibility

#### Graceful Fallback
- HTTP operations (`feeds`, `fetchFeed`, `load`) remain unchanged
- WebSocket failures can fall back to HTTP streaming
- Configuration option to disable WebSocket and use HTTP only

#### API Preservation
- `Network` interface unchanged
- `streamFeed` method signature preserved
- Existing callback patterns maintained

### Performance Considerations

#### Memory Management
- Subscription cleanup prevents memory leaks
- Message queue bounded to prevent unbounded growth
- Connection resources properly released

#### Network Efficiency
- Single persistent connection vs multiple HTTP streams
- Reduced connection overhead and latency
- Efficient binary or compressed message encoding possible

#### Scalability
- Connection pooling not needed (single connection)
- Subscription multiplexing over single connection
- Server-side connection management simplified

## Optimized Fact Processing Architecture

### Enhanced Subscriber Logic

With the aligned Network interface signature, the Subscriber can now directly receive complete envelopes and process them efficiently:

```typescript
// Enhanced Subscriber implementation with new Network interface
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

### Architectural Solutions for Inefficiency

#### Enhanced Interface Design
```typescript
// Enhanced subscription handler interface
interface WebSocketSubscriptionHandler {
    onFacts?: (facts: FactReference[]) => Promise<void>;      // Legacy
    onFactEnvelopes?: (envelopes: FactEnvelope[]) => Promise<void>; // New efficient path
    onBookmark: (bookmark: string) => Promise<void>;
    onError: (error: Error) => void;
}
```

#### Optimized Protocol Handler
```typescript
export class WebSocketGraphProtocolHandler {
    private async processGraphBlock(): Promise<void> {
        if (this.lineBuffer.length === 0) {
            return;
        }

        const deserializer = new GraphDeserializer(this.createLineReader());
        
        await deserializer.read(async (envelopes: FactEnvelope[]) => {
            // Send complete envelopes instead of just references
            for (const [subscriptionId, handler] of this.subscriptionHandlers) {
                if (handler.onFactEnvelopes) {
                    // New efficient path - pass complete envelopes
                    await handler.onFactEnvelopes(envelopes);
                } else {
                    // Legacy path - convert to references (maintains compatibility)
                    const references = envelopes.map(e => ({
                        type: e.fact.type,
                        hash: e.fact.hash
                    }));
                    await handler.onFacts(references);
                }
            }
        });

        this.lineBuffer = [];
    }
}
```

### Backward Compatibility Strategy

The enhanced implementation maintains full backward compatibility:

1. **Legacy Clients**: Continue to work unchanged using reference-based processing
2. **Legacy Servers**: WebSocket clients gracefully fall back to HTTP when WebSocket unavailable
3. **Mixed Environments**: New clients work with old servers, old clients work with new servers
4. **Gradual Migration**: Components can be upgraded independently

### Performance Benefits

With the optimized envelope processing:

- **Eliminate Redundant Loads**: No `network.load()` calls for WebSocket-delivered facts
- **Reduce Network Traffic**: Facts transmitted once instead of twice
- **Faster Processing**: Immediate fact availability without round-trip delays
- **Lower Server Load**: Fewer HTTP load requests to handle

## HttpNetwork Long Polling Implementation

### Current Implementation Analysis

The existing `HttpNetwork` class already implements long polling through its delegation to `WebClient.streamFeed()`. The current implementation needs to be updated to use the new signature while preserving the existing long polling behavior.

### Updated HttpNetwork Implementation

```typescript
// src/http/httpNetwork.ts - Updated to use new streamFeed signature
export class HttpNetwork implements Network {
    constructor(private readonly webClient: WebClient) {}

    // ... existing methods unchanged (feeds, fetchFeed, load)

    streamFeed(
        feed: string, 
        bookmark: string, 
        onEnvelope: (envelopes: FactEnvelope[]) => Promise<void>, 
        onBookmark: (bookmark: string) => Promise<void>, 
        onError: (err: Error) => void
    ): () => void {
        return this.webClient.streamFeed(feed, bookmark, async (response: FeedResponse) => {
            // Handle fact references by converting to envelopes
            if (response.references.length > 0) {
                try {
                    // Use existing load method to convert references to envelopes
                    const envelopes = await this.load(response.references);
                    await onEnvelope(envelopes);
                } catch (error) {
                    onError(error);
                    return; // Skip bookmark update on load failure
                }
            }
            
            // Handle bookmark updates separately
            await onBookmark(response.bookmark);
        }, onError);
    }
}
```

### Long Polling Behavior Preservation

**Existing Long Polling Characteristics Maintained:**
- **HTTP Streaming**: Underlying `WebClient.streamFeed()` continues to use HTTP streaming connections
- **4-Minute Refresh Cycle**: Periodic reconnection logic preserved
- **Authentication Handling**: Existing auth mechanisms remain unchanged
- **Retry Logic**: WebClient retry strategies continue to function
- **Error Recovery**: Existing error handling patterns maintained

**Key Implementation Details:**
1. **Reference to Envelope Conversion**: Each `FeedResponse` with references triggers a `load()` call
2. **Separate Callback Handling**: Envelope and bookmark data flow through dedicated callbacks
3. **Error Isolation**: Load failures don't prevent bookmark updates from being processed
4. **Backward Compatibility**: Underlying WebClient interface remains unchanged

### Performance Impact Analysis

**Additional Network Operations:**
- **Extra Load Calls**: Each polling response now requires a `load()` HTTP request
- **Increased Latency**: Additional round-trip for fact loading
- **Higher Server Load**: More HTTP requests per feed subscription

**Mitigation Strategies:**
- **Store Caching**: Implement fact caching in storage layer to reduce redundant loads
- **Batch Loading**: Group multiple reference loads when possible
- **Smart Filtering**: Only load facts that aren't already in local storage

**Trade-off Assessment:**
- **Consistency**: Provides same interface as WebSocket implementation
- **Compatibility**: Maintains HTTP-based connectivity for environments without WebSocket support
- **Efficiency**: Less efficient than WebSocket but more compatible than pure streaming

## Minimal Architectural Changes

### Files to Create
- `src/http/webSocketClient.ts` - Core WebSocket client implementation
- `src/http/webSocketNetwork.ts` - WebSocket-based Network implementation
- `src/http/webSocketMessages.ts` - WebSocket message type definitions
- `src/http/webSocketGraphHandler.ts` - Graph protocol handler for WebSocket

### Files to Modify
- `src/http/httpNetwork.ts` - Update streamFeed signature and implementation
- `src/jinaga.ts` - Add WebSocket configuration options
- `src/jinaga-browser.ts` - Wire up WebSocket network implementation
- `src/observer/subscriber.ts` - Add envelope processing optimization
- Configuration files to support WebSocket URL and options

### Files Unchanged
- `src/managers/NetworkManager.ts` - Network interface updated but core logic unchanged
- `src/http/web-client.ts` - WebClient interface remains unchanged
- All existing HTTP implementation files preserved for fallback

This architecture preserves the existing `streamFeed` API contract while providing a more efficient WebSocket-based implementation with robust connection management, error handling, and optimized fact processing that eliminates redundant network operations.
