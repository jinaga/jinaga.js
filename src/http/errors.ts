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

/**
 * Decide whether a POST that failed with this status is worth retrying
 * (issue #234). 5xx is transient by definition. Of the 4xx, only 408 — which
 * `FetchConnection` also synthesizes for its own timeout — and 429 ask to be
 * retried. Every other 4xx is deterministic: the same request will fail the
 * same way, so retrying only delays the failure the caller needs to act on.
 *
 * It lives here, beside the errors it classifies, so the connection that
 * decides whether to retry and the saver that decides whether a batch was
 * refused read the same rule rather than two copies of it (issue #395).
 */
export function isRetryableStatus(statusCode: number): boolean {
    return statusCode >= 500 || statusCode === 408 || statusCode === 429;
}

/**
 * The statuses that ask the caller to authenticate and try again: 401
 * Unauthorized, 407 Proxy Authentication Required, and 419, which some
 * deployments return for an expired session. A connection reattempts the
 * request once it has reauthenticated, so one of these reaching a caller means
 * reauthentication did not cure it.
 */
export function isAuthenticationChallenge(statusCode: number): boolean {
    return statusCode === 401 || statusCode === 407 || statusCode === 419;
}

/**
 * Did the replicator judge these facts and refuse them, or did the request
 * never reach a replicator that could judge them (issue #395)?
 *
 * The distinction decides what a failed `POST /save` means for the rest of the
 * queue. A refusal is about *these* facts, so other facts may still be
 * accepted, and the same facts sent in smaller requests may be accepted too.
 * A connection failure is about the request, so every later request in the
 * flush would fail the same way.
 *
 * Derived from {@link isRetryableStatus} and {@link isAuthenticationChallenge}
 * rather than from a list of statuses of its own: a refusal is a response the
 * replicator will repeat, which is exactly a status that is neither worth
 * retrying nor curable by authenticating. An error that carries no status never
 * reached a replicator at all.
 */
export function isRefusal(error: unknown): boolean {
    if (!(error instanceof HttpError)) {
        return false;
    }
    const statusCode = error.statusCode;
    return statusCode >= 400
        && !isRetryableStatus(statusCode)
        && !isAuthenticationChallenge(statusCode);
}
