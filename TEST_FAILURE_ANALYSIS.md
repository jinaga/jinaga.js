# Test Failure Analysis

## Summary
9 tests are failing, grouped into 4 main categories:
1. **Async cleanup issues** (4 failures) - Operations continuing after tests complete
2. **Reconnection logic failures** (3 failures) - Reconnection not triggering or completing
3. **MessageQueue implementation issues** (2 failures) - Missing properties and incorrect delay handling
4. **Error handling issues** (2 failures) - Negotiation errors and state transitions not handled correctly

---

## Group 1: Async Cleanup Issues (4 failures)

### Symptoms
- Multiple "Cannot log after tests are done" errors
- Logging attempts from `ObservableSource.removeSpecificationListener` after test completion
- Worker process failing to exit gracefully

### Root Cause
WebSocket close handlers (`onclose` events) are firing asynchronously after tests complete. The `authorization-websocket-handler.ts` removes specification listeners in the close handler, which triggers logging in `ObservableSource` after Jest has finished.

### Affected Tests
- All tests that create WebSocket connections (indirect failures)

### Solution
**1. Ensure proper cleanup in test teardown:**
```typescript
afterEach(async () => {
  // Wait for all async operations to complete
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Clean up any remaining WebSocket connections
  if (transport) {
    await transport.disconnect();
  }
});
```

**2. Make logging conditional in ObservableSource:**
- Check if test environment is still active before logging
- Or use a test-safe logger that suppresses logs after test completion

**3. Add cleanup to authorization-websocket-handler:**
- Remove event listeners synchronously during disconnect
- Use AbortController to cancel pending async operations

---

## Group 2: Reconnection Logic Failures (3 failures)

### Failure 1: "should reconnect automatically on disconnect"
**Expected:** `connectionCount > 1`  
**Actual:** `connectionCount === 1`

**Root Cause:** The mock WebSocket closes itself, but `scheduleReconnect()` may not be creating a new connection because:
- The `reconnectTimer` check prevents multiple schedules
- The connection count is incremented in the constructor, but a new instance may not be created
- The reconnection delay may be longer than the test timeout

**Solution:**
```typescript
// In resilient-transportSpec.ts test
// Ensure the mock creates a NEW instance for each reconnection
const AutoClosingMockWebSocket = class extends MockWebSocket {
  constructor(url: string) {
    super(url);
    connectionCount++; // This only runs once per instance
  }
};

// The issue: scheduleReconnect() calls establishConnection() which 
// creates a NEW socket, but the test needs to track this.
// Fix: Make connectionCount a shared counter outside the class
```

**Fix:** Track connection attempts at the transport level, not just in the mock constructor.

### Failure 2: "should respect max reconnection attempts"
**Expected:** Wait for 2 reconnection callbacks  
**Actual:** Timeout waiting for condition

**Root Cause:** The test waits for `onReconnect` to be called 2 times, but:
- `onReconnect` is called BEFORE the delay, not after successful reconnection
- The reconnection may fail before reaching max attempts
- The condition check may be too strict

**Solution:**
```typescript
// The test expects onReconnect to be called 2 times with maxReconnectAttempts: 2
// But onReconnect is called when SCHEDULING reconnection, not when it succeeds
// Need to wait for actual reconnection attempts, not just scheduling
```

**Fix:** Adjust test to wait for actual reconnection state changes or connection attempts, not just callback invocations.

### Failure 3: "should recover from connection errors" (integration test)
**Expected:** `connectionAttempts > 1`  
**Actual:** `connectionAttempts === 1`

**Root Cause:** Similar to failure 1 - reconnection not creating new connection instances that increment the counter.

**Solution:** Same as Failure 1 - track connections at transport level.

---

## Group 3: MessageQueue Implementation Issues (2 failures)

### Failure 1: "should track retry attempts"
**Expected:** `retried?.attempts === 1`  
**Actual:** `retried?.attempts === undefined`

