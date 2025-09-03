/**
 * Jest setup file for integration tests
 *
 * This file configures the test environment for:
 * - IndexedDB support in jsdom
 * - Performance testing utilities
 * - Test isolation and cleanup
 */

// Configure jsdom for IndexedDB support
import 'jest-environment-jsdom';

// Mock performance.now for consistent timing in tests
const mockPerformance = {
  now: jest.fn(() => Date.now()),
  mark: jest.fn(),
  measure: jest.fn(),
  getEntriesByName: jest.fn(() => []),
  getEntriesByType: jest.fn(() => []),
  clearMarks: jest.fn(),
  clearMeasures: jest.fn(),
};

// Replace global performance with mock
Object.defineProperty(window, 'performance', {
  value: mockPerformance,
  writable: true,
});

// Ensure IndexedDB is available in jsdom environment
if (!window.indexedDB) {
  // jsdom should provide indexedDB, but if not, we could add a polyfill here
  console.warn('IndexedDB not available in test environment');
}

// Configure test timeouts for different test types
jest.setTimeout(30000); // 30 seconds for load tests

// Global test setup for integration tests
beforeAll(async () => {
  // Any global setup for all tests
});

afterAll(async () => {
  // Global cleanup
});

// Setup for each test file
beforeEach(() => {
  // Reset performance mock
  mockPerformance.now.mockClear();

  // Clear any IndexedDB databases created during tests
  // Note: Individual tests should handle their own cleanup
});

afterEach(() => {
  // Cleanup after each test
});

// Export utilities for tests
global.testUtils = {
  // Helper to wait for IndexedDB operations
  waitForIDB: (ms: number = 100) => new Promise(resolve => setTimeout(resolve, ms)),

  // Helper to clean up test databases
  cleanupTestDB: async (dbName: string) => {
    if (typeof indexedDB !== 'undefined') {
      const deleteRequest = indexedDB.deleteDatabase(dbName);
      return new Promise<void>((resolve, reject) => {
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
        deleteRequest.onblocked = () => reject(new Error('Database deletion blocked'));
      });
    }
  },

  // Performance measurement helper
  measurePerformance: async <T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> => {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    return { result, duration };
  }
};

// Type declarations for global test utilities
declare global {
  var testUtils: {
    waitForIDB: (ms?: number) => Promise<void>;
    cleanupTestDB: (dbName: string) => Promise<void>;
    measurePerformance: <T>(fn: () => Promise<T>) => Promise<{ result: T; duration: number }>;
  };
}