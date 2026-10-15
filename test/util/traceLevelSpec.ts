import { NoOpTracer, Trace, TraceLevel, Tracer } from "@src";

/** Records which level each message was traced at. */
class RecordingTracer extends NoOpTracer implements Tracer {
    public readonly debugs: string[] = [];
    public readonly infos: string[] = [];
    public readonly warns: string[] = [];
    public readonly errors: string[] = [];
    debug(message: string): void {
        this.debugs.push(message);
    }
    info(message: string): void {
        this.infos.push(message);
    }
    warn(message: string): void {
        this.warns.push(message);
    }
    error(error: any): void {
        this.errors.push(String(error));
    }
}

/** A tracer written before levels existed: no `debug` member at all. */
class LevellessTracer implements Tracer {
    public readonly infos: string[] = [];
    info(message: string): void {
        this.infos.push(message);
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

/** Trace every level once, and report what the tracer received. */
function traceAllLevels(tracer: RecordingTracer) {
    Trace.debug("per-item detail");
    Trace.info("aggregate");
    Trace.warn("degraded");
    Trace.error("broken");
    return {
        debugs: tracer.debugs.length,
        infos: tracer.infos.length,
        warns: tracer.warns.length,
        errors: tracer.errors.length
    };
}

describe("the trace level threshold (issue #264)", () => {
    let tracer: RecordingTracer;

    beforeEach(() => {
        // Trace is global static state, so both axes are restored in afterEach.
        tracer = new RecordingTracer();
        Trace.configure(tracer);
    });

    afterEach(() => {
        Trace.setLevel("info");
        Trace.off();
    });

    it("drops debug by default, so existing consumers see what they saw before", () => {
        expect(Trace.getLevel()).toBe("info");
        expect(traceAllLevels(tracer)).toEqual({ debugs: 0, infos: 1, warns: 1, errors: 1 });
    });

    it("delivers every level once the threshold is lowered to debug", () => {
        Trace.setLevel("debug");

        expect(traceAllLevels(tracer)).toEqual({ debugs: 1, infos: 1, warns: 1, errors: 1 });
    });

    it("suppresses everything below the threshold", () => {
        const expectations: { level: TraceLevel, delivered: ReturnType<typeof traceAllLevels> }[] = [
            { level: "debug", delivered: { debugs: 1, infos: 1, warns: 1, errors: 1 } },
            { level: "info", delivered: { debugs: 0, infos: 1, warns: 1, errors: 1 } },
            { level: "warn", delivered: { debugs: 0, infos: 0, warns: 1, errors: 1 } },
            { level: "error", delivered: { debugs: 0, infos: 0, warns: 0, errors: 1 } }
        ];

        for (const { level, delivered } of expectations) {
            const levelTracer = new RecordingTracer();
            Trace.configure(levelTracer);
            Trace.setLevel(level);

            expect(traceAllLevels(levelTracer)).toEqual(delivered);
        }
    });

    it("does not call a tracer that implements no debug member", () => {
        const levelless = new LevellessTracer();
        Trace.configure(levelless);
        Trace.setLevel("debug");

        expect(() => Trace.debug("per-item detail")).not.toThrow();
        Trace.info("aggregate");

        expect(levelless.infos).toEqual(["aggregate"]);
    });

    it("keeps the threshold and the installed tracer independent", () => {
        Trace.setLevel("debug");

        // Choosing where output goes does not change how much of it there is.
        const replacement = new RecordingTracer();
        Trace.configure(replacement);
        Trace.debug("per-item detail");

        expect(replacement.debugs).toEqual(["per-item detail"]);
    });
});
