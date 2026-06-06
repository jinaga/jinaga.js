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

    afterEach(() => {
        // Clean up any fake timers
        try {
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
        } catch (e) {
            // Ignore errors during cleanup
        }
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
            // Given: Mock setTimeout to control retry timing
            const originalSetTimeout = global.setTimeout;
            const scheduledTimeouts: Array<{ callback: () => void; delay: number }> = [];
            
            global.setTimeout = jest.fn((callback: any, delay: number) => {
                scheduledTimeouts.push({ callback, delay });
                return 12345 as any;
            }) as any;

            // Given: A network that fails on first streamFeed call, succeeds on second
            let streamFeedCallCount = 0;
            let capturedIntervalCallback: (() => void) | undefined;
            
            mockNetwork.streamFeed = jest.fn((feed, bookmark, onResponse, onError) => {
                streamFeedCallCount++;
                
                if (streamFeedCallCount === 1) {
                    // First call: Simulate connection failure
                    onError(new Error("Connection failed"));
                } else {
                    // Second call: Simulate successful connection
                    onResponse([], bookmark);
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
                await new Promise(resolve => originalSetTimeout(resolve, 10));

                // Then: Verify first streamFeed call happened and failed
                expect(mockNetwork.streamFeed).toHaveBeenCalledTimes(1);

                // Then: setInterval should have been called (timer is set up)
                expect(global.setInterval).toHaveBeenCalled();

                // Then: A retry should be scheduled with 1 second delay
                expect(scheduledTimeouts.length).toBeGreaterThan(0);
                expect(scheduledTimeouts[0].delay).toBe(1000);

                // When: Execute the scheduled retry
                scheduledTimeouts[0].callback();
                
                // Flush microtasks to allow retry to execute
                await new Promise(resolve => originalSetTimeout(resolve, 10));

                // Then: Verify second streamFeed call happened (retry)
                expect(mockNetwork.streamFeed).toHaveBeenCalledTimes(2);

                // Then: Wait for the promise to resolve after successful connection
                await startPromise;

                // Clean up
                subscriber.stop();
            } finally {
                global.setInterval = originalSetInterval;
                global.setTimeout = originalSetTimeout;
            }
        });

        it("should not create tight loop when errors occur synchronously after max retries", async () => {
            // Workaround for Jest 28 performance object bug
            const originalPerformance = global.performance;
            try {
                delete (global as any).performance;
                jest.useFakeTimers();
            } catch (e) {
                global.performance = originalPerformance;
                throw e;
            }
            
            try {
                // Track all streamFeed calls
                let callCount = 0;
                
                // Given: Mock network that synchronously calls onError (simulating NetworkDistribution.streamFeed behavior)
                mockNetwork.streamFeed = jest.fn((feed, bookmark, onResponse, onError) => {
                    callCount++;
                    // Synchronously call onError to simulate immediate failure
                    onError(new Error("Connection failed"));
                    return () => {};
                });

                // Given: Mock storage with bookmark
                mockStorage.loadBookmark = jest.fn().mockResolvedValue("test-bookmark");
                mockStorage.whichExist = jest.fn().mockResolvedValue([]);
                mockStorage.save = jest.fn().mockResolvedValue([]);
                mockStorage.saveBookmark = jest.fn().mockResolvedValue(undefined);
                mockNetwork.load = jest.fn().mockResolvedValue([]);

                // When: Create subscriber with short refresh interval (1 second for faster testing)
                const subscriber = new Subscriber(
                    "test-feed",
                    mockNetwork,
                    mockStorage,
                    notifyFactsAdded,
                    1 // feedRefreshIntervalSeconds - 1 second for fake timer testing
                );

                try {
                    // When: Start the subscriber
                    const startPromise = subscriber.start().catch(() => {});

                    // Advance through immediate retries
                    // Initial connection attempt happens immediately
                    await Promise.resolve();
                    
                    // First retry after 1 second
                    jest.advanceTimersByTime(1000);
                    await Promise.resolve();
                    
                    // Second retry after 2 seconds
                    jest.advanceTimersByTime(2000);
                    await Promise.resolve();
                    
                    // Third retry after 4 seconds
                    jest.advanceTimersByTime(4000);
                    await Promise.resolve();
                    
                    // Now advance through a couple interval-based attempts (1 second intervals)
                    jest.advanceTimersByTime(1000);
                    await Promise.resolve();
                    
                    jest.advanceTimersByTime(1000);
                    await Promise.resolve();

                    // Then: Verify callCount proves no tight loop
                    // Should have: 1 initial + 3 immediate retries + a few interval-based retries
                    // Should be around 4-10 calls total, definitely not hundreds
                    expect(callCount).toBeGreaterThanOrEqual(4); // At least initial + 3 retries
                    expect(callCount).toBeLessThan(20); // But not a tight loop
                } finally {
                    subscriber.stop();
                    jest.runAllTimers(); // Clear any remaining timers
                }
            } finally {
                jest.useRealTimers();
                global.performance = originalPerformance;
            }
        });
        
        it("should clear isConnecting before executing scheduled retry", async () => {
            // Workaround for Jest 28 performance object bug
            const originalPerformance = global.performance;
            try {
                delete (global as any).performance;
                jest.useFakeTimers();
            } catch (e) {
                global.performance = originalPerformance;
                throw e;
            }
            
            try {
                // Given: Track the total number of streamFeed calls
                let streamFeedCallCount = 0;
                
                // Given: Mock network where streamFeed calls onError for the first 2 attempts, then onResponse successfully on the third
                mockNetwork.streamFeed = jest.fn((feed, bookmark, onResponse, onError) => {
                    streamFeedCallCount++;
                    
                    if (streamFeedCallCount <= 2) {
                        // First two calls: fail immediately
                        onError(new Error("Connection failed"));
                    } else {
                        // Third call: succeed
                        onResponse([], bookmark);
                    }
                    
                    return () => {};
                });

                // Given: Mock storage with bookmark
                mockStorage.loadBookmark = jest.fn().mockResolvedValue("test-bookmark");
                mockStorage.whichExist = jest.fn().mockResolvedValue([]);
                mockStorage.save = jest.fn().mockResolvedValue([]);
                mockStorage.saveBookmark = jest.fn().mockResolvedValue(undefined);
                mockNetwork.load = jest.fn().mockResolvedValue([]);

                // When: Create subscriber with long refresh interval (90 seconds) so only retries happen
                const subscriber = new Subscriber(
                    "test-feed",
                    mockNetwork,
                    mockStorage,
                    notifyFactsAdded,
                    90 // feedRefreshIntervalSeconds - 90 seconds to avoid interval triggers during test
                );

                try {
                    const startPromise = subscriber.start();

                    // Flush initial microtasks to allow first connection attempt
                    await Promise.resolve();

                    // Then: Verify first streamFeed call happened and failed
                    expect(mockNetwork.streamFeed).toHaveBeenCalledTimes(1);

                    // When: Execute first retry (1 second delay)
                    jest.advanceTimersByTime(1000);
                    await Promise.resolve();

                    // Then: Verify second streamFeed call happened (first retry)
                    expect(mockNetwork.streamFeed).toHaveBeenCalledTimes(2);

                    // When: Execute second retry (2 second delay)
                    jest.advanceTimersByTime(2000);
                    await Promise.resolve();

                    // Then: Verify third streamFeed call happened (second retry) and succeeded
                    expect(mockNetwork.streamFeed).toHaveBeenCalledTimes(3);

                    // Then: Wait for the promise to resolve after successful connection
                    await startPromise;

                    // Then: Verify streamFeed was called exactly 3 times (1 initial + 2 retries)
                    expect(streamFeedCallCount).toBe(3);
                } finally {
                    subscriber.stop();
                    jest.runAllTimers(); // Clear any remaining timers
                }
            } finally {
                jest.useRealTimers();
                global.performance = originalPerformance;
            }
        });
    });

    describe("cancellation behavior", () => {
        it("should clear timer and reject start() promise when stop() is called before connection succeeds", async () => {
            // Workaround for Jest 28 performance object bug
            const originalPerformance = global.performance;
            try {
                delete (global as any).performance;
                jest.useFakeTimers();
            } catch (e) {
                global.performance = originalPerformance;
                throw e;
            }
            
            try {
                let capturedTimerId: any;
                const clearIntervalSpy = jest.fn();
                
                // Given: Mock setInterval and clearInterval to verify timer management
                const originalSetInterval = global.setInterval;
                const originalClearInterval = global.clearInterval;
                
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

                // When: Create a subscriber and start it
                const subscriber = new Subscriber(
                    "test-feed",
                    mockNetwork,
                    mockStorage,
                    notifyFactsAdded,
                    90 // feedRefreshIntervalSeconds
                );

                try {
                    const startPromise = subscriber.start();

                    // When: Allow timer setup
                    await Promise.resolve();

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
                    jest.runAllTimers(); // Clear any remaining timers
                    global.setInterval = originalSetInterval;
                    global.clearInterval = originalClearInterval;
                }
            } finally {
                jest.useRealTimers();
                global.performance = originalPerformance;
            }
        });

        it("should prevent concurrent connection attempts when isConnecting is true", async () => {
            // Workaround for Jest 28 performance object bug
            const originalPerformance = global.performance;
            try {
                delete (global as any).performance;
                jest.useFakeTimers();
            } catch (e) {
                global.performance = originalPerformance;
                throw e;
            }
            
            try {
                let capturedIntervalCallback: (() => void) | undefined;
                
                // Given: Mock setInterval to capture the callback
                const originalSetInterval = global.setInterval;
                global.setInterval = jest.fn((callback: any, interval: number) => {
                    capturedIntervalCallback = callback;
                    return 12345 as any;
                }) as any;

                // Given: A network where streamFeed returns disconnect but never calls callbacks
                // (simulating a long-running connection)
                const mockDisconnect = jest.fn();
                mockNetwork.streamFeed = jest.fn((feed, bookmark, onResponse, onError) => {
                    // Never call onResponse or onError - simulate connection in progress
                    return mockDisconnect;
                });

                // Given: Storage with a bookmark
                mockStorage.loadBookmark = jest.fn().mockResolvedValue("test-bookmark");
                mockStorage.whichExist = jest.fn().mockResolvedValue([]);
                mockStorage.save = jest.fn().mockResolvedValue([]);
                mockStorage.saveBookmark = jest.fn().mockResolvedValue(undefined);
                mockNetwork.load = jest.fn().mockResolvedValue([]);

                // When: Create and start a subscriber
                const subscriber = new Subscriber(
                    "test-feed",
                    mockNetwork,
                    mockStorage,
                    notifyFactsAdded,
                    90 // feedRefreshIntervalSeconds
                );

                try {
                    const startPromise = subscriber.start();

                    // When: Wait for initial connection attempt to begin
                    await Promise.resolve();

                    // Then: Verify first streamFeed call happened
                    expect(mockNetwork.streamFeed).toHaveBeenCalledTimes(1);

                    // When: Manually trigger the interval timer to attempt concurrent connection
                    if (capturedIntervalCallback) {
                        capturedIntervalCallback();
                    }

                    // When: Allow any async operations to complete
                    await Promise.resolve();

                    // Then: Verify streamFeed was still only called once
                    // (the guard flag prevented the concurrent attempt)
                    expect(mockNetwork.streamFeed).toHaveBeenCalledTimes(1);

                    // Stop the subscriber before awaiting rejection (stop() causes the rejection)
                    subscriber.stop();

                    // Verify start promise is rejected when stopped
                    await expect(startPromise).rejects.toThrow();
                } finally {
                    // subscriber.stop() already called above
                    jest.runAllTimers(); // Clear any remaining timers
                    global.setInterval = originalSetInterval;
                }
            } finally {
                jest.useRealTimers();
                global.performance = originalPerformance;
            }
        });

        it("should skip interval triggers while connection is in progress", async () => {
            // Workaround for Jest 28 performance object bug
            const originalPerformance = global.performance;
            try {
                delete (global as any).performance;
                jest.useFakeTimers();
            } catch (e) {
                global.performance = originalPerformance;
                throw e;
            }
            
            try {
                // Given: Track streamFeed calls
                let streamFeedCallCount = 0;
                
                // Given: A network where streamFeed returns disconnect but never calls callbacks
                // (simulating a long-running connection that doesn't complete)
                const mockDisconnect = jest.fn();
                mockNetwork.streamFeed = jest.fn((feed, bookmark, onResponse, onError) => {
                    streamFeedCallCount++;
                    // Never call onResponse or onError - simulate connection in progress
                    return mockDisconnect;
                });

                // Given: Storage with a bookmark
                mockStorage.loadBookmark = jest.fn().mockResolvedValue("test-bookmark");
                mockStorage.whichExist = jest.fn().mockResolvedValue([]);
                mockStorage.save = jest.fn().mockResolvedValue([]);
                mockStorage.saveBookmark = jest.fn().mockResolvedValue(undefined);
                mockNetwork.load = jest.fn().mockResolvedValue([]);

                // When: Create subscriber with very short refresh interval (0.05 seconds = 50ms)
                const subscriber = new Subscriber(
                    "test-feed",
                    mockNetwork,
                    mockStorage,
                    notifyFactsAdded,
                    0.05 // feedRefreshIntervalSeconds - 50ms to trigger multiple intervals quickly
                );

                try {
                    // When: Start the subscriber (don't await since it won't resolve)
                    const startPromise = subscriber.start().catch(() => {});

                    // When: Allow initial connection attempt
                    await Promise.resolve();

                    // When: Advance time to trigger multiple intervals (4 x 50ms = 200ms)
                    jest.advanceTimersByTime(200);
                    await Promise.resolve();

                    // Then: Verify streamFeed was only called once
                    // (proving all subsequent interval triggers were blocked by the isConnecting flag)
                    expect(streamFeedCallCount).toBe(1);
                } finally {
                    subscriber.stop();
                    jest.runAllTimers(); // Clear any remaining timers
                }
            } finally {
                jest.useRealTimers();
                global.performance = originalPerformance;
            }
        });
        it("should clear isConnecting flag after successful connection", async () => {
            // Workaround for Jest 28 performance object bug
            const originalPerformance = global.performance;
            try {
                delete (global as any).performance;
                jest.useFakeTimers();
            } catch (e) {
                global.performance = originalPerformance;
                throw e;
            }
            
            try {
                // Given: Track how many times streamFeed is called
                let streamFeedCallCount = 0;
                
                // Given: A network where streamFeed calls onResponse successfully after a short delay
                mockNetwork.streamFeed = jest.fn((feed, bookmark, onResponse, onError) => {
                    streamFeedCallCount++;
                    // Simulate successful connection after 10ms delay
                    setTimeout(() => onResponse([], bookmark), 10);
                    return () => {};
                });

                // Given: Storage with a bookmark
                mockStorage.loadBookmark = jest.fn().mockResolvedValue("test-bookmark");
                mockStorage.whichExist = jest.fn().mockResolvedValue([]);
                mockStorage.save = jest.fn().mockResolvedValue([]);
                mockStorage.saveBookmark = jest.fn().mockResolvedValue(undefined);
                mockNetwork.load = jest.fn().mockResolvedValue([]);

                // When: Create subscriber with short refresh interval (0.1 seconds = 100ms)
                const subscriber = new Subscriber(
                    "test-feed",
                    mockNetwork,
                    mockStorage,
                    notifyFactsAdded,
                    0.1 // feedRefreshIntervalSeconds - 100ms for fake timer testing
                );

                try {
                    // When: Start the subscriber and await successful connection
                    const startPromise = subscriber.start();

                    // Allow loadBookmark.then() setup to complete before advancing timers
                    await Promise.resolve();

                    // Advance time to complete the connection (10ms delay in streamFeed)
                    jest.advanceTimersByTime(10);
                    await startPromise;

                    // Then: Verify first streamFeed call completed successfully
                    expect(streamFeedCallCount).toBe(1);

                    // When: Advance time to allow the interval timer to fire again (100ms)
                    jest.advanceTimersByTime(100);
                    
                    // Advance time for the connection delay
                    jest.advanceTimersByTime(10);
                    await Promise.resolve();

                    // Then: Verify streamFeed was called at least twice
                    // (proving the isConnecting flag was cleared after successful connection)
                    expect(streamFeedCallCount).toBeGreaterThanOrEqual(2);
                } finally {
                    subscriber.stop();
                    jest.runAllTimers(); // Clear any remaining timers
                }
            } finally {
                jest.useRealTimers();
                global.performance = originalPerformance;
            }
        });
    });
});