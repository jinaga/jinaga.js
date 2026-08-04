/**
 * Thrown when the replicator responds with an error status (issue #234). The
 * server sends its actual diagnostic text in the *response body*, but the
 * previous `new Error(statusMessage)` threw all of that away and kept only the
 * generic HTTP reason phrase (`"Internal Server Error"`, `"Bad Request"`), so
 * no server-side error message ever reached a caller. `reason` is the extracted
 * human-readable message, `statusCode` is the HTTP status, and `body` is the
 * raw response body, so callers can surface or inspect the explanation.
 */
export class HttpError extends Error {
    constructor(
        public readonly reason: string,
        public readonly statusCode: number,
        public readonly body: unknown
    ) {
        super(reason);
        this.name = 'HttpError';
        // Restore the prototype chain so `instanceof HttpError` works after
        // TypeScript's down-level `extends Error` transpilation.
        Object.setPrototypeOf(this, HttpError.prototype);
    }
}

/**
 * Thrown on an HTTP 403 from the replicator (issue #207 W10). The replicator
 * sends the actual reason a `/read`/`/load`/`/feeds` request was forbidden in
 * the response body; this preserves it rather than discarding it for the bare
 * status line.
 */
export class ForbiddenError extends HttpError {
    constructor(reason: string, body: unknown) {
        super(reason, 403, body);
        this.name = 'ForbiddenError';
        Object.setPrototypeOf(this, ForbiddenError.prototype);
    }
}

/**
 * Derive a human-readable reason from an error response body, preferring a
 * plain-string body or a `reason`/`message` field, and falling back to the HTTP
 * status line otherwise. An object body without a `reason`/`message` field is
 * not stringified into the reason — that would yield noisy or oversized text
 * like `"{}"`; the raw body is preserved on `HttpError.body` for callers that
 * want to inspect it.
 */
export function responseReason(body: unknown, statusMessage: string | undefined, fallback: string): string {
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
    }
    return statusMessage || fallback;
}

/**
 * The 403 flavor of {@link responseReason}, falling back to `'Forbidden'` when
 * the response carries neither a usable body nor a status line.
 */
export function forbiddenReason(body: unknown, fallback: string | undefined): string {
    return responseReason(body, fallback, 'Forbidden');
}
