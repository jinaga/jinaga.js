# Connection Resiliency Analysis for Poor HTTP Connections

## Overview

This analysis examines the current implementation of connection resiliency in Jinaga's HTTP network layer, focusing on components responsible for handling network requests in poor connection environments. The analysis covers Subscriber, NetworkManager, HttpNetwork, WebClient, and Fetch components, identifying current limitations and proposing improvements for better reliability in slow, unreliable, or lossy network conditions.

## Current Implementation Analysis

### Subscriber (`src/observer/subscriber.ts`)

**Current Behavior:**
- Implements periodic reconnection every `refreshIntervalSeconds` (default: 90 seconds)
- On each interval, disconnects existing connection and establishes new one via `connectToFeed`
- No retry mechanism on connection failures - failures immediately reject the subscription promise
- Uses `network.streamFeed` for connection establishment, which already includes robust retry logic

**Resiliency Issues:**
- The periodic refresh mechanism may be counterproductive: `getStream` in FetchConnection already implements exponential backoff retry for connection establishment
- Forced reconnections can interrupt successfully established streams that have overcome initial connection issues
- Fixed interval reconnection doesn't adapt to connection quality or health
- Timing conflicts between Subscriber refresh and FetchConnection retry delays can cause inefficient behavior

**Impact:**
- Resource waste from unnecessary reconnections on healthy connections
- Potential interruption of stable streams during poor connection recovery
- No differentiation between connections that need refreshing vs. those that are stable

### NetworkManager (`src/managers/NetworkManager.ts`)

**Current Behavior:**
- Manages feed fetching and subscription orchestration
- Implements batching for fact loading operations via `LoadBatch` class
- For `fetch()`: If any feed fails, removes specification from cache and throws error (no retry)
- For `subscribe()`: If any subscriber fails to start, unsubscribes all feeds and throws error
- `LoadBatch` handles concurrent loads but has no retry logic if `network.load` fails

**Resiliency Issues:**
- Feed failures cause complete operation failure with no recovery attempts
- No differentiation between temporary vs. permanent failures
- Cache invalidation on any failure may cause unnecessary re-computation
- Batch operations lack error recovery mechanisms

**Impact:**
- Single feed failure can break entire data fetching operations
- No resilience against transient network issues during initial data loading

### HttpNetwork (`src/http/httpNetwork.ts`)

**Current Behavior:**
- Thin wrapper around `WebClient` for HTTP network operations
- Delegates all operations (feeds, fetchFeed, streamFeed, load) to WebClient
- No additional error handling or resiliency logic

**Resiliency Issues:**
- Complete dependency on WebClient's resiliency capabilities
- No network-specific error handling or recovery strategies

**Impact:**
- Inherits all limitations from WebClient without mitigation

### WebClient (`src/http/web-client.ts`)

**Current Behavior:**
- Implements `postWithLimitedRetry` for save and load operations only
- Retry logic: Up to 4 attempts with exponential backoff (1s, 2s, 4s, 8s delays)
- Doubles timeout on each retry attempt (up to 60 seconds)
- Other operations (feeds, feed, streamFeed) use direct HTTP calls without retry
- `streamFeed` delegates to `HttpConnection.getStream`

**Resiliency Issues:**
- Inconsistent retry coverage - only save/load operations have retry logic
- Feed operations (critical for real-time data) lack retry mechanisms
- Limited retry attempts (4) may not be sufficient for very poor connections
- No jitter in retry delays, potentially causing thundering herd problems

**Impact:**
- Feed subscriptions and queries may fail in poor connections
- Data saving/loading has better resilience than data querying/streaming

### FetchConnection (`src/http/fetch.ts`)

**Current Behavior:**
- Implements `HttpConnection` interface using browser Fetch API
- GET operations: 30-second hardcoded timeout, retries on authentication failures (401/407/419)
- POST operations: Configurable timeout, similar auth retry logic
- `getStream`: Exponential backoff on errors with jitter, delay capped at `feedRefreshIntervalSeconds`
- Handles `AbortError` as timeout (408 status)
- Uses `AbortController` for request cancellation

**Resiliency Issues:**
- Fixed 30-second timeout for GET operations may be inappropriate for different network conditions
- No retry on non-auth failures for GET operations
- Stream retry logic is good but may not handle all edge cases
- No connection pooling or keep-alive management

**Impact:**
- Streaming feeds have better resilience than one-off requests
- Authentication-related failures are handled well, but general network failures are not

## Architectural Recommendations

### 1. Adaptive Connection Management
- Replace blanket periodic refresh with health-based connection management
- Implement connection health monitoring and adaptive refresh intervals
- Only refresh connections when health metrics indicate problems
- **Key Insight**: Leverage existing robust retry logic in `FetchConnection.getStream()` rather than adding redundant retry layers at Subscriber level
- The current `getStream` implementation already provides exponential backoff with jitter and indefinite retries for connection establishment

### 2. Circuit Breaker Pattern
- Implement circuit breaker for each endpoint/service
- Track failure rates and temporarily disable failing connections
- Allow gradual recovery with limited test requests

### 3. Adaptive Timeouts
- Make all timeouts configurable and adaptive based on:
  - Historical response times
  - Current network conditions
  - Operation type (save vs. query vs. stream)
- Implement timeout escalation with retries

