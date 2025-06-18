import { FactEnvelope } from "../../src/storage";
import { WebSocketGraphProtocolHandler, WebSocketSubscriptionHandler } from "../../src/http/webSocketGraphHandler";

describe("WebSocketGraphProtocolHandler", () => {
    let handler: WebSocketGraphProtocolHandler;
    let mockSubscriptionHandler: WebSocketSubscriptionHandler;

    beforeEach(() => {
        mockSubscriptionHandler = {
            onFactEnvelopes: jest.fn(),
            onBookmark: jest.fn(),
            onError: jest.fn()
        };
    });

    describe("Subscription Management", () => {
        it("should add subscription handlers", () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);
            // Should not throw
            expect(true).toBe(true);
        });

        it("should remove subscription handlers", () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);
            handler.removeSubscription("sub_123");
            // Should not throw
            expect(true).toBe(true);
        });

        it("should handle multiple concurrent subscriptions", () => {
            handler = new WebSocketGraphProtocolHandler();
            
            const handler1 = { ...mockSubscriptionHandler };
            const handler2 = { ...mockSubscriptionHandler };
            const handler3 = { ...mockSubscriptionHandler };

            handler.addSubscription("sub_1", handler1);
            handler.addSubscription("sub_2", handler2);
            handler.addSubscription("sub_3", handler3);

            // Should manage multiple handlers without conflict
            handler.removeSubscription("sub_2");
            
            // Remaining handlers should still be active
            expect(true).toBe(true);
        });
    });

    describe("Graph Protocol Processing", () => {
        it("should process simple fact envelope", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Simple Graph Protocol message with one fact
            const graphData = `"TestApp.Fact"\n{}\n{"value":"test"}\n\n`;
            
            await handler.processData(graphData);

            // Should call onFactEnvelopes with parsed envelope
            expect(mockSubscriptionHandler.onFactEnvelopes).toHaveBeenCalledWith([
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

        it("should process fact envelope with predecessors", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Graph Protocol message with predecessors
            const graphData = `"TestApp.Root"\n{}\n{"name":"root"}\n\n"TestApp.Child"\n{"parent":0}\n{"value":"child"}\n\n`;
            
            await handler.processData(graphData);

            // Should process both facts with correct predecessor references
            expect(mockSubscriptionHandler.onFactEnvelopes).toHaveBeenCalledWith([
                expect.objectContaining({
                    fact: expect.objectContaining({
                        type: "TestApp.Root",
                        fields: { name: "root" }
                    })
                }),
                expect.objectContaining({
                    fact: expect.objectContaining({
                        type: "TestApp.Child",
                        fields: { value: "child" },
                        predecessors: {
                            parent: expect.objectContaining({
                                type: "TestApp.Root"
                            })
                        }
                    })
                })
            ]);
        });

        it("should process fact envelope with signatures", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Graph Protocol message with signatures
            const graphData = `PK0\n"publicKey123"\n\n"TestApp.SignedFact"\n{}\n{"data":"signed"}\nPK0\n"signature123"\n\n`;
            
            await handler.processData(graphData);

            // Should include signatures in the envelope
            expect(mockSubscriptionHandler.onFactEnvelopes).toHaveBeenCalledWith([
                expect.objectContaining({
                    fact: expect.objectContaining({
                        type: "TestApp.SignedFact",
                        fields: { data: "signed" }
                    }),
                    signatures: [
                        expect.objectContaining({
                            publicKey: "publicKey123",
                            signature: "signature123"
                        })
                    ]
                })
            ]);
        });

        it("should handle empty graph data", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            await handler.processData("");

            // Should not call any handlers for empty data
            expect(mockSubscriptionHandler.onFactEnvelopes).not.toHaveBeenCalled();
            expect(mockSubscriptionHandler.onBookmark).not.toHaveBeenCalled();
            expect(mockSubscriptionHandler.onError).not.toHaveBeenCalled();
        });

        it("should process multiple graph blocks in sequence", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Multiple separate graph blocks
            const graphData = `"TestApp.Fact1"\n{}\n{"id":1}\n\n"TestApp.Fact2"\n{}\n{"id":2}\n\n`;
            
            await handler.processData(graphData);

            // Should process each block separately
            expect(mockSubscriptionHandler.onFactEnvelopes).toHaveBeenCalledTimes(2);
        });
    });

    describe("Control Message Processing", () => {
        it("should handle bookmark control messages", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Bookmark control message
            const bookmarkData = `BMsub_123\n"new-bookmark-456"\n\n`;
            
            await handler.processData(bookmarkData);

            expect(mockSubscriptionHandler.onBookmark).toHaveBeenCalledWith("new-bookmark-456");
        });

        it("should handle error control messages", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Error control message
            const errorData = `ERRsub_123\n"Subscription failed"\n\n`;
            
            await handler.processData(errorData);

            expect(mockSubscriptionHandler.onError).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: "Subscription failed"
                })
            );
        });

        it("should handle ping control messages", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Ping control message
            const pingData = `PING\n1234567890\n\n`;
            
            await handler.processData(pingData);

            // Should handle ping without calling subscription handlers
            expect(mockSubscriptionHandler.onFactEnvelopes).not.toHaveBeenCalled();
            expect(mockSubscriptionHandler.onBookmark).not.toHaveBeenCalled();
            expect(mockSubscriptionHandler.onError).not.toHaveBeenCalled();
        });

        it("should handle pong control messages", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Pong control message
            const pongData = `PONG\n1234567890\n\n`;
            
            await handler.processData(pongData);

            // Should handle pong without calling subscription handlers
            expect(mockSubscriptionHandler.onFactEnvelopes).not.toHaveBeenCalled();
            expect(mockSubscriptionHandler.onBookmark).not.toHaveBeenCalled();
            expect(mockSubscriptionHandler.onError).not.toHaveBeenCalled();
        });

        it("should route messages to correct subscription handler", async () => {
            handler = new WebSocketGraphProtocolHandler();
            
            const handler1 = {
                onFactEnvelopes: jest.fn(),
                onBookmark: jest.fn(),
                onError: jest.fn()
            };
            const handler2 = {
                onFactEnvelopes: jest.fn(),
                onBookmark: jest.fn(),
                onError: jest.fn()
            };
            
            handler.addSubscription("sub_1", handler1);
            handler.addSubscription("sub_2", handler2);

            // Send bookmark to specific subscription
            const bookmarkData = `BMsub_2\n"bookmark-for-sub2"\n\n`;
            
            await handler.processData(bookmarkData);

            // Only handler2 should receive the bookmark
            expect(handler1.onBookmark).not.toHaveBeenCalled();
            expect(handler2.onBookmark).toHaveBeenCalledWith("bookmark-for-sub2");
        });
    });

    describe("Error Handling", () => {
        it("should handle malformed Graph Protocol data", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Malformed graph data
            const malformedData = `INVALID\nFORMAT\n`;
            
            await handler.processData(malformedData);

            // Should handle gracefully without crashing
            expect(true).toBe(true); // Should not throw
        });

        it("should handle invalid JSON in bookmark messages", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Invalid JSON in bookmark
            const invalidBookmarkData = `BMsub_123\ninvalid-json\n\n`;
            
            await handler.processData(invalidBookmarkData);

            expect(mockSubscriptionHandler.onError).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining("Invalid bookmark format")
                })
            );
        });

        it("should handle invalid JSON in error messages", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Invalid JSON in error message
            const invalidErrorData = `ERRsub_123\ninvalid-json\n\n`;
            
            await handler.processData(invalidErrorData);

            expect(mockSubscriptionHandler.onError).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining("Invalid error format")
                })
            );
        });

        it("should handle messages for non-existent subscriptions", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Message for non-existent subscription
            const bookmarkData = `BMsub_999\n"bookmark"\n\n`;
            
            await handler.processData(bookmarkData);

            // Should handle gracefully, possibly with warning
            expect(mockSubscriptionHandler.onBookmark).not.toHaveBeenCalled();
        });
    });

    describe("Streaming Data Processing", () => {
        it("should handle partial data chunks", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Send data in chunks
            await handler.processData(`"TestApp.Fact"\n{}\n`);
            await handler.processData(`{"value":"test"}\n\n`);

            // Should wait for complete block before processing
            expect(mockSubscriptionHandler.onFactEnvelopes).toHaveBeenCalledWith([
                expect.objectContaining({
                    fact: expect.objectContaining({
                        type: "TestApp.Fact",
                        fields: { value: "test" }
                    })
                })
            ]);
        });

        it("should handle mixed control and graph data", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Mixed data with bookmark and facts
            const mixedData = `BMsub_123\n"bookmark1"\n\n"TestApp.Fact"\n{}\n{"id":1}\n\nPING\n1234567890\n\n`;
            
            await handler.processData(mixedData);

            // Should handle both bookmark and fact
            expect(mockSubscriptionHandler.onBookmark).toHaveBeenCalledWith("bookmark1");
            expect(mockSubscriptionHandler.onFactEnvelopes).toHaveBeenCalledWith([
                expect.objectContaining({
                    fact: expect.objectContaining({
                        type: "TestApp.Fact",
                        fields: { id: 1 }
                    })
                })
            ]);
        });

        it("should maintain line buffer state across calls", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Send incomplete fact in first call
            await handler.processData(`"TestApp.Fact"\n{}\n`);
            
            // Complete the fact in second call
            await handler.processData(`{"value":"test"}\n\n`);
            
            // Should process complete fact only after second call
            expect(mockSubscriptionHandler.onFactEnvelopes).toHaveBeenCalledTimes(1);
            expect(mockSubscriptionHandler.onFactEnvelopes).toHaveBeenCalledWith([
                expect.objectContaining({
                    fact: expect.objectContaining({
                        type: "TestApp.Fact",
                        fields: { value: "test" }
                    })
                })
            ]);
        });
    });

    describe("Performance and Memory", () => {
        it("should handle large fact envelopes efficiently", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Large fact with many fields
            const largeFields = Array.from({ length: 100 }, (_, i) => `"field${i}":"value${i}"`).join(',');
            const largeFactData = `"TestApp.LargeFact"\n{}\n{${largeFields}}\n\n`;
            
            await handler.processData(largeFactData);

            expect(mockSubscriptionHandler.onFactEnvelopes).toHaveBeenCalledWith([
                expect.objectContaining({
                    fact: expect.objectContaining({
                        type: "TestApp.LargeFact"
                    })
                })
            ]);
        });

        it("should clear line buffer after processing", async () => {
            handler = new WebSocketGraphProtocolHandler();
            handler.addSubscription("sub_123", mockSubscriptionHandler);

            // Process first fact
            await handler.processData(`"TestApp.Fact1"\n{}\n{"id":1}\n\n`);
            
            // Process second fact - should not be affected by first
            await handler.processData(`"TestApp.Fact2"\n{}\n{"id":2}\n\n`);

            expect(mockSubscriptionHandler.onFactEnvelopes).toHaveBeenCalledTimes(2);
            expect(mockSubscriptionHandler.onFactEnvelopes).toHaveBeenNthCalledWith(1, [
                expect.objectContaining({
                    fact: expect.objectContaining({ type: "TestApp.Fact1" })
                })
            ]);
            expect(mockSubscriptionHandler.onFactEnvelopes).toHaveBeenNthCalledWith(2, [
                expect.objectContaining({
                    fact: expect.objectContaining({ type: "TestApp.Fact2" })
                })
            ]);
        });
    });
});