**Root Cause:** In `markFailed()`:
1. Message is dequeued (removed from queue)
2. `markFailed()` is called with the message ID
3. `markFailed()` finds the message, increments attempts
4. Message is removed from queue and re-added with setTimeout delay
5. When `dequeue()` is called again, the message may not be re-queued yet (delay hasn't elapsed)
6. OR the message object doesn't preserve the `attempts` property correctly

**Looking at the code:**
```typescript
markFailed(messageId: string): boolean {
  const message = this.queue.find(m => m.id === messageId);
  if (!message) {
    return false; // Message not found - this is the issue!
  }
  message.attempts++;
  // ... re-queue logic
}
```

**The Problem:** The test dequeues the message FIRST, then calls `markFailed()`. But `markFailed()` looks for the message in `this.queue`, which is now empty because it was dequeued!

**Solution:**
```typescript
// Option 1: Track failed messages separately
private failedMessages: Map<string, QueuedMessage> = new Map();

markFailed(messageId: string): boolean {
  // Check both queue and failed messages
  let message = this.queue.find(m => m.id === messageId);
  if (!message) {
    message = this.failedMessages.get(messageId);
  }
  if (!message) {
    return false;
  }
  // ... rest of logic
}

// Option 2: Don't remove from queue until markFailed is called
// Change test to: enqueue -> markFailed (before dequeue) -> dequeue
```

**Fix:** The test logic is incorrect - it should call `markFailed()` BEFORE dequeuing, OR the implementation should track messages that are "in flight" (dequeued but not yet confirmed).

### Failure 2: "should re-queue failed messages with delay"
**Expected:** `queue.size() > 0` after 100ms  
**Actual:** `queue.size() === 0`

**Root Cause:** The delay calculation in `markFailed()`:
```typescript
const delayMs = Math.min(1000 * Math.pow(2, message.attempts), 30000);
```

For `attempts === 1` (after first failure): `delayMs = 1000 * 2^1 = 2000ms`

But the test only waits 100ms! The message won't be re-queued until 2000ms have passed.

**Solution:**
```typescript
// Option 1: Fix the test to wait longer
await new Promise(resolve => setTimeout(resolve, 2100)); // Wait for 2s delay

// Option 2: Fix the delay calculation to be more reasonable
const delayMs = Math.min(100 * Math.pow(2, message.attempts), 30000); // Start at 100ms
```

**Fix:** Either adjust test timeout or reduce initial delay in implementation.

---

## Group 4: Error Handling Issues (2 failures)

### Failure 1: "should handle negotiation errors gracefully"
**Expected:** `handler.connect()` resolves without throwing  
**Actual:** Promise rejects with "Negotiation failed"

**Root Cause:** In `connection-handler.ts`, the `connect()` method calls `negotiateConnection()` which throws, and the error is not caught:

```typescript
async connect(): Promise<void> {
  // ...
  const negotiation = await this.negotiateConnection(); // Throws if negotiation fails
  // ...
}
```

**Solution:**
```typescript
async connect(): Promise<void> {
  // ...
  let negotiation: NegotiationResponse;
  try {
    negotiation = await this.negotiateConnection();
  } catch (error) {
    // If negotiation fails, use default URL
    negotiation = { url: this.baseUrl };
  }
  // ...
}
```

**Fix:** Catch negotiation errors and fall back to default connection behavior.

### Failure 2: "should handle server errors gracefully" (e2e test)
**Expected:** `ws.getState() === ConnectionState.Reconnecting`  
**Actual:** `ws.getState() === ConnectionState.Connected`

**Root Cause:** After server closes connection with error code 1011, the reconnection may not be triggered immediately, or the state transition happens too quickly for the test to catch.

**Solution:**
```typescript
// Wait longer for state transition
await new Promise(resolve => setTimeout(resolve, 1000)); // Increased from 500ms

// Or wait for state change explicitly
await waitForConnectionState(
  () => ws.getState(),
  ConnectionState.Reconnecting,
  2000
);
```

**Fix:** Increase wait time or use explicit state waiting helper.

---

## Recommended Fix Priority

1. **High Priority:** Group 3 (MessageQueue) - These are clear bugs in the implementation
2. **High Priority:** Group 4 (Error Handling) - Negotiation error handling is a critical feature
3. **Medium Priority:** Group 2 (Reconnection) - Core functionality but tests may need adjustment
4. **Low Priority:** Group 1 (Async Cleanup) - Test infrastructure issue, doesn't affect functionality

---

## Implementation Checklist

### MessageQueue Fixes
- [ ] Fix `markFailed()` to handle messages that are dequeued but not yet confirmed
- [ ] Adjust delay calculation or test expectations for re-queue timing
- [ ] Add tests for "in-flight" message tracking

### Error Handling Fixes
- [ ] Add try-catch in `connection-handler.connect()` for negotiation errors
- [ ] Ensure graceful fallback when negotiation fails
- [ ] Update e2e test to wait appropriately for state transitions

### Reconnection Fixes
- [ ] Add connection attempt tracking at transport level
- [ ] Fix test expectations to match actual reconnection behavior
- [ ] Ensure mock WebSocket creates new instances for each reconnection

### Async Cleanup Fixes
- [ ] Add proper teardown in test files
- [ ] Make ObservableSource logging test-safe
- [ ] Ensure WebSocket handlers are cleaned up synchronously
