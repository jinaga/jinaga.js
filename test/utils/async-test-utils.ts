/**
 * Observer interface with the processed() method.
 * This is a minimal interface for testing purposes.
 */
interface ObserverWithProcessed {
    processed(): Promise<void>;
}

/**
 * Wait for an observer to complete all pending notifications.
 * This is useful in tests to ensure all async operations have completed.
 * 
 * @param observer The observer to wait for
 */
export async function waitForObserver<T>(observer: ObserverWithProcessed): Promise<void> {
    await observer.processed();
}

/**
 * Wait for a condition to become true, with timeout.
 * Polls the predicate at regular intervals until it returns true or timeout is reached.
 * 
 * @param predicate Function that returns true when the condition is met
 * @param timeoutMs Maximum time to wait in milliseconds (default: 2000)
 * @param intervalMs Polling interval in milliseconds (default: 20)
 */
export async function waitForCondition(
    predicate: () => boolean,
    timeoutMs = 2000,
    intervalMs = 20
): Promise<void> {
    const start = Date.now();
    return new Promise<void>((resolve, reject) => {
        const check = () => {
            if (predicate()) return resolve();
            if (Date.now() - start > timeoutMs) {
                return reject(new Error(`Timeout waiting for condition after ${timeoutMs}ms`));
            }
            setTimeout(check, intervalMs);
        };
        check();
    });
}

/**
 * Wait for a specific number of callbacks to be invoked.
 * Useful for testing observer notifications.
 * 
 * @param getCount Function that returns the current count
 * @param expectedCount The expected count to wait for
 * @param timeoutMs Maximum time to wait in milliseconds (default: 2000)
 */
export async function waitForCallbackCount(
    getCount: () => number,
    expectedCount: number,
    timeoutMs = 2000
): Promise<void> {
    return waitForCondition(() => getCount() >= expectedCount, timeoutMs);
}

