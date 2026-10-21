import { NoOpTracer, Trace, Tracer } from "@src";

/** Counts the console calls each kind of trace produces. */
interface ConsoleWrites {
    log: number;
    debug: number;
}

/** Records every counter, dependency and metric call an exporter would see. */
class RecordingTracer extends NoOpTracer implements Tracer {
    public readonly counters: string[] = [];
    public readonly dependencies: string[] = [];
    public readonly metrics: string[] = [];
    counter(name: string, value: number): void {
        this.counters.push(name);
    }
    async dependency<T>(name: string, data: string, operation: () => Promise<T>): Promise<T> {
        this.dependencies.push(name);
        return await operation();
    }
    metric(message: string, measurements: { [key: string]: number }): void {
        this.metrics.push(message);
    }
}

describe("ConsoleTracer verbosity below the trace threshold (issue #330)", () => {
    let log: jest.SpyInstance;
    let debug: jest.SpyInstance;

    beforeEach(() => {
        log = jest.spyOn(console, "log").mockImplementation(() => { });
        debug = jest.spyOn(console, "debug").mockImplementation(() => { });
    });

    afterEach(() => {
        // Trace is global static state, so both axes are restored.
        Trace.setLevel("info");
        Trace.off();
        log.mockRestore();
        debug.mockRestore();
    });

    function writes(): ConsoleWrites {
        return { log: log.mock.calls.length, debug: debug.mock.calls.length };
    }

    it("writes nothing to the console at warn", async () => {
        Trace.on();
        Trace.setLevel("warn");

        Trace.counter("facts_saved", 1);
        await Trace.dependency("save", "one fact", async () => "result");
        Trace.metric("observable_listener_timeout", { elapsed: 1 });

        expect(writes()).toEqual({ log: 0, debug: 0 });
    });

    it("still runs the dependency operation and resolves with its result at warn", async () => {
        Trace.on();
        Trace.setLevel("warn");
        let ran = false;

        const result = await Trace.dependency("save", "one fact", async () => {
            ran = true;
            return "result";
        });

        expect(ran).toBe(true);
        expect(result).toBe("result");
        expect(writes()).toEqual({ log: 0, debug: 0 });
    });

    it("still rejects with the dependency operation's error at warn", async () => {
        Trace.on();
        Trace.setLevel("warn");

        await expect(Trace.dependency("save", "one fact", async () => {
            throw new Error("the operation failed");
        })).rejects.toThrow("the operation failed");
        expect(writes()).toEqual({ log: 0, debug: 0 });
    });

    it("prints dependency and metric but not counter at info", async () => {
        Trace.on();
        Trace.setLevel("info");

        Trace.counter("facts_saved", 1);
        expect(writes()).toEqual({ log: 0, debug: 0 });

        await Trace.dependency("save", "one fact", async () => "result");
        Trace.metric("observable_listener_timeout", { elapsed: 1 });

        expect(writes()).toEqual({ log: 2, debug: 0 });
    });

    it("prints all three at debug", async () => {
        Trace.on();
        Trace.setLevel("debug");

        Trace.counter("facts_saved", 1);
        await Trace.dependency("save", "one fact", async () => "result");
        Trace.metric("observable_listener_timeout", { elapsed: 1 });

        expect(writes()).toEqual({ log: 2, debug: 1 });
    });

    it("delivers all three to a configured tracer at warn, so an exporter is never starved", async () => {
        const tracer = new RecordingTracer();
        Trace.configure(tracer);
        Trace.setLevel("warn");

        Trace.counter("facts_saved", 1);
        await Trace.dependency("save", "one fact", async () => "result");
        Trace.metric("observable_listener_timeout", { elapsed: 1 });

        expect(tracer.counters).toEqual(["facts_saved"]);
        expect(tracer.dependencies).toEqual(["save"]);
        expect(tracer.metrics).toEqual(["observable_listener_timeout"]);
    });
});
