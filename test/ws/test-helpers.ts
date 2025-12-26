/**
 * Test helpers for WebSocket framework tests
 */

import { ConnectionState } from '../../src/ws/resilient-transport';

/**
 * Wait for a WebSocket connection to reach a specific state
 */
export async function waitForConnectionState(
  getState: () => ConnectionState,
  targetState: ConnectionState,
  timeoutMs = 5000,
  intervalMs = 50
): Promise<void> {
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      const currentState = getState();
      if (currentState === targetState) {
        return resolve();
      }
      if (Date.now() - start > timeoutMs) {
        return reject(
          new Error(
            `Timeout waiting for state ${targetState}. Current state: ${currentState}`
          )
        );
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

/**
 * Wait for a condition to become true
 */
export async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 50
): Promise<void> {
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      if (predicate()) {
        return resolve();
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timeout waiting for condition after ${timeoutMs}ms`));
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

/**
 * Wait for a specific number of callbacks to be invoked
 */
export async function waitForCallbackCount(
  getCount: () => number,
  expectedCount: number,
  timeoutMs = 5000
): Promise<void> {
  return waitForCondition(() => getCount() >= expectedCount, timeoutMs);
}

/**
 * Create a mock WebSocket server for testing
 */
export function createMockWebSocketServer(
  port: number = 0
): {
  server: any;
  url: string;
  clients: Set<any>;
  messages: Array<{ client: any; data: any }>;
  close: () => Promise<void>;
} {
  const WebSocket = require('ws');
  const wss = new WebSocket.Server({ port });
  const clients = new Set();
  const messages: Array<{ client: any; data: any }> = [];

  wss.on('connection', (socket: any) => {
    clients.add(socket);

    socket.on('message', (data: any) => {
      messages.push({ client: socket, data });
    });

    socket.on('close', () => {
      clients.delete(socket);
    });

    // Send welcome message
    socket.send(JSON.stringify({ type: 'welcome' }));
  });

  const address = wss.address();
  const url =
    typeof address === 'string'
      ? `ws://${address}`
      : `ws://127.0.0.1:${address.port}`;

  return {
    server: wss,
    url,
    clients,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        clients.forEach((client: any) => {
          if (client.readyState === WebSocket.OPEN) {
            client.close();
          }
        });
        wss.close(() => resolve());
      })
  };
}

/**
 * Create a delay promise
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
