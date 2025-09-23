"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
describe("QueueProcessor", () => {
    // Mock implementation of the Saver interface
    class MockSaver {
        constructor() {
            this.saveCount = 0;
            this.lastSaveTime = 0;
            this.saveTimes = [];
            this.savePromise = null;
            this.delayMs = 0;
        }
        save() {
            return __awaiter(this, void 0, void 0, function* () {
                this.saveCount++;
                this.lastSaveTime = Date.now();
                this.saveTimes.push(this.lastSaveTime);
                if (this.delayMs > 0) {
                    yield (0, _src_1.delay)(this.delayMs);
                }
                if (this.savePromise) {
                    return this.savePromise;
                }
                return Promise.resolve();
            });
        }
        reset() {
            this.saveCount = 0;
            this.lastSaveTime = 0;
            this.saveTimes = [];
            this.savePromise = null;
        }
    }
    let saver;
    let queueProcessor;
    beforeEach(() => {
        saver = new MockSaver();
    });
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        if (queueProcessor) {
            yield queueProcessor.dispose();
        }
    }));
    it("should process the queue immediately when delay is 0", () => __awaiter(void 0, void 0, void 0, function* () {
        // Arrange
        queueProcessor = new _src_1.QueueProcessor(saver, 0);
        // Act
        queueProcessor.scheduleProcessing();
        // Assert
        expect(saver.saveCount).toBe(1);
    }), 1000);
    it("should debounce multiple calls when delay is greater than 0", () => __awaiter(void 0, void 0, void 0, function* () {
        // Arrange
        const delayMs = 100;
        queueProcessor = new _src_1.QueueProcessor(saver, delayMs);
        // Act
        queueProcessor.scheduleProcessing();
        queueProcessor.scheduleProcessing();
        queueProcessor.scheduleProcessing();
        // Wait for less than the delay
        yield (0, _src_1.delay)(50);
        // Assert - should not have processed yet
        expect(saver.saveCount).toBe(0);
        // Wait for the delay to complete
        yield (0, _src_1.delay)(delayMs + 50);
        // Assert - should have processed once
        expect(saver.saveCount).toBe(1);
    }), 1000);
    it("should process immediately when processQueueNow is called", () => __awaiter(void 0, void 0, void 0, function* () {
        // Arrange
        const delayMs = 1000; // Long delay
        queueProcessor = new _src_1.QueueProcessor(saver, delayMs);
        // Act
        queueProcessor.scheduleProcessing();
        // Wait a bit, but less than the delay
        yield (0, _src_1.delay)(50);
        // Assert - should not have processed yet
        expect(saver.saveCount).toBe(0);
        // Act - process immediately
        yield queueProcessor.processQueueNow();
        // Assert - should have processed once
        expect(saver.saveCount).toBe(1);
    }), 10000);
    it("should batch multiple operations into a single save", () => __awaiter(void 0, void 0, void 0, function* () {
        // Arrange
        const delayMs = 100;
        queueProcessor = new _src_1.QueueProcessor(saver, delayMs);
        // Act - schedule multiple times in quick succession
        queueProcessor.scheduleProcessing();
        yield (0, _src_1.delay)(10);
        queueProcessor.scheduleProcessing();
        yield (0, _src_1.delay)(10);
        queueProcessor.scheduleProcessing();
        // Wait for the delay to complete
        yield (0, _src_1.delay)(delayMs + 50);
        // Assert - should have processed only once
        expect(saver.saveCount).toBe(1);
    }), 1000);
    it("should process multiple times when calls are spaced out", () => __awaiter(void 0, void 0, void 0, function* () {
        // Arrange
        const delayMs = 100;
        queueProcessor = new _src_1.QueueProcessor(saver, delayMs);
        // Act - schedule with delays longer than the debounce period
        queueProcessor.scheduleProcessing();
        // Wait for the first processing to complete
        yield (0, _src_1.delay)(delayMs + 50);
        // Schedule again
        queueProcessor.scheduleProcessing();
        // Wait for the second processing to complete
        yield (0, _src_1.delay)(delayMs + 50);
        // Assert - should have processed twice
        expect(saver.saveCount).toBe(2);
    }), 1000);
    it("should handle errors during save", () => __awaiter(void 0, void 0, void 0, function* () {
        // Arrange
        queueProcessor = new _src_1.QueueProcessor(saver, 0);
        saver.savePromise = Promise.reject(new Error("Test error"));
        // Spy on Trace.error
        const originalTraceError = global.console.error;
        const mockTraceError = jest.fn();
        global.console.error = mockTraceError;
        try {
            // Act
            queueProcessor.scheduleProcessing();
            // Wait a bit to ensure processing completes
            yield (0, _src_1.delay)(50);
            // Assert
            expect(mockTraceError).toHaveBeenCalled();
        }
        finally {
            // Restore original Trace.error
            global.console.error = originalTraceError;
        }
    }), 1000);
    it("should stop processing when disposed", () => __awaiter(void 0, void 0, void 0, function* () {
        // Arrange
        queueProcessor = new _src_1.QueueProcessor(saver, 100);
        // Act
        yield queueProcessor.dispose();
        // Try to run a process immediately
        yield queueProcessor.processQueueNow();
        // Assert - should not have processed
        expect(saver.saveCount).toBe(0);
    }), 1000);
});
//# sourceMappingURL=QueueProcessorSpec.js.map