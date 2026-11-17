import { delay, QueueProcessor, SaveOutcome, SaveRequest, Saver, Trace, Tracer } from "@src";

describe("QueueProcessor", () => {
    // Mock implementation of the Saver interface
    class MockSaver implements Saver {
        public saveCount = 0;
        public lastSaveTime = 0;
        public saveTimes: number[] = [];
        public savePromise: Promise<void> | null = null;
        public delayMs = 0;
        /** What each flush was asked for (issue #410). */
        public readonly requests: (SaveRequest | undefined)[] = [];
        /** What this saver reports to the processor about the connection. */
        public stalledOnConnection = false;

        async save(request?: SaveRequest): Promise<SaveOutcome> {
            this.saveCount++;
            this.requests.push(request);
            this.lastSaveTime = Date.now();
            this.saveTimes.push(this.lastSaveTime);
            
            if (this.delayMs > 0) {
                await delay(this.delayMs);
            }
            
            if (this.savePromise) {
                await this.savePromise;
            }
            
            return { stalledOnConnection: this.stalledOnConnection };
        }

        reset(): void {
            this.saveCount = 0;
            this.lastSaveTime = 0;
            this.saveTimes = [];
            this.savePromise = null;
            this.requests.length = 0;
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

        const mockTracer: Tracer = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            dependency: (_name, _data, operation) => operation(),
            metric: jest.fn(),
            counter: jest.fn()
        };
        const originalTracer = Trace.getTracer();
        Trace.configure(mockTracer);

        try {
            // Act
            queueProcessor.scheduleProcessing();

            // Wait a bit to ensure processing completes
            await delay(50);

            // Assert
            expect(mockTracer.error).toHaveBeenCalled();
        } finally {
            Trace.configure(originalTracer);
        }
    }, 1000);

    it("asks the saver to retry what it parked only when the application pushes", async () => {
        // Issue #410. A fact the replicator refused on its own is not worth a
        // request until something could change the answer. A scheduled flush
        // carries new facts and is not that; an application calling `push()` is
        // saying it knows of a change the client cannot see.
        queueProcessor = new QueueProcessor(saver, 0);

        queueProcessor.scheduleProcessing();
        await queueProcessor.processQueueNow();

        expect(saver.requests.map(request => request?.retryParked === true))
            .toEqual([false, true]);
    }, 1000);

    it("does not ask the saver to retry what it parked when a stall re-flushes", async () => {
        // Issue #410, against issue #400's re-flush. A stall on the connection
        // says nothing about the facts the replicator refused, so the flush it
        // triggers leaves them parked.
        saver.stalledOnConnection = true;
        // A backoff far longer than this test, so the only thing that can make
        // a second flush is the re-flush below.
        queueProcessor = new QueueProcessor(saver, 0,
            { retry: { initialDelayMs: 60000, maxDelayMs: 60000 } });

        queueProcessor.scheduleProcessing();
        // The processor reads the outcome after the flush resolves, so the
        // stalled state it acts on is not set until then.
        await delay(20);
        expect(saver.saveCount).toBe(1);

        // The replicator answered, which is the evidence issue #400 acts on.
        saver.stalledOnConnection = false;
        queueProcessor.flushIfStalled();
        await delay(50);

        expect(saver.saveCount).toBe(2);
        expect(saver.requests.some(request => request?.retryParked === true)).toBe(false);
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