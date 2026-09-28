/**
 * The retry schedule, lifted out of the two loops that used to carry it as
 * constants (issue #305). How long a save waits is a deployment decision -- a
 * mobile app keeps trying through a tunnel, a server-side worker fails fast and
 * lets its supervisor restart it, a test wants no delay at all -- while the
 * loop that does the waiting is mechanism that rarely changes. Expressing the
 * decision here, above both loops, is Article 5 of the degrees-of-freedom
 * constitution; deriving every delay from one schedule rather than from
 * constants at each site is Article 2.
 */
export interface RetryOptions {
    /**
     * Delay before the first retry, in milliseconds. It also bounds the random
     * jitter added to every delay. 0 retries with no delay.
     */
    initialDelayMs?: number;
    /** Ceiling on the delay, before jitter, in milliseconds. */
    maxDelayMs?: number;
    /** Factor the delay grows by after each attempt. */
    backoffMultiplier?: number;
    /**
     * Budget for the delays between attempts, in milliseconds. The loop stops
     * once the next delay would take the accumulated delay past this budget,
     * and throws the last error. 0 means retry without bound, which is what a
     * save that must eventually land wants.
     *
     * The budget counts the delays the schedule plans, not wall-clock time, so
     * the number of attempts a schedule allows does not depend on how long each
     * request takes. A consequence worth stating: a schedule whose delays are
     * all zero never consumes the budget, so it retries until the request
     * succeeds or fails non-retryably.
     */
    timeoutMs?: number;
}

/** A schedule with every value resolved. See {@link resolveRetrySchedule}. */
export interface RetrySchedule {
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    timeoutMs: number;
}

export const DEFAULT_RETRY_INITIAL_DELAY_MS = 1000;
export const DEFAULT_RETRY_MAX_DELAY_MS = 4000;
export const DEFAULT_RETRY_BACKOFF_MULTIPLIER = 2;

/**
 * Budget that admits the four attempts the client made before the schedule was
 * configurable: waits of 1s, 2s and 4s sum to exactly this, and a fourth wait
 * would pass it.
 */
export const DEFAULT_RETRY_TIMEOUT_MS = 7000;

/**
 * Take a caller's number only when it can mean what the field promises.
 * Anything else -- a negative delay, a NaN from a parsed environment variable
 * -- would name a schedule that does not exist, so it falls back rather than
 * becoming a configuration that has to be forbidden later.
 */
function atLeast(value: number | undefined, minimum: number, fallback: number): number {
    return typeof value === 'number' && isFinite(value) && value >= minimum ? value : fallback;
}

/**
 * Resolve a caller's options against the defaults. `pathDefaults` lets a call
 * site substitute its own default for a field the caller left unset, which is
 * how the feed stream keeps backing off to its refresh interval while sharing
 * the schedule a caller does configure.
 */
export function resolveRetrySchedule(
    options: RetryOptions | undefined,
    pathDefaults: Partial<RetrySchedule> = {}
): RetrySchedule {
    const initialDelayMs = atLeast(options?.initialDelayMs, 0,
        atLeast(pathDefaults.initialDelayMs, 0, DEFAULT_RETRY_INITIAL_DELAY_MS));
    const maxDelayMs = atLeast(options?.maxDelayMs, 0,
        atLeast(pathDefaults.maxDelayMs, 0, DEFAULT_RETRY_MAX_DELAY_MS));
    // A multiplier below 1 would shrink the delay with each attempt, which is
    // not a backoff at all.
    const backoffMultiplier = atLeast(options?.backoffMultiplier, 1,
        atLeast(pathDefaults.backoffMultiplier, 1, DEFAULT_RETRY_BACKOFF_MULTIPLIER));
    const timeoutMs = atLeast(options?.timeoutMs, 0,
        atLeast(pathDefaults.timeoutMs, 0, DEFAULT_RETRY_TIMEOUT_MS));
    return { initialDelayMs, maxDelayMs, backoffMultiplier, timeoutMs };
}

/**
 * The waits one retry loop takes, in order. A loop asks for the next wait after
 * each failure; `null` means the budget is spent and the failure is final.
 *
 * Jitter is added after the ceiling rather than before it, so clients that have
 * all reached the ceiling still spread their attempts instead of arriving
 * together. It is deliberately left out of the budget accounting, so a schedule
 * allows the same number of attempts on every run.
 */
export class RetryWaits {
    private plannedDelayMs = 0;
    private delayMs: number;

    constructor(private readonly schedule: RetrySchedule) {
        this.delayMs = schedule.initialDelayMs;
    }

    next(): number | null {
        const plannedDelayMs = Math.min(this.delayMs, this.schedule.maxDelayMs);
        if (this.schedule.timeoutMs > 0 &&
            this.plannedDelayMs + plannedDelayMs > this.schedule.timeoutMs) {
            return null;
        }
        this.plannedDelayMs += plannedDelayMs;
        this.delayMs = this.delayMs * this.schedule.backoffMultiplier;
        // The jitter is bounded by the ceiling as well as by the initial delay,
        // so a schedule that asks for no delay gets none.
        const jitterMs = Math.min(this.schedule.initialDelayMs, this.schedule.maxDelayMs);
        return plannedDelayMs + Math.random() * jitterMs;
    }
}
