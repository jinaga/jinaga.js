import 'fake-indexeddb/auto';
import { Trace, TestTracer } from '../../src/util/trace';

// Install test tracer before all tests to catch and ignore logging errors
// that occur after tests complete (e.g., from async WebSocket cleanup)
beforeAll(() => {
    Trace.configure(new TestTracer());
});