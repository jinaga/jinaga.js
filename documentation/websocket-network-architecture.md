# WebSocket Network Architecture

## Overview

This document outlines the design for the WebSocket-based fact streaming system that will replace HTTP polling with a single persistent connection supporting multiple concurrent subscriptions. The implementation uses the Jinaga Graph Serialization Protocol with minimal extensions for bookmark management and optimized fact processing.

## System Architecture

### Core Components

#### WebSocketNetwork
The primary network implementation that extends HttpNetwork for backward compatibility while providing WebSocket-based streaming:

- **Inheritance Strategy**: Extends HttpNetwork to reuse HTTP operations (`feeds`, `fetchFeed`, `load`)
- **WebSocket Streaming**: Overrides `streamFeed` to use WebSocket instead of HTTP polling
- **Graceful Fallback**: Automatically falls back to HTTP when WebSocket unavailable
- **Resource Management**: Manages WebSocket lifecycle and cleanup

#### WebSocketClient
Manages the persistent WebSocket connection and subscription multiplexing:

- **Connection Management**: Establishes and maintains single WebSocket connection
- **Subscription Multiplexing**: Routes multiple feed subscriptions over single connection
- **Reconnection Logic**: Handles connection failures with exponential backoff
- **Message Queuing**: Buffers messages during disconnection periods

#### WebSocket Graph Protocol Handler
Processes incoming WebSocket data using the Jinaga Graph Protocol:

- **Protocol Processing**: Parses Graph Protocol streams with control marker extensions
- **Subscription Routing**: Routes facts and bookmarks to appropriate subscription handlers
- **Envelope Optimization**: Delivers complete FactEnvelopes directly to avoid redundant loads

### Protocol Design

#### WebSocket Protocol Extensions
The system extends the Jinaga Graph Protocol with control markers for subscription management:

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

# Error response (Server → Client)
ERR{subscriptionId}
"{error_message}"

# Keep-alive messages
PING
{timestamp}

PONG
{timestamp}
```

#### Fact Streaming Format
Server responses use standard Jinaga Graph Protocol with interspersed bookmark updates:

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

# More facts continue...
"MyApp.Comment"
{"post":0}
{"text":"Great post!"}

# Final bookmark
BM{subscriptionId}
"bookmark_def456"
```

### Connection Lifecycle

#### Connection Establishment
1. WebSocket connection established on first subscription request
2. Authentication handled via WebSocket subprotocols or query parameters
3. Connection state tracked and managed centrally
4. Failed connections trigger exponential backoff reconnection

#### Subscription Management
1. Each `streamFeed` call creates unique subscription with generated ID
2. Subscribe message sent with feed specification and bookmark
3. Server responses correlated via subscription ID in control markers
4. Unsubscribe message sent when stream cleanup function called
5. Connection maintained until all subscriptions terminated

#### Reconnection Strategy
1. Automatic reconnection on unexpected connection loss
2. Exponential backoff: 1s, 2s, 4s, 8s, maximum 30s intervals
3. Automatic resubscription to all active feeds after reconnection
4. Subscription state preserved during reconnection periods
5. Error callbacks triggered if reconnection fails permanently

### Message Flow Patterns

#### Subscription Flow
```
Client                          Server
  |                               |
  |-- SUB{id}                   ->|
  |    "{feed}"                   |
  |    "{bookmark}"               |
  |                               |
  |<-- Graph Protocol Facts -----|
  |<-- BM{id} "bookmark1" -------|
  |<-- More Facts ---------------|
  |<-- BM{id} "bookmark2" -------|
  |                               |
  |-- UNSUB{id} ---------------->|
```

#### Error Handling Flow
```
Client                          Server
  |                               |
  |-- SUB{id}                   ->|
  |    "{invalid_feed}"           |
  |    "{bookmark}"               |
  |                               |
  |<-- ERR{id}                 ---|
  |    "Feed not found"           |
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
  |-- SUB{id1} (resubscribe) --->|
  |-- SUB{id2} (resubscribe) --->|
  |                               |
  |<-- Resume fact streams ------|
```

### Optimized Fact Processing

#### Direct Envelope Delivery
The WebSocket implementation delivers complete FactEnvelopes directly to subscribers, eliminating the inefficient reference-based flow:

**Optimized Flow:**
1. WebSocket receives Graph Protocol stream
2. GraphDeserializer produces FactEnvelopes with complete fact data
3. FactEnvelopes delivered directly to subscription handlers
4. Facts saved immediately without additional network calls

**Benefits:**
- Eliminates redundant `network.load()` calls
- Reduces network traffic by ~50%
- Improves fact processing latency
- Reduces server load from HTTP load requests

#### Subscription Handler Interface
```typescript
interface WebSocketSubscriptionHandler {
    onFactEnvelopes: (envelopes: FactEnvelope[]) => Promise<void>;
    onBookmark: (bookmark: string) => Promise<void>;
    onError: (error: Error) => void;
}
```

### Error Handling and Resilience

#### Connection Error Recovery
- **Network Failures**: Automatic reconnection with exponential backoff
- **Authentication Failures**: Reported to all active subscriptions
- **Protocol Errors**: Connection reset with error reporting

