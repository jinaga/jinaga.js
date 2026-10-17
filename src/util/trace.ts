/**
 * Severity carried by a traced message. The levels are ordered
 * debug < info < warn < error, and `Trace` passes a message to the tracer
 * only when its level is at or above the configured threshold.
 */
export type TraceLevel = "debug" | "info" | "warn" | "error";

const levelRank: { [level in TraceLevel]: number } = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

export interface Tracer {
    /**
     * Per-item detail: one line per listener, per match, per loop iteration.
     * Optional so that a tracer written before levels existed still compiles;
     * a tracer that does not implement it simply never receives this detail.
     */
    debug?(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(error: any): void;
    dependency<T>(name: string, data: string, operation: () => Promise<T>): Promise<T>;
    metric(message: string, measurements: { [key: string]: number }): void;
    counter(name: string, value: number): void;
}

export class NoOpTracer implements Tracer {
    debug(message: string): void {
    }
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
    debug(message: string): void {
        console.debug(message);
    }
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

export class Trace {
    private static tracer: Tracer = new NoOpTracer();
    private static level: TraceLevel = "info";

    static configure(tracer: Tracer) {
        Trace.tracer = tracer;
    }

    static on() {
        Trace.tracer = new ConsoleTracer();
    }

    static off() {
        Trace.tracer = new NoOpTracer();
    }

    static getTracer(): Tracer {
        return Trace.tracer;
    }

    /**
     * Lowest level that reaches the tracer. Defaults to "info", which drops
     * the per-item detail that `debug` carries while keeping the aggregates
     * that summarize it.
     *
     * This is independent of which tracer is installed: `configure`, `on` and
     * `off` choose where output goes, and the threshold chooses how much of
     * it. Neither resets the other, and silencing output entirely is `off`
     * rather than a level.
     */
    static setLevel(level: TraceLevel): void {
        Trace.level = level;
    }

    static getLevel(): TraceLevel {
        return Trace.level;
    }

    private static enabled(level: TraceLevel): boolean {
        return levelRank[level] >= levelRank[Trace.level];
    }

    static debug(message: string): void {
        if (this.enabled("debug")) {
            this.tracer.debug?.(message);
        }
    }

    static info(message: string): void {
        if (this.enabled("info")) {
            this.tracer.info(message);
        }
    }
    
    static warn(message: string): void {
        if (this.enabled("warn")) {
            this.tracer.warn(message);
        }
    }

    // Error is the highest level, so no threshold can suppress it. Gating it
    // would be a check that never rejects.
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