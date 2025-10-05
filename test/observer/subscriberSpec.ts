import { Subscriber, Network, Storage } from "@src";

describe("Subscriber", () => {
    let mockNetwork: Network;
    let mockStorage: Storage;
    let notifyFactsAdded: jest.Mock;

    beforeEach(() => {
        // Mock Network interface
        mockNetwork = {
            feeds: jest.fn().mockResolvedValue([]),
            fetchFeed: jest.fn().mockResolvedValue({ references: [], bookmark: "" }),
            streamFeed: jest.fn((feed, bookmark, onResponse, onError) => {
                // Immediately call onResponse to resolve the promise
                setTimeout(() => onResponse([], bookmark), 0);
                return () => {};
            }),
            load: jest.fn().mockResolvedValue([])
        };

        // Mock Storage interface
        mockStorage = {
            close: jest.fn().mockResolvedValue(undefined),
            save: jest.fn().mockResolvedValue([]),
            read: jest.fn().mockResolvedValue([]),
            feed: jest.fn().mockResolvedValue({ tuples: [], bookmark: "" }),
            whichExist: jest.fn().mockResolvedValue([]),
            load: jest.fn().mockResolvedValue([]),
            purge: jest.fn().mockResolvedValue(0),
            purgeDescendants: jest.fn().mockResolvedValue(0),
            loadBookmark: jest.fn().mockResolvedValue(""),
            saveBookmark: jest.fn().mockResolvedValue(undefined),
            getMruDate: jest.fn().mockResolvedValue(null),
            setMruDate: jest.fn().mockResolvedValue(undefined)
        };

        notifyFactsAdded = jest.fn().mockResolvedValue(undefined);
    });

    describe("default refresh interval", () => {
        it("should default feedRefreshIntervalSeconds to 90 seconds", async () => {
            // Given: A Subscriber created without specifying feedRefreshIntervalSeconds
            const subscriber = new Subscriber(
                "test-feed",
                mockNetwork,
                mockStorage,
                notifyFactsAdded,
                undefined as any  // Passing undefined to test default behavior
            );

            // When: We capture the setInterval call when starting the subscriber
            const originalSetInterval = global.setInterval;
            let capturedInterval: number | undefined;
            
            global.setInterval = jest.fn((callback: any, interval: number) => {
                capturedInterval = interval;
                // Return a mock timer ID
                return 12345 as any;
            }) as any;

            try {
                // Start the subscriber and wait for initialization
                await subscriber.start();
            } catch (error) {
                // Ignore errors from promise resolution
            } finally {
                // Clean up
                subscriber.stop();
                global.setInterval = originalSetInterval;
            }

            // Then: setInterval should be called with 90000 milliseconds (90 seconds)
            expect(capturedInterval).toBe(90000);
        });
    });

    describe("connection retry behavior", () => {
        it("should retry failed connections with exponential backoff before falling back to periodic timer", async () => {
            // Given: Mock setTimeout and setInterval to control retry timing
            const originalSetTimeout = global.setTimeout;
            const originalSetInterval = global.setInterval;
            const scheduledTimeouts: Array<{ callback: () => void; delay: number; id: number }> = [];
            const scheduledIntervals: Array<{ callback: () => void; delay: number; id: number }> = [];
            let nextId = 1;

            global.setTimeout = jest.fn((callback: any, delay: number) => {
                const id = nextId++;
                scheduledTimeouts.push({ callback, delay, id });
                return id as any;
            }) as any;

            global.setInterval = jest.fn((callback: any, delay: number) => {
                const id = nextId++;
                scheduledIntervals.push({ callback, delay, id });
                return id as any;
            }) as any;

            global.clearInterval = jest.fn((id: any) => {
                const index = scheduledIntervals.findIndex(t => t.id === id);
                if (index >= 0) {
                    scheduledIntervals.splice(index, 1);
                }
            }) as any;

            try {
                // Given: Mock network that always fails
                mockNetwork.streamFeed = jest.fn((feed, bookmark, onResponse, onError) => {
                    // Always fail immediately
                    onError(new Error("Connection failed"));
                    return () => {};
                });

                // Given: Mock storage with bookmark
                mockStorage.loadBookmark = jest.fn().mockResolvedValue("test-bookmark");
                mockStorage.whichExist = jest.fn().mockResolvedValue([]);
                mockStorage.save = jest.fn().mockResolvedValue([]);
                mockStorage.saveBookmark = jest.fn().mockResolvedValue(undefined);
                mockNetwork.load = jest.fn().mockResolvedValue([]);

                // When: Create subscriber and start it
                const subscriber = new Subscriber(
                    "test-feed",
                    mockNetwork,
                    mockStorage,
                    notifyFactsAdded,
                    90 // feedRefreshIntervalSeconds
                );

                const startPromise = subscriber.start(); // Don't await since it will never resolve with failing network

                // Wait for initial async operations (bookmark load)
                await new Promise(resolve => originalSetTimeout(resolve, 10));

                // Then: First connection attempt should have happened
                expect(mockNetwork.streamFeed).toHaveBeenCalledTimes(1);

                // Then: setInterval should have been set up with 90 second interval
                expect(scheduledIntervals.length).toBe(1);
                expect(scheduledIntervals[0].delay).toBe(90000);

                // Then: First retry should be scheduled with 1 second delay (2^0 * 1000)
                expect(scheduledTimeouts.length).toBeGreaterThan(0);
                expect(scheduledTimeouts[0].delay).toBe(1000);

                // When: Execute first retry
                scheduledTimeouts[0].callback();
                await new Promise(resolve => originalSetTimeout(resolve, 10));

                // Then: Second connection attempt should have happened
                expect(mockNetwork.streamFeed).toHaveBeenCalledTimes(2);

                // Then: Second retry should be scheduled with 2 second delay (2^1 * 1000)
                expect(scheduledTimeouts[1].delay).toBe(2000);

                // When: Execute second retry
                scheduledTimeouts[1].callback();
                await new Promise(resolve => originalSetTimeout(resolve, 10));

                // Then: Third connection attempt should have happened
                expect(mockNetwork.streamFeed).toHaveBeenCalledTimes(3);

                // Then: Third retry should be scheduled with 4 second delay (2^2 * 1000)
                expect(scheduledTimeouts[2].delay).toBe(4000);

                // When: Execute third retry
                scheduledTimeouts[2].callback();
                await new Promise(resolve => originalSetTimeout(resolve, 10));

                // Then: Fourth connection attempt should have happened (max immediate retries reached)
                expect(mockNetwork.streamFeed).toHaveBeenCalledTimes(4);

                // Then: No more immediate retries should be scheduled after max retries
                // (Should fall back to periodic timer only)
                expect(scheduledTimeouts.length).toBe(3); // Only 3 immediate retries scheduled

                // Clean up
                subscriber.stop();
                
                // Verify start promise is rejected when stopped
                await expect(startPromise).rejects.toThrow();
            } finally {
                // Restore original timers
                global.setTimeout = originalSetTimeout;
                global.setInterval = originalSetInterval;
            }
        });

        it("should retry connection on failure and resolve start() promise only on success", async () => {
            // Given: A network that fails on first streamFeed call, succeeds on second
            let streamFeedCallCount = 0;
            let capturedIntervalCallback: (() => void) | undefined;
            
            mockNetwork.streamFeed = jest.fn((feed, bookmark, onResponse, onError) => {
                streamFeedCallCount++;
                
                if (streamFeedCallCount === 1) {
                    // First call: Simulate connection failure
                    setTimeout(() => onError(new Error("Connection failed")), 0);
                } else {
                    // Second call: Simulate successful connection
                    setTimeout(() => onResponse([], bookmark), 0);
                }
                
                return () => {}; // Mock close function
            });

            // Mock storage with bookmark
            mockStorage.loadBookmark = jest.fn().mockResolvedValue("test-bookmark");
            mockStorage.whichExist = jest.fn().mockResolvedValue([]);
            mockStorage.save = jest.fn().mockResolvedValue([]);
            mockStorage.saveBookmark = jest.fn().mockResolvedValue(undefined);

            // Mock network.load to return fact envelopes
            mockNetwork.load = jest.fn().mockResolvedValue([]);

            // Capture the setInterval callback
            const originalSetInterval = global.setInterval;
            global.setInterval = jest.fn((callback: any, interval: number) => {
                capturedIntervalCallback = callback;
                return 12345 as any;
            }) as any;

            try {
                // When: Start the subscriber
                const subscriber = new Subscriber(
                    "test-feed",
                    mockNetwork,
                    mockStorage,
                    notifyFactsAdded,
                    90 // feedRefreshIntervalSeconds
                );

                const startPromise = subscriber.start();

                // Flush initial microtasks to allow first connection attempt
                await new Promise(resolve => setTimeout(resolve, 10));

                // Then: Verify first streamFeed call happened and failed
                expect(mockNetwork.streamFeed).toHaveBeenCalledTimes(1);

                // Then: setInterval should have been called (timer is set up)
                expect(global.setInterval).toHaveBeenCalled();

                // Then: The start promise should still be pending (not resolved yet)
                let promiseResolved = false;
                startPromise.then(() => { promiseResolved = true; });
                await new Promise(resolve => setTimeout(resolve, 10));
                expect(promiseResolved).toBe(false);

                // When: Trigger the retry by calling the interval callback
                if (capturedIntervalCallback) {
                    capturedIntervalCallback();
                }

                // Flush microtasks to allow retry to execute
                await new Promise(resolve => setTimeout(resolve, 10));

                // Then: Verify second streamFeed call happened (retry)
                expect(mockNetwork.streamFeed).toHaveBeenCalledTimes(2);

                // Then: Wait for the promise to resolve after successful connection
                await startPromise;

                // Clean up
                subscriber.stop();
            } finally {
                global.setInterval = originalSetInterval;
            }
        });
    });

    describe("cancellation behavior", () => {
        it("should clear timer and reject start() promise when stop() is called before connection succeeds", async () => {
            // Given: Mock setInterval and clearInterval to verify timer management
            const originalSetInterval = global.setInterval;
            const originalClearInterval = global.clearInterval;
            let capturedTimerId: any;
            const clearIntervalSpy = jest.fn();
            
            global.setInterval = jest.fn((callback: any, interval: number) => {
                capturedTimerId = 12345;
                return capturedTimerId;
            }) as any;
            
            global.clearInterval = clearIntervalSpy as any;

            // Given: A network that never calls onResponse or onError (hanging connection)
            const mockDisconnect = jest.fn();
            mockNetwork.streamFeed = jest.fn((feed, bookmark, onResponse, onError) => {
                // Simulate a hanging connection - never call onResponse or onError
                return mockDisconnect;
            });

            // Given: Storage with a bookmark
            mockStorage.loadBookmark = jest.fn().mockResolvedValue("test-bookmark");
            mockStorage.whichExist = jest.fn().mockResolvedValue([]);
            mockStorage.save = jest.fn().mockResolvedValue([]);
            mockStorage.saveBookmark = jest.fn().mockResolvedValue(undefined);

            // Given: Network load returns empty
            mockNetwork.load = jest.fn().mockResolvedValue([]);

            try {
                // When: Create a subscriber and start it
                const subscriber = new Subscriber(
                    "test-feed",
                    mockNetwork,
                    mockStorage,
                    notifyFactsAdded,
                    90 // feedRefreshIntervalSeconds
                );

                const startPromise = subscriber.start();

                // When: Wait for microtasks to allow timer setup
                await new Promise(resolve => setTimeout(resolve, 10));

                // Then: Verify timer was set up
                expect(global.setInterval).toHaveBeenCalled();

                // When: Call stop() before the connection succeeds
                subscriber.stop();

                // Then: The start() promise should be rejected
                await expect(startPromise).rejects.toThrow();

                // Then: clearInterval should have been called to stop the timer
                expect(clearIntervalSpy).toHaveBeenCalledWith(capturedTimerId);

                // Then: The disconnect function should have been called
                expect(mockDisconnect).toHaveBeenCalled();
            } finally {
                // Clean up
                global.setInterval = originalSetInterval;
                global.clearInterval = originalClearInterval;
            }
        });
    });
});