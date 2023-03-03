export interface Tracer {
    info(message: string): void;
    warn(message: string): void;
    error(error: any): void;
    dependency<T>(name: string, data: string, operation: () => Promise<T>): Promise<T>;
    metric(message: string, measurements: { [key: string]: number }): void;
}

class NoOpTracer implements Tracer {
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
}

class ConsoleTracer implements Tracer {
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
}

export class Trace {
    private static tracer: Tracer = new ConsoleTracer();

    static configure(tracer: Tracer) {
        Trace.tracer = tracer;
    }

    static off() {
        Trace.tracer = new NoOpTracer();
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
}