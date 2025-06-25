# ETIMEDOUT Error Fix for HTTP-Only Configuration

## Problem Diagnosis

When JinagaClient is configured for HTTP connection without IndexedDB storage, load tests were failing with `ETIMEDOUT` errors. The diagnostic logging confirmed two primary issues:

### 1. No Request Queuing/Batching
- **Issue**: `TransientFork` bypassed all queuing, sending each save operation directly to HTTP
- **Evidence**: Logs showed "TransientFork: Saving 1 envelopes directly to HTTP (no local queue)"
- **Impact**: Under load, this created spikes of concurrent HTTP requests

### 2. Connection Pool Exhaustion  
- **Issue**: Node.js fetch (undici) connection pool was overwhelmed by concurrent requests
- **Evidence**: Logs showed active connections building up (3, 4, 5) and connection errors climbing
- **Impact**: New requests timed out waiting for available connections

## Solution Implemented

### 1. Added Memory-Based Queuing to TransientFork
- **MemoryQueue**: In-memory queue for batching operations when IndexedDB is not available
- **TransientSaver**: Saver implementation that processes queued envelopes using `saveWithRetry`
- **QueueProcessor**: Reused existing queue processor with configurable delay (default 100ms)

### 2. Added Connection Pool Management
- **Connection Limiting**: Limited concurrent connections to 6 (conservative for HTTP/1.1)
- **Request Queuing**: Queues requests when connection pool is full
- **Proper Resource Management**: Uses `finally` blocks to ensure connections are always released

### 3. Enhanced Diagnostic Logging
- **Connection Pool Stats**: Tracks active/queued connections, total requests, timeouts, errors
- **Request Tracing**: Individual request tracking with timing and status
- **Queue Monitoring**: Logs queue operations and batch processing

## Key Changes Made

### `src/fork/transient-fork.ts`
- Added `MemoryQueue` class for in-memory operation batching
- Added `TransientSaver` class implementing the `Saver` interface
- Modified `TransientFork` to use `QueueProcessor` with memory queue
- Added configurable queue processing delay

### `src/http/fetch.ts`
- Added connection pool management with `MAX_CONCURRENT_CONNECTIONS = 6`
- Implemented `acquireConnection()` and `releaseConnection()` functions
- Added request queuing when connection pool is full
- Enhanced logging with connection pool statistics

### `src/jinaga-browser.ts`
- Updated `TransientFork` instantiation to pass `queueProcessingDelayMs` parameter

### `src/managers/factManager.ts`
- Added periodic connection stats logging every 5 seconds
- Proper cleanup of logging interval on close

## Expected Behavior After Fix

1. **Batched Operations**: Save operations are queued and processed in batches (default 100ms delay)
2. **Connection Management**: Maximum 6 concurrent connections with queuing for excess requests
3. **Reduced Timeouts**: Connection pool prevents overwhelming the network layer
4. **Better Observability**: Detailed logging shows queue and connection pool status

## Configuration Options

Users can configure the queue processing delay:

```javascript
const jinaga = JinagaBrowser.create({
    httpEndpoint: 'https://api.example.com',
    // No indexedDb - will use TransientFork with memory queue
    queueProcessingDelayMs: 200  // Custom delay (default: 100ms)
});
```

## Testing Recommendations

1. Run the same load test that was failing
2. Monitor logs for:
   - "TransientFork: Queueing X envelopes for batched processing"
   - "Connection Pool Stats" showing managed connection usage
   - Reduced connection errors and timeouts
3. Verify that operations are batched rather than individual HTTP calls