#### Subscription Error Handling
- **Invalid Feeds**: Server errors mapped to specific subscription callbacks
- **Bookmark Errors**: Malformed bookmarks trigger subscription-specific errors
- **Timeout Handling**: Subscription timeouts trigger cleanup and error callbacks

#### Message Processing Errors
- **Malformed Messages**: Logged and ignored to prevent connection disruption
- **Unknown Control Markers**: Logged for debugging, processing continues
- **Correlation Failures**: Orphaned messages logged, subscription state preserved

### Performance Characteristics

#### Network Efficiency
- **Single Connection**: All subscriptions multiplexed over one WebSocket
- **Reduced Overhead**: Eliminates HTTP request/response overhead per fact batch
- **Real-time Delivery**: Immediate fact delivery without polling delays
- **Bandwidth Optimization**: Direct Graph Protocol streaming without HTTP wrapping

#### Memory Management
- **Bounded Queues**: Message queues limited to prevent memory exhaustion
- **Subscription Cleanup**: Automatic cleanup prevents memory leaks
- **Connection Pooling**: Not needed due to single persistent connection

#### Scalability Benefits
- **Server Efficiency**: Fewer connections and HTTP requests to manage
- **Client Efficiency**: Single connection reduces client-side resource usage
- **Protocol Efficiency**: Graph Protocol provides optimal fact serialization

### Configuration

#### WebSocket Client Configuration
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
    
    // Logging
    enableLogging: boolean;              // Default: false
}
```

#### Network Configuration
```typescript
interface WebSocketNetworkConfig {
    wsEndpoint: string;                  // WebSocket server URL
    enableFallback: boolean;             // Allow HTTP fallback
    webSocketConfig: WebSocketClientConfig;
}
```

### Integration Points

#### Network Interface Compatibility
The WebSocket implementation maintains full compatibility with the existing Network interface:

```typescript
interface Network {
    feeds(start: FactReference[], specification: Specification): Promise<string[]>;
    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse>;
    streamFeed(
        feed: string, 
        bookmark: string, 
        onEnvelope: (envelopes: FactEnvelope[]) => Promise<void>, 
        onBookmark: (bookmark: string) => Promise<void>, 
        onError: (err: Error) => void
    ): () => void;
    load(factReferences: FactReference[]): Promise<FactEnvelope[]>;
}
```

#### Configuration-Driven Network Selection
The system uses `JinagaBrowserConfig` to determine which Network implementation to create:

```typescript
// src/jinaga-browser.ts - Network selection logic
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
```

#### Network Selection Decision Tree
The network implementation selection follows this priority order:

1. **WebSocketNetwork**: When both `wsEndpoint` and `httpEndpoint` are configured
   - Requires valid `webClient` for HTTP fallback operations
   - Provides WebSocket streaming with automatic HTTP fallback
   - Uses WebSocket for `streamFeed`, HTTP for `feeds`, `fetchFeed`, and `load`

2. **HttpNetwork**: When only `httpEndpoint` is configured
   - Requires valid `webClient` for all operations
   - Maintains existing HTTP-based behavior
   - Uses long polling for `streamFeed` operations

3. **NetworkNoOp**: When no endpoints are configured or no `webClient` available
   - Provides no-operation implementations for all methods
   - Used in offline or testing scenarios
   - Returns empty results for all operations

#### Configuration Examples and Behavior

```typescript
// Example 1: WebSocket with HTTP fallback
const config1: JinagaBrowserConfig = {
    httpEndpoint: 'https://api.example.com',
    wsEndpoint: 'wss://api.example.com/ws'
};
// Creates: WebSocketNetwork(HttpNetwork, WebSocketClient)
// Behavior: WebSocket streaming, HTTP for other operations, automatic fallback

// Example 2: HTTP only (existing behavior)
const config2: JinagaBrowserConfig = {
    httpEndpoint: 'https://api.example.com'
};
// Creates: HttpNetwork
// Behavior: HTTP long polling for streaming, HTTP for all operations

// Example 3: Offline mode
const config3: JinagaBrowserConfig = {
    indexedDb: 'myapp'
    // No network endpoints
};
// Creates: NetworkNoOp
// Behavior: No network operations, local storage only
```

#### Subscriber Integration
Subscribers receive optimized envelope processing through the enhanced streamFeed interface:

- **Direct Envelopes**: Complete fact data delivered without conversion
- **Immediate Processing**: Facts available for storage without additional loads
- **Bookmark Handling**: Separate bookmark callback for efficient state management

### Backward Compatibility

#### Graceful Degradation
- **HTTP Fallback**: Automatic fallback to HTTP streaming when WebSocket unavailable
- **Legacy Support**: Existing HTTP-based clients continue to function unchanged
- **Mixed Environments**: WebSocket and HTTP clients can coexist

#### Protocol Compatibility
- **Graph Protocol**: Uses existing, proven serialization format
- **Control Extensions**: Minimal additions that don't affect core protocol
- **Server Compatibility**: Servers can support both HTTP and WebSocket simultaneously

This architecture provides a robust, efficient, and scalable foundation for real-time fact streaming while maintaining full backward compatibility with existing HTTP-based implementations.
