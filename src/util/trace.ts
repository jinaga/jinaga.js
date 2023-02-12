export interface Tracer {
    warn(message: string): void;
    error(error: any): any;
}

class NoOpTracer implements Tracer {
    warn(message: string): void {
    }
    error(error: any) {
    }
}

class ConsoleTracer implements Tracer {
    warn(message: string): void {
        console.warn(message);
    }
    error(error: any) {
        console.error(error);
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
    
    static warn(message: string) {
        this.tracer.warn(message);
    }
    static error(error: any): void {
        this.tracer.error(error);
    }
}