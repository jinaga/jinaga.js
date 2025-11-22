# Resilient WebSocket Framework

A robust client-server WebSocket communication framework with automatic failover, transparent reconnection, and message reliability. Based on SignalR patterns for connection resiliency.

## Features

- **Connection Resiliency**: Automatic reconnection with exponential backoff
- **Message Buffering**: Store-and-forward mechanism for messages during disconnection
- **Heartbeat Detection**: Connection health monitoring via ping/pong
- **Stateful & Stateless Reconnection**: Support for both reconnection modes
- **Graceful Shutdown**: Clean connection termination with timeout handling
- **Protocol Negotiation**: Handshake mechanism for connection establishment
- **Cross-Platform**: Works in browser and Node.js environments

## Core Components

### ResilientWebSocketTransport

The core transport layer that manages WebSocket connections with resiliency features.

```typescript
import { ResilientWebSocketTransport, ConnectionState, ReconnectMode } from './ws/resilient-transport';

const transport = new ResilientWebSocketTransport(
  async () => 'wss://example.com/ws',
  {
    onStateChange: (event) => {
      console.log(`State: ${event.previousState} -> ${event.currentState}`);
    },
    onMessage: (event) => {
      console.log('Message received:', event.data);
    },
    onError: (error) => {
      console.error('Error:', error);
    },
    onConnected: () => {
      console.log('Connected!');
    }
  },
  undefined, // Use default WebSocket constructor
  {
    maxReconnectAttempts: 10,
    reconnectInitialDelayMs: 1000,
    reconnectMaxDelayMs: 30000,
    reconnectMode: ReconnectMode.Stateful,
    heartbeatIntervalMs: 30000,
    enableMessageBuffering: true,
    maxBufferedMessages: 1000
  }
);

await transport.connect();
await transport.send('Hello, Server!');
```

### WebSocketConnectionHandler

Handles connection initialization, protocol negotiation, and authentication.

```typescript
import { WebSocketConnectionHandler } from './ws/connection-handler';

const handler = new WebSocketConnectionHandler(
  'https://example.com',
  {
    onMessage: (event) => {
      console.log('Message:', event.data);
    },
    onConnected: () => {
      console.log('Connected');
    }
  },
  {
    negotiate: async () => {
      // Custom negotiation logic
      const response = await fetch('https://example.com/negotiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      return response.json();
    },
    getAuthToken: async () => {
      // Get authentication token
      return localStorage.getItem('authToken');
    }
  }
);

await handler.connect();
await handler.send('Hello!');
```

### ResilientWebSocket

High-level API for creating resilient WebSocket connections.

```typescript
import { ResilientWebSocket } from './ws/resilient-websocket';

const ws = new ResilientWebSocket(
  'wss://example.com',
  {
    onMessage: (event) => {
      console.log('Received:', event.data);
    },
    onStateChange: (event) => {
      console.log(`State changed: ${event.currentState}`);
    },
    onReconnect: (event) => {
      console.log(`Reconnecting (attempt ${event.attempt})...`);
    }
  },
  {
    reconnectMode: ReconnectMode.Stateful,
    heartbeatIntervalMs: 30000,
    enableMessageBuffering: true
  }
);

await ws.connect();
await ws.send('Hello, World!');
```

### MessageQueue

Store-and-forward message queue for buffering messages during disconnection.

```typescript
import { MessageQueue } from './ws/message-queue';

const queue = new MessageQueue({
  maxSize: 1000,
  maxRetries: 5,
  persistent: false
});

// Enqueue messages
const messageId = queue.enqueue('Hello', 1); // priority 1

// Process messages
while (!queue.isEmpty()) {
  const message = queue.dequeue();
  if (message) {
    try {
      await sendToServer(message.data);
      queue.remove(message.id);
    } catch (error) {
      queue.markFailed(message.id);
    }
  }
}
```

## Connection Lifecycle

### 1. Connection Initialization

```typescript
// Check WebSocket support
if (!ResilientWebSocket.isSupported()) {
  console.error('WebSocket not supported');
  return;
}

// Create connection
const ws = new ResilientWebSocket(url, callbacks, options);

// Connect
await ws.connect();
```

### 2. Protocol Negotiation

The framework supports custom negotiation:

```typescript
const handler = new WebSocketConnectionHandler(url, callbacks, {
  negotiate: async () => {
    const response = await fetch('/negotiate', {
      method: 'POST',
      body: JSON.stringify({ protocol: 'websocket', version: 1 })
    });
    return response.json();
  }
});
```

### 3. Message Transmission

Messages are automatically buffered if the connection is not ready:

```typescript
// Send message (will buffer if disconnected)
await ws.send('Hello');
await ws.send(JSON.stringify({ type: 'data', payload: '...' }));
```

### 4. Reconnection

Automatic reconnection with exponential backoff:

```typescript
const ws = new ResilientWebSocket(url, {
  onReconnect: (event) => {
    console.log(`Reconnecting attempt ${event.attempt} after ${event.delayMs}ms`);
  }
}, {
  reconnectMode: ReconnectMode.Stateful, // or Stateless
  maxReconnectAttempts: 10,
  reconnectInitialDelayMs: 1000,
  reconnectMaxDelayMs: 30000
});
```

