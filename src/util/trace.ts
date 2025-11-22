export interface Tracer {
    info(message: string): void;
    warn(message: string): void;
    error(error: any): void;
    dependency<T>(name: string, data: string, operation: () => Promise<T>): Promise<T>;
    metric(message: string, measurements: { [key: string]: number }): void;
    counter(name: string, value: number): void;
}

export class NoOpTracer implements Tracer {
    info(message: string): void {
    }
    warn(message: string): void {
    }
    error(error: any): void {
    }
    dependency<T>(name: string, data: string, operation: () => Promise<T>): Promise<T> {
        return operation();
    }
    metric(message: string, measurements: { [key: string]: number }): void {
    }

    counter(name: string, value: number): void {
    }
}

export class ConsoleTracer implements Tracer {
    info(message: string): void {
        console.log(message);
    }
    warn(message: string): void {
        console.warn(message);
    }
    error(error: any): void {
        console.error(error);
    }
    async dependency<T>(name: string, data: string, operation: () => Promise<T>): Promise<T> {
        const start = new Date().getTime();
        try {
            return await operation();
        }
        finally {
            const end = new Date().getTime();
            const duration = end - start;
    
            // Log the dependency
            console.log(`Dependency: ${name} (${data}) took ${duration}ms`);
        }
    }

    metric(message: string, measurements: { [key: string]: number }): void {
        console.log(`Metric: ${message}`, measurements);
    }
    
    counter(name: string, value: number): void {
        console.log(`Counter: ${name} = ${value}`);
    }
}

export class TestTracer implements Tracer {
    private readonly consoleTracer: ConsoleTracer = new ConsoleTracer();
    private static testFinished: boolean = false;

    private static isTestLoggingError(error: any): boolean {
        // Jest's BufferedConsole throws errors that may not be Error instances
        // Check multiple ways to detect "Cannot log after tests are done" errors
        if (!error) return false;
        const errorString = error instanceof Error 
            ? error.message 
            : String(error);
        return errorString.includes('Cannot log after tests are done');
    }

    private safeLog(operation: () => void): void {
        if (TestTracer.testFinished) {
            return;
        }
        try {
            operation();
        } catch (error: any) {
            if (TestTracer.isTestLoggingError(error)) {
                // Set flag to suppress all future logging attempts
                TestTracer.testFinished = true;
                return;
            }
            throw error;
        }
    }

    info(message: string): void {
        this.safeLog(() => this.consoleTracer.info(message));
    }

    warn(message: string): void {
        this.safeLog(() => this.consoleTracer.warn(message));
    }

    error(error: any): void {
        this.safeLog(() => this.consoleTracer.error(error));
    }

    async dependency<T>(name: string, data: string, operation: () => Promise<T>): Promise<T> {
        if (TestTracer.testFinished) {
            // Skip logging but still execute the operation
            return await operation();
        }
        try {
            return await this.consoleTracer.dependency(name, data, operation);
        } catch (error) {
            if (TestTracer.isTestLoggingError(error)) {
                TestTracer.testFinished = true;
                // Still execute the operation, just skip logging
                return await operation();
            }
            throw error;
        }
    }

    metric(message: string, measurements: { [key: string]: number }): void {
        this.safeLog(() => this.consoleTracer.metric(message, measurements));
    }

    counter(name: string, value: number): void {
        this.safeLog(() => this.consoleTracer.counter(name, value));
    }

    /**
     * Mark tests as finished to suppress logging during async cleanup.
     * Called automatically by test setup, but can be called manually if needed.
     */
    static markTestsFinished(): void {
        TestTracer.testFinished = true;
    }

    /**
     * Reset the test finished flag (useful for test isolation).
     */
    static reset(): void {
        TestTracer.testFinished = false;
    }
}

export class Trace {
    private static tracer: Tracer = new ConsoleTracer();

    static configure(tracer: Tracer) {
        Trace.tracer = tracer;
    }

    static off() {
        Trace.tracer = new NoOpTracer();
    }

    static getTracer(): Tracer {
        return Trace.tracer;
    }

    static info(message: string): void {
        this.tracer.info(message);
    }
    
    static warn(message: string): void {
        this.tracer.warn(message);
    }

    static error(error: any): void {
        this.tracer.error(error);
    }

    static dependency<T>(name: string, data: string, operation: () => Promise<T>): Promise<T> {
        return this.tracer.dependency(name, data, operation);
    }

    static metric(message: string, measurements: { [key: string]: number }): void {
        this.tracer.metric(message, measurements);
    }

    static counter(name: string, value: number): void {
        this.tracer.counter(name, value);
    }
}