import { delay, QueueProcessor, SaveOutcome, SaveRequest, Saver, Trace, Tracer } from "@src";
import { waitForCondition } from "../utils/async-test-utils";

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
        /**
         * Flushes that have finished, as opposed to started. A test waits on
         * this rather than on a fixed delay.
         */
        public completedCount = 0;

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
            
            this.completedCount++;
            return { stalledOnConnection: this.stalledOnConnection };
        }

        reset(): void {
            this.saveCount = 0;
            this.lastSaveTime = 0;
            this.saveTimes = [];
            this.savePromise = null;
            this.requests.length = 0;
            this.completedCount = 0;
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
        await waitForCondition(() => saver.completedCount >= 1);

        expect(saver.requests[0]?.retryParked).toBe(false);

        await queueProcessor.processQueueNow();

        expect(saver.requests[saver.requests.length - 1]?.retryParked).toBe(true);
    }, 2000);

    it("does not ask the saver to retry what it parked when a stall re-flushes", async () => {
        // Issue #410, against issue #400's re-flush. A stall on the connection
        // says nothing about the facts the replicator refused, so the flush it
        // triggers leaves them parked.
        saver.stalledOnConnection = true;
        // A backoff far longer than this test, so the only thing that can make
        // a second flush is the re-flush below.
        queueProcessor = new QueueProcessor(saver, 0,
            { retry: { initialDelayMs: 60000, maxDelayMs: 60000 } });

        // Awaited rather than scheduled, because the processor reads the
        // outcome before this resolves: the stalled state the re-flush depends
        // on is set by the time the next line runs. A scheduled flush would
        // need a wait to reach the same point.
        await queueProcessor.processQueueNow();
        expect(saver.saveCount).toBe(1);

        // The replicator answered, which is the evidence issue #400 acts on.
        saver.stalledOnConnection = false;
        queueProcessor.flushIfStalled();
        await waitForCondition(() => saver.saveCount >= 2);

        // The re-flush is the second one, and it leaves the parked facts alone
        // even though the flush above asked for them.
        expect(saver.requests[1]?.retryParked).toBe(false);
    }, 2000);

    describe("a push while a flush is in flight", () => {
        /**
         * A saver whose flushes finish only when the test releases them, so
         * the test controls exactly when a flush is in flight. It reads a
         * stand-in queue as each flush starts, as WebClientSaver peeks the
         * real one.
         */
        class GatedSaver implements Saver {
            public readonly queue: string[] = [];
            public readonly flushes: { sent: string[], request?: SaveRequest }[] = [];
            public inFlight = 0;
            public maxInFlight = 0;
            private readonly releases: ((outcome: SaveOutcome | Error) => void)[] = [];

            save(request?: SaveRequest): Promise<SaveOutcome> {
                this.flushes.push({ sent: [...this.queue], request });
                this.inFlight++;
                this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
                return new Promise<SaveOutcome>((resolve, reject) => {
                    this.releases.push(outcome => {
                        this.inFlight--;
                        if (outcome instanceof Error) {
                            reject(outcome);
                        } else {
                            resolve(outcome);
                        }
                    });
                });
            }

            release(outcome: SaveOutcome | Error = { stalledOnConnection: false }) {
                const next = this.releases.shift();
                if (!next) {
                    throw new Error("No flush is in flight");
                }
                next(outcome);
            }
        }

        let gated: GatedSaver;

        beforeEach(() => {
            gated = new GatedSaver();
            queueProcessor = new QueueProcessor(gated, 0);
        });

        it("starts no second flush until the one in flight finishes", async () => {
            gated.queue.push("A");
            queueProcessor.scheduleProcessing();
            expect(gated.flushes).toHaveLength(1);

            const pushed = queueProcessor.processQueueNow();
            expect(gated.flushes).toHaveLength(1);

            gated.release();
            await waitForCondition(() => gated.flushes.length === 2);
            gated.release();
            await pushed;

            expect(gated.maxInFlight).toBe(1);
        }, 2000);

        it("resolves only after a flush that read the facts saved before the push", async () => {
            gated.queue.push("A");
            queueProcessor.scheduleProcessing();

            // Saved while the first flush is in flight, so that flush read the
            // queue before this fact was in it.
            gated.queue.push("B");
            let resolved = false;
            const pushed = queueProcessor.processQueueNow().then(() => { resolved = true; });

            gated.release();
            await waitForCondition(() => gated.flushes.length === 2);
            expect(resolved).toBe(false);

            gated.release();
            await pushed;

            expect(gated.flushes[0].sent).toEqual(["A"]);
            expect(gated.flushes[1].sent).toEqual(["A", "B"]);
            expect(gated.flushes[1].request?.retryParked).toBe(true);
        }, 2000);

        it("still flushes when the flush in flight fails", async () => {
            const originalTracer = Trace.getTracer();
            Trace.off();
            try {
                queueProcessor.scheduleProcessing();
                const pushed = queueProcessor.processQueueNow();

                gated.release(new Error("connection reset"));
                await waitForCondition(() => gated.flushes.length === 2);
                gated.release();
                await pushed;

                expect(gated.maxInFlight).toBe(1);
            }
            finally {
                Trace.configure(originalTracer);
            }
        }, 2000);
    });

    describe("a saver written to the 6.15.0 interface", () => {
        // Before issue #400, `Saver.save` resolved with nothing. `Saver` is
        // exported, so a saver written then must still compile and run. This
        // class is that saver: tsc refuses it if `save` must return a
        // SaveOutcome.
        class SaverReturningNothing implements Saver {
            public saveCount = 0;

            async save(): Promise<void> {
                this.saveCount++;
            }
        }

        it("flushes, and is not read as a flush that stalled", async () => {
            const legacy = new SaverReturningNothing();
            queueProcessor = new QueueProcessor(legacy, 0);

            await queueProcessor.processQueueNow();
            expect(legacy.saveCount).toBe(1);

            // Issue #400's re-flush acts only on a flush that stalled. Read as
            // stalled, this would start a flush and the push below would wait
            // for it and then run its own, making three.
            queueProcessor.flushIfStalled();
            await queueProcessor.processQueueNow();
            expect(legacy.saveCount).toBe(2);
        }, 2000);
    });

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