### 5. Graceful Shutdown

```typescript
// Disconnect gracefully
await ws.disconnect();
```

## Configuration Options

### WebSocketTransportOptions

- `maxReconnectAttempts`: Maximum reconnection attempts (0 = unlimited)
- `reconnectInitialDelayMs`: Initial delay before first reconnection (default: 1000ms)
- `reconnectMaxDelayMs`: Maximum delay between reconnections (default: 30000ms)
- `reconnectMode`: `ReconnectMode.None`, `ReconnectMode.Stateless`, or `ReconnectMode.Stateful`
- `heartbeatIntervalMs`: Heartbeat interval (0 = disabled, default: 30000ms)
- `connectionTimeoutMs`: Connection timeout (default: 10000ms)
- `closeTimeoutMs`: Graceful close timeout (default: 5000ms)
- `maxBufferedMessages`: Maximum buffered messages (default: 1000)
- `enableMessageBuffering`: Enable store-and-forward (default: true)

### ConnectionHandlerOptions

Extends `WebSocketTransportOptions` with:

- `negotiate`: Custom negotiation function
- `getAuthToken`: Function to retrieve authentication token
- `headers`: Custom headers for negotiation
- `protocols`: WebSocket subprotocols

## Algorithms

### Connection Initialization and Handshake

1. **Protocol Detection**: Check WebSocket availability
2. **Negotiation**: Exchange connection tokens and handle authentication
3. **Upgrade**: Establish secure WebSocket connection (wss://)

### Data Channel Resiliency

- **Pipe Mechanism**: Bidirectional communication channels
- **Flow Control**: Handle backpressure with buffering/stalling
- **Timeouts**: Cancellation tokens prevent hanging operations

### Reconnection (Stateful & Stateless)

- **Stateful**: Preserves protocol states and buffered messages
- **Stateless**: Resets transport and creates fresh pipelines
- **Retry Logic**: Exponential backoff delays between retries

### Graceful Shutdown

1. Cancel pending reads
2. Send close frames to peers
3. Implement timeouts for hanging closes
4. Handle abrupt network terminations

### Receive/Send Loops

- **Receive**: Reads incoming frames, handles heartbeat pings, throttles on backpressure
- **Send**: Reads application buffers, ensures completion before next write

### Heartbeat Detection

- Periodic ping frames over WebSocket channel
- Timeout detection triggers connection stop
- Configurable heartbeat interval

## Best Practices

1. **Always check WebSocket support** before creating connections
2. **Handle state changes** to provide user feedback
3. **Implement error handlers** for robust error handling
4. **Use stateful reconnection** when message order matters
5. **Configure appropriate timeouts** for your use case
6. **Monitor connection state** for debugging and analytics
7. **Clean up resources** by calling `disconnect()` when done

## Examples

### Basic Usage

```typescript
import { ResilientWebSocket, ConnectionState } from './ws/resilient-websocket';

const ws = new ResilientWebSocket('wss://api.example.com/ws', {
  onMessage: (event) => {
    const data = JSON.parse(event.data as string);
    console.log('Received:', data);
  },
  onStateChange: (event) => {
    if (event.currentState === ConnectionState.Connected) {
      console.log('Connected!');
    } else if (event.currentState === ConnectionState.Reconnecting) {
      console.log('Reconnecting...');
    }
  },
  onError: (error) => {
    console.error('Connection error:', error);
  }
});

await ws.connect();
await ws.send(JSON.stringify({ type: 'subscribe', channel: 'updates' }));
```

### With Authentication

```typescript
const ws = new ResilientWebSocket('wss://api.example.com/ws', callbacks, {
  getAuthToken: async () => {
    return await getAccessToken(); // Your auth function
  },
  negotiate: async () => {
    const token = await getAccessToken();
    const response = await fetch('https://api.example.com/negotiate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ protocol: 'websocket' })
    });
    return response.json();
  }
});
```

### Custom Reconnection Strategy

```typescript
const ws = new ResilientWebSocket(url, {
  onReconnect: (event) => {
    // Custom reconnection handling
    if (event.attempt > 5) {
      // Show user notification after 5 attempts
      showNotification('Connection issues detected. Retrying...');
    }
  }
}, {
  reconnectMode: ReconnectMode.Stateful,
  maxReconnectAttempts: 20,
  reconnectInitialDelayMs: 500,
  reconnectMaxDelayMs: 60000
});
```

## Integration with Existing Code

The framework can be integrated with the existing `WsGraphClient`:

```typescript
import { ResilientWebSocketTransport } from './ws/resilient-transport';

// Use ResilientWebSocketTransport as a drop-in replacement
// for the basic WebSocket in WsGraphClient
```

## Testing

The framework is designed to be testable:

- Mock WebSocket constructor for testing
- Configurable timeouts for faster test execution
- State change events for assertion
- Message queue for testing buffering behavior

## Browser Compatibility

- Modern browsers with WebSocket support
- Polyfills available for older browsers
- Works in both browser and Node.js environments

## Performance Considerations

- Message buffering has configurable limits
- Exponential backoff prevents server overload
- Heartbeat interval can be tuned for your use case
- Stateful reconnection preserves memory for buffered messages
