import { delay, QueueProcessor, Saver } from "@src";

describe("QueueProcessor", () => {
    // Mock implementation of the Saver interface
    class MockSaver implements Saver {
        public saveCount = 0;
        public lastSaveTime = 0;
        public saveTimes: number[] = [];
        public savePromise: Promise<void> | null = null;
        public delayMs = 0;

        async save(): Promise<void> {
            this.saveCount++;
            this.lastSaveTime = Date.now();
            this.saveTimes.push(this.lastSaveTime);
            
            if (this.delayMs > 0) {
                await delay(this.delayMs);
            }
            
            if (this.savePromise) {
                return this.savePromise;
            }
            
            return Promise.resolve();
        }

        reset(): void {
            this.saveCount = 0;
            this.lastSaveTime = 0;
            this.saveTimes = [];
            this.savePromise = null;
        }
    }

    let saver: MockSaver;
    let queueProcessor: QueueProcessor;

    beforeEach(() => {
        saver = new MockSaver();
    });

    afterEach(async () => {
        if (queueProcessor) {
            await queueProcessor.dispose();
        }
    });

    it("should process the queue immediately when delay is 0", async () => {
        // Arrange
        queueProcessor = new QueueProcessor(saver, 0);
        
        // Act
        queueProcessor.scheduleProcessing();
        
        // Assert
        expect(saver.saveCount).toBe(1);
    }, 1000);

    it("should debounce multiple calls when delay is greater than 0", async () => {
        // Arrange
        const delayMs = 100;
        queueProcessor = new QueueProcessor(saver, delayMs);
        
        // Act
        queueProcessor.scheduleProcessing();
        queueProcessor.scheduleProcessing();
        queueProcessor.scheduleProcessing();
        
        // Wait for less than the delay
        await delay(50);
        
        // Assert - should not have processed yet
        expect(saver.saveCount).toBe(0);
        
        // Wait for the delay to complete
        await delay(delayMs + 50);
        
        // Assert - should have processed once
        expect(saver.saveCount).toBe(1);
    }, 1000);

    it("should process immediately when processQueueNow is called", async () => {
        // Arrange
        const delayMs = 1000; // Long delay
        queueProcessor = new QueueProcessor(saver, delayMs);
        
        // Act
        queueProcessor.scheduleProcessing();
        
        // Wait a bit, but less than the delay
        await delay(50);
        
        // Assert - should not have processed yet
        expect(saver.saveCount).toBe(0);
        
        // Act - process immediately
        await queueProcessor.processQueueNow();
        
        // Assert - should have processed once
        expect(saver.saveCount).toBe(1);
    }, 10000);

    it("should batch multiple operations into a single save", async () => {
        // Arrange
        const delayMs = 100;
        queueProcessor = new QueueProcessor(saver, delayMs);
        
        // Act - schedule multiple times in quick succession
        queueProcessor.scheduleProcessing();
        await delay(10);
        queueProcessor.scheduleProcessing();
        await delay(10);
        queueProcessor.scheduleProcessing();
        
        // Wait for the delay to complete
        await delay(delayMs + 50);
        
        // Assert - should have processed only once
        expect(saver.saveCount).toBe(1);
    }, 1000);

    it("should process multiple times when calls are spaced out", async () => {
        // Arrange
        const delayMs = 100;
        queueProcessor = new QueueProcessor(saver, delayMs);
        
        // Act - schedule with delays longer than the debounce period
        queueProcessor.scheduleProcessing();
        
        // Wait for the first processing to complete
        await delay(delayMs + 50);
        
        // Schedule again
        queueProcessor.scheduleProcessing();
        
        // Wait for the second processing to complete
        await delay(delayMs + 50);
        
        // Assert - should have processed twice
        expect(saver.saveCount).toBe(2);
    }, 1000);

    it("should handle errors during save", async () => {
        // Arrange
        queueProcessor = new QueueProcessor(saver, 0);
        saver.savePromise = Promise.reject(new Error("Test error"));
        
        // Spy on Trace.error
        const originalTraceError = global.console.error;
        const mockTraceError = jest.fn();
        global.console.error = mockTraceError;
        
        try {
            // Act
            queueProcessor.scheduleProcessing();
            
            // Wait a bit to ensure processing completes
            await delay(50);
            
            // Assert
            expect(mockTraceError).toHaveBeenCalled();
        } finally {
            // Restore original Trace.error
            global.console.error = originalTraceError;
        }
    }, 1000);

    it("should stop processing when disposed", async () => {
        // Arrange
        queueProcessor = new QueueProcessor(saver, 100);
        
        // Act
        await queueProcessor.dispose();

        // Try to run a process immediately
        await queueProcessor.processQueueNow();

        // Assert - should not have processed
        expect(saver.saveCount).toBe(0);
    }, 1000);
});