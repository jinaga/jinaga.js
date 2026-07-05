/**
 * Thrown on an HTTP 403 from the replicator (issue #207 W10). The replicator
 * sends the actual reason a `/read`/`/load`/`/feeds` request was forbidden in
 * the *response body*, but the previous `new Error(statusMessage)` threw away
 * everything but the status line (`"Forbidden"`). `reason` is the extracted
 * human-readable message and `body` is the raw response body, so callers can
 * surface or inspect the replicator's explanation.
 */
export class ForbiddenError extends Error {
    constructor(
        public readonly reason: string,
        public readonly body: unknown
    ) {
        super(reason);
        this.name = 'ForbiddenError';
        // Restore the prototype chain so `instanceof ForbiddenError` works after
        // TypeScript's down-level `extends Error` transpilation.
        Object.setPrototypeOf(this, ForbiddenError.prototype);
    }
}

/**
 * Derive a human-readable reason from a 403 response body, preferring a
 * `reason`/`message` field or a plain-string body, and falling back to the HTTP
 * status line when the body carries nothing useful.
 */
export function forbiddenReason(body: unknown, fallback: string | undefined): string {
    if (typeof body === 'string' && body.trim().length > 0) {
        return body;
    }
    if (body !== null && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        if (typeof record.reason === 'string' && record.reason.length > 0) {
            return record.reason;
        }
        if (typeof record.message === 'string' && record.message.length > 0) {
            return record.message;
        }
        try {
            return JSON.stringify(body);
        }
        catch {
            // Non-serializable body; fall through to the status line.
        }
    }
    return fallback || 'Forbidden';
}
