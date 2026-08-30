export function delay(ms: number) {
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => resolve(), ms);
  });
}

/** Resolved value of `withTimeout` when the deadline passes before the promise settles. */
export const TIMED_OUT: unique symbol = Symbol("jinaga.timed-out");

export interface LateSettle {
  /** Present when the abandoned promise eventually rejected. */
  error?: unknown;
  /** Milliseconds from the call to the late settle. */
  elapsedMs: number;
}

/**
 * Await `promise` for at most `timeoutMs`. Resolves with the promise's value,
 * or with `TIMED_OUT` when the deadline passes first. A rejection that arrives
 * before the deadline propagates normally, so a caller's existing error
 * handling is unchanged.
 *
 * `timeoutMs <= 0` (or a non-finite value) disables the bound: the original
 * promise is returned unchanged and no timer is created.
 *
 * The timer is always cleared, so a fast promise never leaves a pending
 * `setTimeout` handle holding the event loop open. `Promise.race` attaches a
 * rejection handler to `promise`, so a rejection arriving after the race is
 * decided cannot escape as an unhandled rejection; `onLateSettle` additionally
 * reports it.
 *
 * Note that abandoning the wait does not cancel the work. A promise that never
 * settles is retained by these handlers for the lifetime of the process. That
 * is inherent to continuing without it, and is bounded by the number of
 * timed-out waits.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onLateSettle?: (late: LateSettle) => void
): Promise<T | typeof TIMED_OUT> {
  if (!(timeoutMs > 0) || !isFinite(timeoutMs)) {
    return promise;
  }
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout>;
  let timedOut = false;
  const expiry = new Promise<typeof TIMED_OUT>(resolve => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(TIMED_OUT);
    }, timeoutMs);
  });
  if (onLateSettle) {
    promise.then(
      () => { if (timedOut) onLateSettle({ elapsedMs: Date.now() - start }); },
      error => { if (timedOut) onLateSettle({ error, elapsedMs: Date.now() - start }); }
    );
  }
  return Promise.race([promise, expiry])
    .finally(() => clearTimeout(timer));
}
