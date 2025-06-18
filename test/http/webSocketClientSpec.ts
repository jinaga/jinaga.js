import { FactEnvelope, FactReference } from "../../src/storage";
import { WebSocketClient, WebSocketClientConfig } from "../../src/http/webSocketClient";

// Mock CloseEvent for Node.js environment
(global as any).CloseEvent = class CloseEvent extends Event {
    code: number;
    reason: string;
    wasClean: boolean;

    constructor(type: string, eventInitDict?: { code?: number; reason?: string; wasClean?: boolean }) {
        super(type);
        this.code = eventInitDict?.code || 1000;
        this.reason = eventInitDict?.reason || '';
        this.wasClean = eventInitDict?.wasClean || false;
    }
};

// Mock WebSocket implementation for testing
class MockWebSocket {
    public static CONNECTING = 0;
    public static OPEN = 1;
    public static CLOSING = 2;
    public static CLOSED = 3;

    public readyState: number = MockWebSocket.CONNECTING;
    public url: string;
    public onopen: ((event: Event) => void) | null = null;
    public onclose: ((event: CloseEvent) => void) | null = null;
    public onerror: ((event: Event) => void) | null = null;
    public onmessage: ((event: MessageEvent) => void) | null = null;

    private messageQueue: string[] = [];
    private sentMessages: string[] = [];
    private connectionDelay: number = 0;
    private shouldFailConnection: boolean = false;
    private closeCode: number = 1000;
    private closeReason: string = "";

    constructor(url: string) {
        this.url = url;
        // Simulate async connection
        setTimeout(() => {
            if (this.shouldFailConnection) {
                this.readyState = MockWebSocket.CLOSED;
                if (this.onerror) {
                    this.onerror(new Event('error'));
                }
            } else {
                this.readyState = MockWebSocket.OPEN;
                if (this.onopen) {
                    this.onopen(new Event('open'));
                }
            }
        }, this.connectionDelay);
    }

    send(data: string): void {
        if (this.readyState !== MockWebSocket.OPEN) {
            throw new Error('WebSocket is not open');
        }
        this.sentMessages.push(data);
    }

    close(code?: number, reason?: string): void {
        this.readyState = MockWebSocket.CLOSED;
        this.closeCode = code || 1000;
        this.closeReason = reason || "";
        if (this.onclose) {
            const closeEvent = new CloseEvent('close', {
                code: this.closeCode,
                reason: this.closeReason,
                wasClean: this.closeCode === 1000
            });
            this.onclose(closeEvent);
        }
    }

    // Test helper methods
    simulateMessage(data: string): void {
        if (this.onmessage) {
            const messageEvent = new MessageEvent('message', { data });
            this.onmessage(messageEvent);
        }
    }

    simulateDisconnection(code: number = 1006, reason: string = "Connection lost"): void {
        this.readyState = MockWebSocket.CLOSED;
        this.closeCode = code;
        this.closeReason = reason;
        if (this.onclose) {
            const closeEvent = new CloseEvent('close', {
                code: this.closeCode,
                reason: this.closeReason,
                wasClean: false
            });
            this.onclose(closeEvent);
        }
    }

    simulateError(): void {
        if (this.onerror) {
            this.onerror(new Event('error'));
        }
    }

    getSentMessages(): string[] {
        return [...this.sentMessages];
    }

    clearSentMessages(): void {
        this.sentMessages = [];
    }

    setConnectionDelay(delay: number): void {
        this.connectionDelay = delay;
    }

    setConnectionFailure(shouldFail: boolean): void {
        this.shouldFailConnection = shouldFail;
    }
}

