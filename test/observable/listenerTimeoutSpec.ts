import { Jinaga, JinagaTest, NoOpTracer, Trace, Tracer, User } from "@src";
import { Company, Manager, Office, model } from "../companyModel";
import { waitForCondition } from "../utils/async-test-utils";

/**
 * Records Trace.counter names so a stall is asserted as observable, not merely
 * as a duration (issue #246).
 */
class CountingTracer extends NoOpTracer implements Tracer {
    public readonly counters: { [name: string]: number } = {};
    public readonly errors: string[] = [];
    counter(name: string, value: number): void {
        this.counters[name] = (this.counters[name] ?? 0) + value;
    }
    error(error: any): void {
        this.errors.push(String(error));
    }
}

const creator = new User("--- PUBLIC KEY GOES HERE ---");
const company = new Company(creator, "TestCo");
const office = new Office(company, "TestOffice");

const managersInOffice = model.given(Office).match((office, facts) =>
    facts.ofType(Manager)
        .join(manager => manager.office, office)
);

function createClient(listenerTimeoutMs: number, listenerDispatch?: "parallel" | "serial"): Jinaga {
    return JinagaTest.create({
        model,
        initialState: [creator, company, office],
        listenerTimeoutMs,
        listenerDispatch
    });
}

/** Race a promise against a deadline. Always clears the timer. */
function raceDeadline<T>(promise: Promise<T>, ms: number): Promise<"settled" | "timed-out"> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
        promise.then(() => "settled" as const, () => "settled" as const),
        new Promise<"timed-out">(resolve => { timer = setTimeout(() => resolve("timed-out"), ms); })
    ]).finally(() => clearTimeout(timer!));
}

describe("a listener that never settles (issue #246)", () => {
    let tracer: CountingTracer;

    beforeEach(() => {
        // Trace is global static state, so it must be restored in afterEach.
        tracer = new CountingTracer();
        Trace.configure(tracer);
    });

    afterEach(() => {
        Trace.off();
    });

    it("does not wedge j.fact()", async () => {
        const j = createClient(200);

        let calls = 0;
        const observer = j.watch(managersInOffice, office, () => {
            calls++;
            return new Promise<void>(() => { });
        });
        // No managers exist yet, so the handler has not run and loaded() settles.
        await observer.loaded();
        expect(calls).toBe(0);

        const start = Date.now();
        // Before the fix this never settles: notifyFactSaved awaits onResult
        // with no bound, so save() and every query behind it hang forever.
        await j.fact(new Manager(office, 1));
        const elapsed = Date.now() - start;

        expect(calls).toBe(1);
        expect(elapsed).toBeGreaterThanOrEqual(150);
        expect(elapsed).toBeLessThan(3000);
        expect(tracer.counters["observable_listener_started"]).toBeGreaterThan(0);
        expect(tracer.counters["observable_listener_timed_out"]).toBeGreaterThan(0);

        // Deliberately no `await observer.processed()`: the abandoned
        // notification stays pending by design, so processed() never settles.
        observer.stop();
    }, 15000);

    it("does not block a query issued after the wedged save", async () => {
        const j = createClient(200);

        const observer = j.watch(managersInOffice, office, () => new Promise<void>(() => { }));
        await observer.loaded();

        await j.fact(new Manager(office, 2));
        const managers = await j.query(managersInOffice, office);

        expect(managers.map(m => m.employeeNumber)).toEqual([2]);
        observer.stop();
    }, 15000);

    it("delivers to a healthy listener while a sibling on the same specification is wedged", async () => {
        // Two observers on the SAME specification land in one spec group with
        // two listeners. The healthy one must receive the row without waiting
        // out the wedged one's timeout.
        const j = createClient(1000);

        const wedged = j.watch(managersInOffice, office, () => new Promise<void>(() => { }));
        const received: number[] = [];
        const healthy = j.watch(managersInOffice, office, manager => {
            received.push(manager.employeeNumber);
        });
        await wedged.loaded();
        await healthy.loaded();

        const start = Date.now();
        const saved = j.fact(new Manager(office, 3));
        await waitForCondition(() => received.length > 0, 500);
        const elapsed = Date.now() - start;

        expect(received).toEqual([3]);
        // Well under the 1000ms timeout the wedged sibling is burning: a
        // serial dispatch would have made the healthy listener wait it out.
        expect(elapsed).toBeLessThan(400);

        // Let the wedged listener time out so the save settles and its timer
        // is cleared before the test ends.
        await saved;

        wedged.stop();
        healthy.stop();
    }, 15000);

    it("still catches a listener that throws, without rejecting the save", async () => {
        const j = createClient(200);

        const observer = j.watch(managersInOffice, office, () => {
            throw new Error("listener blew up");
        });
        await observer.loaded();

        await expect(j.fact(new Manager(office, 4))).resolves.toBeDefined();
        expect(tracer.counters["observable_listener_failed"]).toBeGreaterThan(0);
        expect(tracer.counters["observable_listener_timed_out"] ?? 0).toBe(0);

        observer.stop();
    }, 15000);

    it("reports an abandoned listener that rejects later, without an unhandled rejection", async () => {
        const j = createClient(100);
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);

        try {
            const observer = j.watch(managersInOffice, office, () =>
                new Promise<void>((_, reject) => setTimeout(() => reject(new Error("late")), 300)));
            await observer.loaded();

            await j.fact(new Manager(office, 5));
            expect(tracer.counters["observable_listener_timed_out"]).toBeGreaterThan(0);

            // Give the abandoned promise time to reject.
            await waitForCondition(() => (tracer.counters["observable_listener_late_settled"] ?? 0) > 0, 2000);
            // Let any unhandled rejection surface.
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(unhandled).toEqual([]);

            observer.stop();
        }
        finally {
            process.off("unhandledRejection", onUnhandled);
        }
    }, 15000);

    it("serializes dispatch when the caller opts out of parallel", async () => {
        // The serial opt-out is reachable from the public harness, and restores
        // the behavior where a wedged listener holds up its peers until it
        // times out.
        const j = createClient(300, "serial");

        const wedged = j.watch(managersInOffice, office, () => new Promise<void>(() => { }));
        const received: number[] = [];
        const healthy = j.watch(managersInOffice, office, manager => {
            received.push(manager.employeeNumber);
        });
        await wedged.loaded();
        await healthy.loaded();

        const start = Date.now();
        await j.fact(new Manager(office, 8));
        const elapsed = Date.now() - start;

        expect(received).toEqual([8]);
        // The healthy listener ran only after the wedged one timed out.
        expect(elapsed).toBeGreaterThanOrEqual(250);

        wedged.stop();
        healthy.stop();
    }, 15000);

    it("waits indefinitely when the timeout is disabled", async () => {
        const j = createClient(0);

        const observer = j.watch(managersInOffice, office, () => new Promise<void>(() => { }));
        await observer.loaded();

        // The opt-out restores the pre-#246 behavior, so the save must not settle.
        await expect(raceDeadline(j.fact(new Manager(office, 6)), 300)).resolves.toBe("timed-out");

        observer.stop();
    }, 15000);
});
