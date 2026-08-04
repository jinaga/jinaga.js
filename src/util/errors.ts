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
