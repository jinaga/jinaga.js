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
});