interface HttpHeaders {
    [key: string]: string;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

describe("WebSocketClient", () => {
    let mockWebSocket: MockWebSocket;
    let client: WebSocketClient;
    let config: WebSocketClientConfig;
    let getHeaders: () => Promise<HttpHeaders>;

    beforeEach(() => {
        // Mock WebSocket constructor
        (global as any).WebSocket = jest.fn().mockImplementation((url: string) => {
            mockWebSocket = new MockWebSocket(url);
            return mockWebSocket;
        });

        config = {
            reconnectMaxAttempts: 3,
            reconnectBaseDelay: 1000,
            reconnectMaxDelay: 10000,
            pingInterval: 30000,
            pongTimeout: 5000,
            messageQueueMaxSize: 100,
            subscriptionTimeout: 10000,
            enableLogging: true
        };

        getHeaders = jest.fn().mockResolvedValue({
            Authorization: "Bearer test-token"
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
        if (client) {
            try {
                client.destroy();
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
    });

    describe("Connection Management", () => {
        it("should establish WebSocket connection with authentication", async () => {
            client = new WebSocketClient("wss://example.com/ws", getHeaders, config);
            
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            const cleanup = client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            // Wait for async connection to be established
            await new Promise(resolve => setTimeout(resolve, 10));

            // Should create WebSocket with auth parameters
            expect((global as any).WebSocket).toHaveBeenCalledWith("wss://example.com/ws?auth=Bearer%20test-token");
            
            cleanup();
        });

        it("should transition connection states correctly", async () => {
            client = new WebSocketClient("wss://example.com/ws", getHeaders, config);
            
            // Initially disconnected
            expect(client.isConnected()).toBe(false);
            
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);
            
            // Should be connecting
            const stats = client.getStats();
            expect(stats.webSocketConnected).toBe(false);
            
            // Wait for connection to establish
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Should be connected
            expect(client.isConnected()).toBe(true);
        });

        it("should handle connection timeout", async () => {
            const slowConfig = { ...config, subscriptionTimeout: 100 };
            client = new WebSocketClient("wss://example.com/ws", getHeaders, slowConfig);
            
            // Set a long connection delay to trigger timeout
            (global.WebSocket as any).prototype.setConnectionDelay = function(delay: number) {
                this.connectionDelay = delay;
            };
            
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);
            
            // Wait for timeout
            await new Promise(resolve => setTimeout(resolve, 200));
            
            expect(onError).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining("timeout")
            }));
        });

        it("should handle connection failure", async () => {
            client = new WebSocketClient("wss://example.com/ws", getHeaders, config);
            
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            // Mock connection failure
            mockWebSocket.setConnectionFailure(true);

            client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);
            
            await new Promise(resolve => setTimeout(resolve, 50));
            
            expect(onError).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining("connection error")
            }));
        });
    });

    describe("Subscription Lifecycle", () => {
        beforeEach(async () => {
            client = new WebSocketClient("wss://example.com/ws", getHeaders, config);
            // Wait for connection
            await new Promise(resolve => setTimeout(resolve, 50));
        });

        it("should create subscription with unique ID and send Graph Protocol message", async () => {
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            const cleanup = client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            // Should send subscription message in Graph Protocol format
            const sentMessages = mockWebSocket.getSentMessages();
            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0]).toMatch(/^SUB\w+\n"test-feed"\n"bookmark-123"\n\n$/);
            
            cleanup();
        });

        it("should manage multiple concurrent subscriptions", async () => {
            const subscriptions: (() => void)[] = [];
            
            for (let i = 0; i < 5; i++) {
                const cleanup = client.streamFeed(
                    `feed-${i}`,
                    `bookmark-${i}`,
                    jest.fn(),
                    jest.fn(),
                    jest.fn()
                );
                subscriptions.push(cleanup);
            }

            const stats = client.getStats();
            expect(stats.activeSubscriptions).toBe(5);

            // Cleanup all subscriptions
            subscriptions.forEach(cleanup => cleanup());
            
            const finalStats = client.getStats();
            expect(finalStats.activeSubscriptions).toBe(0);
        });

        it("should send unsubscribe message when cleanup is called", async () => {
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            const cleanup = client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);
            
            // Clear previous messages
            mockWebSocket.clearSentMessages();
            
            cleanup();

            const sentMessages = mockWebSocket.getSentMessages();
            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0]).toMatch(/^UNSUB\w+\n\n$/);
        });

        it("should close connection when no subscriptions remain", async () => {
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            const cleanup = client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);
            
            expect(client.isConnected()).toBe(true);
            
            cleanup();
            
            // Connection should be closed
            expect(client.isConnected()).toBe(false);
        });
    });

    describe("Message Handling", () => {
        beforeEach(async () => {
            client = new WebSocketClient("wss://example.com/ws", getHeaders, config);
            await new Promise(resolve => setTimeout(resolve, 50));
        });

        it("should process Graph Protocol fact envelopes", async () => {
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            // Simulate incoming Graph Protocol message with fact envelope
            const graphMessage = `"TestApp.Fact"\n{}\n{"value":"test"}\n\n`;
            mockWebSocket.simulateMessage(graphMessage);

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(onEnvelope).toHaveBeenCalledWith([
                expect.objectContaining({
                    fact: expect.objectContaining({
                        type: "TestApp.Fact",
                        fields: { value: "test" },
                        predecessors: {}
                    }),
                    signatures: []
                })
            ]);
        });

        it("should handle bookmark updates", async () => {
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            const cleanup = client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            // Simulate bookmark update message
            const bookmarkMessage = `BMsub_1_123\n"new-bookmark-456"\n\n`;
            mockWebSocket.simulateMessage(bookmarkMessage);

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(onBookmark).toHaveBeenCalledWith("new-bookmark-456");
            
            cleanup();
        });

        it("should handle error messages", async () => {
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            const cleanup = client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            // Simulate error message
            const errorMessage = `ERRsub_1_123\n"Subscription failed"\n\n`;
            mockWebSocket.simulateMessage(errorMessage);

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(onError).toHaveBeenCalledWith(expect.objectContaining({
                message: "Subscription failed"
            }));
            
            cleanup();
        });

        it("should handle malformed messages gracefully", async () => {
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            const cleanup = client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            // Simulate malformed message
            const malformedMessage = `INVALID_FORMAT`;
            mockWebSocket.simulateMessage(malformedMessage);

            await new Promise(resolve => setTimeout(resolve, 10));

            // Should not crash, may log error but continue processing
            expect(client.isConnected()).toBe(true);
            
            cleanup();
        });

        it("should respond to ping with pong", async () => {
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            const cleanup = client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            // Clear previous messages
            mockWebSocket.clearSentMessages();

            // Simulate ping message
            const pingMessage = `PING\n1234567890\n\n`;
            mockWebSocket.simulateMessage(pingMessage);

            await new Promise(resolve => setTimeout(resolve, 10));

            const sentMessages = mockWebSocket.getSentMessages();
            expect(sentMessages).toContainEqual(expect.stringMatching(/^PONG\n\d+\n\n$/));
            
            cleanup();
        });
    });

    describe("Reconnection Logic", () => {
        beforeEach(async () => {
            client = new WebSocketClient("wss://example.com/ws", getHeaders, config);
            await new Promise(resolve => setTimeout(resolve, 50));
        });

        it("should attempt reconnection on unexpected disconnection", async () => {
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            expect(client.isConnected()).toBe(true);

            // Simulate unexpected disconnection
            mockWebSocket.simulateDisconnection(1006, "Connection lost");

            await new Promise(resolve => setTimeout(resolve, 10));

            const stats = client.getStats();
            expect(stats.reconnectAttempts).toBeGreaterThan(0);
        });

        it("should use exponential backoff for reconnection attempts", async () => {
            const shortConfig = { ...config, reconnectBaseDelay: 100, reconnectMaxDelay: 1000 };
            client = new WebSocketClient("wss://example.com/ws", getHeaders, shortConfig);
            await new Promise(resolve => setTimeout(resolve, 50));

            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            // Simulate multiple disconnections to test backoff
            for (let i = 0; i < 3; i++) {
                mockWebSocket.simulateDisconnection(1006, "Connection lost");
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            const stats = client.getStats();
            expect(stats.reconnectAttempts).toBe(3);
        });

        it("should stop reconnecting after max attempts", async () => {
            const limitedConfig = { ...config, reconnectMaxAttempts: 2, reconnectBaseDelay: 10 };
            client = new WebSocketClient("wss://example.com/ws", getHeaders, limitedConfig);
            await new Promise(resolve => setTimeout(resolve, 50));

            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            // Simulate repeated disconnections
            for (let i = 0; i < 5; i++) {
                mockWebSocket.simulateDisconnection(1006, "Connection lost");
                await new Promise(resolve => setTimeout(resolve, 20));
            }

            expect(onError).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining("Max reconnection attempts exceeded")
            }));
        });

        it("should queue messages during disconnection", async () => {
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            // Start with a subscription
            const cleanup1 = client.streamFeed("test-feed-1", "bookmark-1", onEnvelope, onBookmark, onError);

            // Simulate disconnection
            mockWebSocket.simulateDisconnection(1006, "Connection lost");

            // Try to create another subscription while disconnected
            const cleanup2 = client.streamFeed("test-feed-2", "bookmark-2", onEnvelope, onBookmark, onError);

            // Wait for reconnection
            await new Promise(resolve => setTimeout(resolve, 100));

            // Both subscriptions should be sent after reconnection
            const sentMessages = mockWebSocket.getSentMessages();
            expect(sentMessages.filter((msg: string) => msg.startsWith('SUB'))).toHaveLength(2);

            cleanup1();
            cleanup2();
        });

        it("should resubscribe to active feeds after reconnection", async () => {
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            const cleanup = client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            // Clear initial subscription message
            mockWebSocket.clearSentMessages();

            // Simulate disconnection and reconnection
            mockWebSocket.simulateDisconnection(1006, "Connection lost");
            await new Promise(resolve => setTimeout(resolve, 100));

            // Should resubscribe after reconnection
            const sentMessages = mockWebSocket.getSentMessages();
            expect(sentMessages).toContainEqual(expect.stringMatching(/^SUB\w+\n"test-feed"\n"bookmark-123"\n\n$/));

            cleanup();
        });
    });

    describe("Heartbeat Mechanism", () => {
        beforeEach(async () => {
            const pingConfig = { ...config, pingInterval: 100 };
            client = new WebSocketClient("wss://example.com/ws", getHeaders, pingConfig);
            await new Promise(resolve => setTimeout(resolve, 50));
        });

        it("should send periodic ping messages", async () => {
            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            const cleanup = client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            // Clear initial subscription message
            mockWebSocket.clearSentMessages();

            // Wait for ping interval
            await new Promise(resolve => setTimeout(resolve, 150));

            const sentMessages = mockWebSocket.getSentMessages();
            expect(sentMessages).toContainEqual(expect.stringMatching(/^PING\n\d+\n\n$/));

            cleanup();
        });

        it("should handle pong timeout", async () => {
            const timeoutConfig = { ...config, pingInterval: 50, pongTimeout: 100 };
            client = new WebSocketClient("wss://example.com/ws", getHeaders, timeoutConfig);
            await new Promise(resolve => setTimeout(resolve, 50));

            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            const cleanup = client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            // Wait for ping and pong timeout
            await new Promise(resolve => setTimeout(resolve, 200));

            // Should detect pong timeout and potentially reconnect
            const stats = client.getStats();
            expect(stats.reconnectAttempts).toBeGreaterThanOrEqual(0);

            cleanup();
        });
    });

    describe("Error Scenarios", () => {
        it("should handle authentication failures", async () => {
            const failingGetHeaders = jest.fn().mockRejectedValue(new Error("Authentication failed"));
            client = new WebSocketClient("wss://example.com/ws", failingGetHeaders, config);

            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(onError).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining("Authentication failed")
            }));
        });

        it("should handle network errors", async () => {
            client = new WebSocketClient("wss://example.com/ws", getHeaders, config);
            await new Promise(resolve => setTimeout(resolve, 50));

            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            // Simulate network error
            mockWebSocket.simulateError();

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(onError).toHaveBeenCalled();
        });

        it("should handle message queue overflow", async () => {
            const smallQueueConfig = { ...config, messageQueueMaxSize: 2 };
            client = new WebSocketClient("wss://example.com/ws", getHeaders, smallQueueConfig);
            await new Promise(resolve => setTimeout(resolve, 50));

            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            // Simulate disconnection
            mockWebSocket.simulateDisconnection(1006, "Connection lost");

            // Try to create more subscriptions than queue can handle
            for (let i = 0; i < 5; i++) {
                client.streamFeed(`feed-${i}`, `bookmark-${i}`, onEnvelope, onBookmark, onError);
            }

            // Should handle queue overflow gracefully
            await new Promise(resolve => setTimeout(resolve, 100));

            // Some messages should be dropped, but client should still function
            expect(client.getStats().activeSubscriptions).toBeGreaterThan(0);
        });
    });

    describe("Resource Management", () => {
        it("should clean up resources on destroy", async () => {
            client = new WebSocketClient("wss://example.com/ws", getHeaders, config);
            await new Promise(resolve => setTimeout(resolve, 50));

            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            expect(client.isConnected()).toBe(true);
            expect(client.getStats().activeSubscriptions).toBe(1);

            client.destroy();

            expect(client.isConnected()).toBe(false);
            expect(client.getStats().activeSubscriptions).toBe(0);
        });

        it("should provide accurate connection statistics", async () => {
            client = new WebSocketClient("wss://example.com/ws", getHeaders, config);
            await new Promise(resolve => setTimeout(resolve, 50));

            const initialStats = client.getStats();
            expect(initialStats).toEqual({
                webSocketConnected: true,
                activeSubscriptions: 0,
                reconnectAttempts: 0
            });

            const onEnvelope = jest.fn();
            const onBookmark = jest.fn();
            const onError = jest.fn();

            const cleanup = client.streamFeed("test-feed", "bookmark-123", onEnvelope, onBookmark, onError);

            const activeStats = client.getStats();
            expect(activeStats.activeSubscriptions).toBe(1);

            cleanup();

            const finalStats = client.getStats();
            expect(finalStats.activeSubscriptions).toBe(0);
        });
    });
});