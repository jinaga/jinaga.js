export interface Tracer {
    warn(message: string): void;
    error(error: any): void;
    dependency<T>(name: string, data: string, operation: () => Promise<T>): Promise<T>;
}

class NoOpTracer implements Tracer {
    warn(message: string): void {
    }
    error(error: any): void {
    }
    dependency<T>(name: string, data: string, operation: () => Promise<T>): Promise<T> {
        return operation();
    }
}

class ConsoleTracer implements Tracer {
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
}

export class Trace {
    private static tracer: Tracer = new ConsoleTracer();

    static configure(tracer: Tracer) {
        Trace.tracer = tracer;
    }

    static off() {
        Trace.tracer = new NoOpTracer();
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
}