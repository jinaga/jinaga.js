import 'fake-indexeddb/auto';
import { Trace, TestTracer } from '../../src/util/trace';

// Install test tracer immediately to catch and ignore logging errors
// that occur after tests complete (e.g., from async WebSocket cleanup)
// Configure before any tests run to ensure all logging goes through TestTracer
Trace.configure(new TestTracer());

// Mark tests as finished after each test completes to suppress logging
// during async cleanup operations (e.g., WebSocket close handlers)
afterEach(() => {
    TestTracer.markTestsFinished();
});

// Reset flag before each test to allow logging during test execution
beforeEach(() => {
    TestTracer.reset();
});