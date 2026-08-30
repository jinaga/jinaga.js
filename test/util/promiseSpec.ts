import { NoOpTracer, Trace, Tracer } from "@src";
import { LateSettle, TIMED_OUT, withTimeout } from "../../src/util/promise";

describe("withTimeout", () => {
    it("resolves with the value when the promise settles first", async () => {
        await expect(withTimeout(Promise.resolve("value"), 1000)).resolves.toBe("value");
    });

    it("propagates a rejection that arrives before the deadline", async () => {
        await expect(withTimeout(Promise.reject(new Error("boom")), 1000)).rejects.toThrow("boom");
    });

    it("resolves with TIMED_OUT when the deadline passes first", async () => {
        await expect(withTimeout(new Promise<void>(() => { }), 50)).resolves.toBe(TIMED_OUT);
    });

    it("returns the promise untouched when the bound is disabled", async () => {
        const promise = Promise.resolve("value");
        expect(withTimeout(promise, 0)).toBe(promise);
        expect(withTimeout(promise, -1)).toBe(promise);
        expect(withTimeout(promise, Number.POSITIVE_INFINITY)).toBe(promise);
    });

    it("reports a late completion", async () => {
        const late: LateSettle[] = [];
        const slow = new Promise<string>(resolve => setTimeout(() => resolve("late"), 100));

        await expect(withTimeout(slow, 20, l => late.push(l))).resolves.toBe(TIMED_OUT);
        await slow;
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(late.length).toBe(1);
        expect("error" in late[0]).toBe(false);
        expect(late[0].elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it("reports a late rejection, including one whose reason is undefined", async () => {
        // Classification keys on the property being present rather than on its
        // value, so `reject(undefined)` is not mistaken for a completion.
        const late: LateSettle[] = [];
        const slow = new Promise<void>((_, reject) => setTimeout(() => reject(undefined), 100));

        await expect(withTimeout(slow, 20, l => late.push(l))).resolves.toBe(TIMED_OUT);
        await slow.catch(() => { });
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(late.length).toBe(1);
        expect("error" in late[0]).toBe(true);
        expect(late[0].error).toBeUndefined();
    });

    it("does not leave a late rejection unhandled", async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);

        try {
            const slow = new Promise<void>((_, reject) => setTimeout(() => reject(new Error("late")), 60));
            await expect(withTimeout(slow, 20)).resolves.toBe(TIMED_OUT);
            await new Promise(resolve => setTimeout(resolve, 120));
            expect(unhandled).toEqual([]);
        }
        finally {
            process.off("unhandledRejection", onUnhandled);
        }
    });

    it("contains a reporter that throws", async () => {
        // `onLateSettle` runs in a `then` handler on a promise nobody holds, so
        // a throw there has no caller to catch it. The reporters this exists
        // for end in a consumer-supplied Tracer, which is exactly the code the
        // timeout is here to contain.
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);
        const reported: unknown[] = [];
        Trace.configure(new class extends NoOpTracer implements Tracer {
            error(error: any): void { reported.push(error); }
        }());

        try {
            const slow = new Promise<void>(resolve => setTimeout(resolve, 60));
            await expect(withTimeout(slow, 20, () => { throw new Error("reporter blew up"); }))
                .resolves.toBe(TIMED_OUT);
            await slow;
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(unhandled).toEqual([]);
            expect(reported.map(String)).toEqual(["Error: reporter blew up"]);
        }
        finally {
            Trace.off();
            process.off("unhandledRejection", onUnhandled);
        }
    });

    it("clears its timer once the promise settles", async () => {
        // A pending timer would keep the event loop alive well past the await,
        // which is what makes a long default bound safe to use everywhere.
        // `getActiveResourcesInfo` landed in Node 17; older runtimes just skip
        // the assertion rather than failing the suite.
        const activeTimeouts = () => {
            const info = (process as any).getActiveResourcesInfo;
            return typeof info === "function"
                ? (info.call(process) as string[]).filter(r => r === "Timeout").length
                : undefined;
        };
        const before = activeTimeouts();
        await withTimeout(Promise.resolve("value"), 60000);
        const after = activeTimeouts();

        if (before !== undefined && after !== undefined) {
            expect(after).toBeLessThanOrEqual(before);
        }
    });
});
