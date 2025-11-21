# Test Failure Analysis and Recommendations

## Summary

The CI tests are failing with exit code 1, indicating test execution failures. Based on code analysis, here are the identified issues and recommended fixes.

## Identified Issues

### 1. **Mock WebSocket Instance Mismatch** (Critical)

**Problem**: Several tests create a `mockWs` instance but then pass `MockWebSocket` class to the transport, causing the transport to create a different instance. Tests then check `mockWs.getSentMessages()` which is always empty.

**Affected Tests**:
- `resilient-transportSpec.ts` line 322-337: Heartbeat test
- `resilient-transportSpec.ts` line 232-260: Reconnection test  
- `resilient-transportSpec.ts` line 186-196: Message transmission test

**Example**:
```typescript
mockWs = new MockWebSocket('ws://test');
const transport = new ResilientWebSocketTransport(
  () => Promise.resolve('ws://test'),
  callbacks,
  MockWebSocket as any,  // Creates NEW instance, not mockWs!
  { heartbeatIntervalMs: 100 }
);
// Later checks mockWs.getSentMessages() - always empty!
```

**Fix**: Either:
- Remove `mockWs` variable and check messages through callbacks, OR
- Create a factory function that returns the same instance, OR  
- Access the socket instance from the transport (if exposed)

### 2. **Reconnection Test Logic Error**

**Problem**: Test creates `mockWs` but uses `wsFactory` class, so `mockWs.simulateClose()` doesn't affect the actual connection created by transport.

**Location**: `resilient-transportSpec.ts` line 232-260

**Fix**: Need to track the actual socket instance created by transport or use a different approach to trigger reconnection.

### 3. **E2E Test Server Cleanup**

**Problem**: E2E tests might have race conditions or incomplete cleanup causing tests to hang or fail.

**Location**: `resilient-websocket-e2eSpec.ts`

**Potential Issues**:
- Server might not be fully ready before tests run
- Connections might not be properly closed
- Timeout issues in CI environment

**Fix**: Add proper wait conditions and ensure all resources are cleaned up.

### 4. **Test Timeout Issues**

**Problem**: CI environment may be slower, causing tests to timeout.

**Current Timeouts**: 
- `jest.setTimeout(10000)` in unit tests
- `jest.setTimeout(20000)` in E2E tests

**Fix**: Increase timeouts or optimize test execution.

### 5. **Async Race Conditions**

**Problem**: Tests use `setTimeout` with fixed delays which may not be sufficient in CI.

**Example**:
```typescript
await transport.connect();
await new Promise(resolve => setTimeout(resolve, 50)); // May be too short
```

**Fix**: Use proper wait conditions or increase delays.

## Recommended Fixes

### Fix 1: Correct Mock WebSocket Usage

**Option A - Use Callbacks** (Recommended):
```typescript
it('should send heartbeat messages', async () => {
  const sentMessages: Array<string | ArrayBuffer | Blob> = [];
  
  // Track messages through a custom mock
  const TrackingMockWebSocket = class extends MockWebSocket {
    send(data: string | ArrayBuffer | Blob): void {
      sentMessages.push(data);
      super.send(data);
    }
  };

  const transport = new ResilientWebSocketTransport(
    () => Promise.resolve('ws://test'),
    callbacks,
    TrackingMockWebSocket as any,
    { heartbeatIntervalMs: 100 }
  );

  await transport.connect();
  await new Promise(resolve => setTimeout(resolve, 200));

  expect(sentMessages.length).toBeGreaterThan(0);
});
```

**Option B - Store Socket Reference**:
Modify transport to expose socket instance (not recommended for production code).

### Fix 2: Fix Reconnection Test

```typescript
it('should reconnect automatically on disconnect', async () => {
  let connectionCount = 0;
  const wsFactory = class extends MockWebSocket {
    constructor(url: string) {
      super(url);
      connectionCount++;
    }
  };

  const transport = new ResilientWebSocketTransport(
    () => Promise.resolve('ws://test'),
    callbacks,
    wsFactory as any,
    {
      reconnectMode: ReconnectMode.Stateless,
      reconnectInitialDelayMs: 50,
      maxReconnectAttempts: 3
    }
  );

  await transport.connect();
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const initialCount = connectionCount;
  
  // Force disconnect by closing the transport
  await transport.disconnect();
  
  // Wait for reconnection attempt
  await new Promise(resolve => setTimeout(resolve, 200));

  expect(connectionCount).toBeGreaterThan(initialCount);
  expect(callbacks.onReconnect).toHaveBeenCalled();
});
```

### Fix 3: Improve E2E Test Reliability

```typescript
beforeAll(async () => {
  // ... server setup ...
  
  await Promise.all([
    new Promise<void>(resolve => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        if (!addr) throw new Error('HTTP server failed to start');
        resolve();
      });
    }),
    new Promise<void>(resolve => {
      wss.once('listening', () => {
        const addr = wss.address();
        if (!addr) throw new Error('WS server failed to start');
        resolve();
      });
    })
  ]);
  
  // Additional wait to ensure servers are ready
  await new Promise(resolve => setTimeout(resolve, 100));
});
```

### Fix 4: Increase Test Timeouts

```typescript
jest.setTimeout(30000); // Increase from 10000/20000
```

### Fix 5: Use Wait Helpers

Create helper functions to wait for conditions:

```typescript
async function waitForConnection(transport: ResilientWebSocketTransport, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (transport.isConnected()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Connection timeout');
}
```

## Priority Order

1. **Fix Mock WebSocket instance mismatch** (Critical - causes test failures)
2. **Fix reconnection test logic** (High - test is broken)
3. **Improve E2E test reliability** (Medium - may cause intermittent failures)
4. **Increase timeouts** (Low - may help in CI)
5. **Add wait helpers** (Low - improves test reliability)

## Testing Strategy

After applying fixes:
1. Run tests locally: `npm test`
2. Run specific test file: `npm test -- test/ws/resilient-transportSpec.ts`
3. Run with verbose output: `npm test -- --verbose`
4. Check for timing issues by running tests multiple times