### 4. Connection Pooling and Keep-Alive
- Implement connection pooling for HTTP/1.1 and HTTP/2
- Maintain persistent connections where possible
- Handle connection lifecycle management

### 5. Error Classification and Handling
- Classify errors as temporary vs. permanent
- Implement different strategies for different error types
- Add network quality detection and adaptation

## Configuration Changes

### WebClient Configuration Extensions
```typescript
export interface WebClientConfig {
    timeoutSeconds: number;
    retryPolicy: {
        maxAttempts: number;
        baseDelaySeconds: number;
        backoffMultiplier: number;
        jitterFactor: number;
        maxTimeoutSeconds: number;
    };
    enableCircuitBreaker: boolean;
    circuitBreakerConfig: {
        failureThreshold: number;
        recoveryTimeoutSeconds: number;
        monitoringPeriodSeconds: number;
    };
}
```

### NetworkManager Configuration
```typescript
export interface NetworkManagerConfig {
    feedRefreshIntervalSeconds: number;
    adaptiveRefreshEnabled: boolean; // Enable health-based adaptive refresh intervals
    retryPolicy: RetryPolicy;
    enableFeedFailureIsolation: boolean; // Don't fail all feeds if one fails
    batchConfig: {
        maxBatchSize: number;
        batchTimeoutSeconds: number;
    };
}
```

### FetchConnection Configuration
```typescript
export interface FetchConfig {
    baseUrl: string;
    defaultTimeoutSeconds: number;
    adaptiveTimeouts: boolean;
    connectionPool: {
        maxConnections: number;
        keepAlive: boolean;
    };
}
```

## Code Modification Suggestions

### Subscriber Enhancements
```typescript
// Replace timer-based refresh with health-based adaptive refresh
private connectionHealth = 1.0; // 1.0 = perfect, 0.0 = terrible
private recentConnections: boolean[] = [];
private readonly healthWindowSize = 10;

private updateConnectionHealth(success: boolean) {
    this.recentConnections.push(success);
    if (this.recentConnections.length > this.healthWindowSize) {
        this.recentConnections.shift();
    }
    const successRate = this.recentConnections.filter(Boolean).length / this.recentConnections.length;
    this.connectionHealth = successRate;
}

private getAdaptiveRefreshInterval(): number {
    // Shorter intervals when unhealthy, longer when healthy
    const baseInterval = this.refreshIntervalSeconds;
    const healthFactor = Math.max(0.1, this.connectionHealth); // Minimum 10% of base
    return baseInterval / healthFactor;
}

// Update connectToFeed to track health
private connectToFeed(resolve: (value: void | PromiseLike<void>) => void, reject: (reason?: any) => void) {
    return this.network.streamFeed(this.feed, this.bookmark, async (factReferences, nextBookmark) => {
        this.updateConnectionHealth(true);
        // ... existing logic ...
    }, err => {
        this.updateConnectionHealth(false);
        // ... existing logic ...
    }, this.getAdaptiveRefreshInterval());
}
```

### NetworkManager Improvements
```typescript
// Add per-feed error handling
private async processFeed(feed: string, retryPolicy: RetryPolicy): Promise<void> {
    let attempt = 0;
    while (attempt <= retryPolicy.maxAttempts) {
        try {
            return await this.processFeedOnce(feed);
        } catch (error) {
            if (attempt === retryPolicy.maxAttempts || !isRetryableError(error)) {
                throw error;
            }
            // Don't remove from cache on temporary failures
            const delay = calculateDelay(attempt, retryPolicy);
            await delay(delay);
            attempt++;
        }
    }
}
```

### WebClient Retry Expansion
```typescript
// Extend retry to all operations
async feedsWithRetry(request: string): Promise<FeedsResponse> {
    return this.postWithRetry('/feeds', ContentTypeText, ContentTypeJson, request);
}

async feedWithRetry(feed: string, bookmark: string): Promise<FeedResponse> {
    return this.getWithRetry(`/feeds/${feed}?b=${bookmark}`);
}
```

### FetchConnection Timeout Improvements
```typescript
// Make GET timeout configurable and adaptive
private async httpGet(tail: string, headers: HttpHeaders, timeoutSeconds: number): Promise<FetchHttpResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    // ... rest of implementation
}
```

### HttpNetwork Error Handling
```typescript
// Add error classification and retry logic
async feeds(start: FactReference[], specification: Specification): Promise<string[]> {
    return this.withRetry(() => this.webClient.feedsWithRetry(/* params */));
}
```

## Implementation Priority

1. **High Priority**: Implement adaptive refresh intervals in Subscriber based on connection health
2. **High Priority**: Extend retry logic to feed operations in WebClient
3. **Medium Priority**: Implement circuit breaker pattern
4. **Medium Priority**: Make timeouts configurable and adaptive
5. **Low Priority**: Add connection pooling and keep-alive management

## Testing Recommendations

- Implement chaos engineering tests simulating poor network conditions
- Add integration tests for retry logic and circuit breaker behavior
- Create performance benchmarks for different retry configurations
- Test adaptive timeout behavior under varying network conditions

## Monitoring and Observability

- Add metrics for retry attempts, success/failure rates
- Implement connection health monitoring
- Add logging for circuit breaker state changes
- Create dashboards for network resiliency KPIs