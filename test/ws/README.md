# WebSocket Framework Test Suite

Comprehensive test suite for the Resilient WebSocket framework, including unit tests, integration tests, and end-to-end tests.

## Test Structure

### Unit Tests

- **`resilient-transportSpec.ts`**: Tests for `ResilientWebSocketTransport`
  - Connection lifecycle management
  - Message transmission
  - Reconnection logic
  - Heartbeat mechanism
  - Error handling
  - Message buffering

- **`message-queueSpec.ts`**: Tests for `MessageQueue`
  - Basic queue operations
  - Priority ordering
  - Message removal and retry logic
  - Queue limits
  - Stale message detection

- **`connection-handlerSpec.ts`**: Tests for `WebSocketConnectionHandler`
  - Protocol negotiation
  - Authentication handling
  - URL resolution
  - Connection ID management

### Integration Tests

- **`resilient-websocket-integrationSpec.ts`**: Integration tests
  - Full connection lifecycle
  - Message buffering with reconnection
  - Heartbeat integration
  - Error recovery
  - Concurrent operations

### End-to-End Tests

- **`resilient-websocket-e2eSpec.ts`**: E2E tests with real WebSocket server
  - Real WebSocket server/client communication
  - Protocol negotiation with HTTP server
  - Automatic reconnection scenarios
  - Multiple client handling
  - Message ordering
  - Graceful shutdown

## Running Tests

### Run All WebSocket Tests

```bash
npm run test:ws
```

### Run Unit Tests Only

```bash
npm run test:ws:unit
```

### Run Integration Tests Only

```bash
npm run test:ws:integration
```

### Run E2E Tests Only

```bash
npm run test:ws:e2e
```

### Run Specific Test File

```bash
npm test -- test/ws/resilient-transportSpec.ts
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Tests with Coverage

```bash
npm run test:coverage
```

## Test Helpers

The `test-helpers.ts` file provides utility functions for testing:

- `waitForConnectionState()`: Wait for connection to reach a specific state
- `waitForCondition()`: Wait for a condition to become true
- `waitForCallbackCount()`: Wait for a specific number of callbacks
- `createMockWebSocketServer()`: Create a mock WebSocket server for testing
- `delay()`: Create a delay promise

## Test Environment

Tests use:
- **Jest** as the test framework
- **ws** library for WebSocket server in E2E tests
- **Mock WebSocket** implementations for unit tests
- **Node.js HTTP server** for negotiation endpoint testing

## CI/CD Integration

Tests are automatically run in GitHub Actions on:
- Pull requests (via `pr-checks.yml`)
- Main branch pushes (via `main.yml`)

The PR checks workflow includes:
- Type checking
- Build verification
- All test suites (unit, integration, E2E)
- Linting
- Coverage reporting

## Test Coverage Goals

- **Unit Tests**: 90%+ coverage for all components
- **Integration Tests**: Cover all component interactions
- **E2E Tests**: Cover real-world usage scenarios

## Writing New Tests

When adding new tests:

1. Follow the existing test structure and naming conventions
2. Use descriptive test names that explain what is being tested
3. Include both success and failure scenarios
4. Test edge cases and error conditions
5. Use test helpers for common patterns
6. Ensure tests are deterministic and don't rely on timing
7. Clean up resources in `afterEach` or `afterAll`

## Example Test Structure

```typescript
describe('ComponentName', () => {
  let component: Component;
  let callbacks: Callbacks;

  beforeEach(() => {
    // Setup
    callbacks = {
      onEvent: jest.fn()
    };
    component = new Component(callbacks);
  });

  afterEach(() => {
    // Cleanup
    component.disconnect();
  });

  it('should handle specific scenario', async () => {
    // Arrange
    await component.connect();

    // Act
    await component.doSomething();

    // Assert
    expect(callbacks.onEvent).toHaveBeenCalled();
  });
});
```

## Debugging Tests

To debug a specific test:

1. Use `console.log()` for debugging (remove before committing)
2. Increase timeout for slow tests: `jest.setTimeout(30000)`
3. Run tests in watch mode to see immediate feedback
4. Use Jest's `--verbose` flag for detailed output

## Known Issues

- E2E tests require a real WebSocket server, so they may be slower
- Some timing-sensitive tests may need adjustment on slower CI environments
- Mock WebSocket implementations may not perfectly match browser behavior

## Contributing

When contributing tests:

1. Ensure all tests pass locally
2. Run the full test suite before submitting PR
3. Add tests for new features
4. Update this README if adding new test categories
5. Follow existing code style and patterns
