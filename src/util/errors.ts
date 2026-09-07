/**
 * Thrown when input is malformed or violates a rule that no retry can fix
 * (issue #234). Every throw site in this package used to be a bare `new Error`,
 * which left downstream code — notably `jinaga-server`'s error-to-HTTP-status
 * mapping — with no way to classify a failure except by regex-matching the
 * English message text. That breaks silently whenever the wording changes here.
 * Subclasses carry structured detail so callers can `instanceof`-check instead.
 */
export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
        // Restore the prototype chain so `instanceof ValidationError` works after
        // TypeScript's down-level `extends Error` transpilation.
        Object.setPrototypeOf(this, ValidationError.prototype);
    }
}

/**
 * Thrown when a caller's opt-in bound on a feed's first response expires
 * (issue #280). A replicator that accepts the connection and never answers
 * leaves a subscription's start pending forever, which puts a service that
 * awaits it during boot behind a machine it may never hear from.
 *
 * It is a distinct type rather than a `ValidationError` because it says
 * nothing about the request: the same call may well succeed on the next
 * attempt. Callers retry on this and give up on that.
 */
export class FeedTimeoutError extends Error {
    constructor(message: string, public readonly timeoutMs: number) {
        super(message);
        this.name = 'FeedTimeoutError';
        Object.setPrototypeOf(this, FeedTimeoutError.prototype);
    }
}
