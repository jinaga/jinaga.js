import { Trace } from "../util/trace";
import { HttpHeaders } from "./authenticationProvider";
import { PostAccept, PostContentType, ContentTypeJson } from "./ContentType";
import { ForbiddenError, forbiddenReason, HttpError, responseReason } from "./errors";
import { HttpConnection, HttpResponse } from "./web-client";

interface FetchHttpResponse {
    statusCode: number;
    statusMessage: string | undefined;
    responseType: string;
    response: any;
}

/**
 * Decide whether a POST that failed with this status is worth retrying
 * (issue #234). 5xx is transient by definition. Of the 4xx, only 408 — which
 * this connection also synthesizes for its own timeout — and 429 ask to be
 * retried. Every other 4xx is deterministic: the same request will fail the
 * same way, so retrying only delays the failure the caller needs to act on.
 */
function isRetryableStatus(statusCode: number): boolean {
    return statusCode >= 500 || statusCode === 408 || statusCode === 429;
}

export class FetchConnection implements HttpConnection {
    constructor(
        private url: string,
        private getHeaders: () => Promise<HttpHeaders>,
        private reauthenticate: () => Promise<boolean>
    ) {}

    get(path: string): Promise<object> {
        return Trace.dependency('GET', path, async () => {
            let headers = await this.getHeaders();
            let response = await this.httpGet(path, headers);
            if (response.statusCode === 401 || response.statusCode === 407 || response.statusCode === 419) {
                const retry = await this.reauthenticate();
                if (retry) {
                    headers = await this.getHeaders();
                    response = await this.httpGet(path, headers);
                }
            }
            if (response.statusCode === 403) {
                // Preserve the replicator's forbidden reason from the body
                // instead of discarding it for the bare status line (W10).
                throw new ForbiddenError(forbiddenReason(response.response, response.statusMessage), response.response);
            }
            else if (response.statusCode >= 400) {
                // Surface the server's diagnostic body instead of the bare
                // status line (issue #234).
                throw new HttpError(
                    responseReason(response.response, response.statusMessage, "Unknown error"),
                    response.statusCode,
                    response.response);
            }
            else if (response.statusCode === 200) {
                if (typeof response.response === 'string') {
                    return JSON.parse(response.response);
                }
                else {
                    return <object>response.response;
                }
            }
            else {
                throw new Error(`Unexpected status code ${response.statusCode}: ${response.statusMessage}`);
            }
        });
    }

    private async httpGet(tail: string, headers: HttpHeaders): Promise<FetchHttpResponse> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
            const response = await fetch(this.url + tail, {
                method: 'GET',
                headers: {
                    'Accept': ContentTypeJson,
                    ...headers
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const contentType = response.headers.get('content-type') || '';
            const responseBody = contentType.includes(ContentTypeJson) ? await response.json() : await response.text();

            return {
                statusCode: response.status,
                statusMessage: response.statusText,
                responseType: contentType,
                response: responseBody
            };
        } catch (error: any) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                Trace.warn('Network request timed out.');
                return {
                    statusCode: 408,
                    statusMessage: "Request Timeout",
                    responseType: '',
                    response: null
                };
            } else {
                Trace.warn('Network request failed.');
                return {
                    statusCode: 500,
                    statusMessage: "Network request failed",
                    responseType: '',
                    response: null
                };
            }
        }
    }

    getStream(path: string, onResponse: (response: object) => Promise<void>, onError: (err: Error) => void, feedRefreshIntervalSeconds: number): () => void {
        const controller = new AbortController();
        const signal = controller.signal;
        let closed = false;

        // Backoff that a disconnect can cut short. Without this the loop stays
        // parked in a timer for up to feedRefreshIntervalSeconds after the
        // caller has already let go, which delays teardown and keeps the
        // process alive on a pending timer that will only ever observe `closed`.
        let wake: (() => void) | undefined;
        const sleep = (ms: number) => new Promise<void>(resolve => {
            const timer = setTimeout(() => {
                wake = undefined;
                resolve();
            }, ms);
            wake = () => {
                clearTimeout(timer);
                wake = undefined;
                resolve();
            };
        });

        // Start a background task to read the stream.
        // This function will read one chunk and pass it to onResponse.
        // The function will then call itself to read the next chunk.
        // If an error occurs, it will retry after a delay.
        (async () => {
            let attempt = 0;
            const baseDelayMs = 1000;
            while (!closed) {
                try {
                    const headers = await this.getHeaders();
                    if (closed) {
                        return;
                    }

                    const response = await fetch(this.url + path, {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/x-jinaga-feed-stream',
                            ...headers
                        },
                        signal
                    });

                    if (!response.ok) {
                        // Type this the way get() types its failures (issue
                        // #234), so a caller can tell the replicator's
                        // documented 404 `feed_not_found` -- the signal that it
                        // no longer holds this feed registration -- from a
                        // server that is merely unreachable. The plain Error
                        // thrown here before carried neither status nor body,
                        // which left the two indistinguishable (issue #243).
                        const body = await this.readErrorBody(response);
                        throw new HttpError(
                            responseReason(body, response.statusText, "Unknown error"),
                            response.status,
                            body);
                    }

                    const reader = response.body?.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';

                    const read = async () => {
                        if (closed) {
                            return;
                        }

                        try {
                            const { done, value } = await reader?.read()!;
                            if (done) {
                                return;
                            }

                            buffer += decoder.decode(value, { stream: true });
                            const lastNewline = buffer.lastIndexOf('\n');
                            if (lastNewline >= 0) {
                                const jsonText = buffer.substring(0, lastNewline);
                                buffer = buffer.substring(lastNewline + 1);
                                const lines = jsonText.split(/\r?\n/);
                                for (const line of lines) {
                                    if (line.length > 0) {
                                        try {
                                            // As data comes in, parse non-blank lines to JSON and pass to onResponse.
                                            const json = JSON.parse(line);
                                            await onResponse(json);
                                        } catch (err) {
                                            onError(err as Error);
                                        }
                                    }
                                    // Skip blank lines.
                                }
                            }

                            // Continue reading the next chunk.
                            read();
                        } catch (err) {
                            onError(err as Error);
                        }
                    };

                    // Start reading the first chunk.
                    read();
                    break;
                } catch (err: any) {
                    if (err.name === 'AbortError') {
                        return;
                    }
                    // Report the failure before backing off (issue #243).
                    // onError used to be reachable only from the read loop
                    // above, which requires a connection that already opened,
                    // so a failure to open one was invisible outside this
                    // closure: the loop reissued the same doomed URL forever
                    // with no signal anywhere that it would never succeed.
                    try {
                        onError(err as Error);
                    } catch (handlerError) {
                        Trace.error(handlerError);
                    }
                    if (closed) {
                        return;
                    }
                    const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
                    const jitter = Math.random() * baseDelayMs;
                    const delay = Math.min(exponentialDelay + jitter, feedRefreshIntervalSeconds * 1000);
                    await sleep(delay);
                    attempt++;
                }
            }
        })();

        return () => {
            // If the connection is closed, exit.
            closed = true;
            controller.abort();
            if (wake) {
                wake();
            }
        };
    }

    /**
     * Read a failed stream response's body for its diagnostic text, best
     * effort. The body only enriches the error being reported; a body that
     * cannot be read must not displace the status code that is the point of
     * reporting it at all.
     */
    private async readErrorBody(response: Response): Promise<unknown> {
        try {
            const contentType = response.headers?.get('content-type') || '';
            return contentType.includes(ContentTypeJson) ? await response.json() : await response.text();
        } catch (err) {
            Trace.warn(`Could not read the body of a failed feed stream response: ${err}`);
            return null;
        }
    }

    post(path: string, contentType: PostContentType, accept: PostAccept, body: string, timeoutSeconds: number): Promise<HttpResponse> {
        return Trace.dependency('POST', path, async () => {
            let headers = await this.getHeaders();
            let response = await this.httpPost(path, headers, contentType, accept, body, timeoutSeconds);
            if (response.statusCode === 401 || response.statusCode === 407 || response.statusCode === 419) {
                const reauthenticated = await this.reauthenticate();
                if (reauthenticated) {
                    headers = await this.getHeaders();
                    response = await this.httpPost(path, headers, contentType, accept, body, timeoutSeconds);
                }
            }
            if (response.statusCode === 403) {
                // Preserve the replicator's forbidden reason from the body
                // instead of discarding it for the bare status line (W10).
                throw new ForbiddenError(forbiddenReason(response.response, response.statusMessage), response.response);
            }
            else if (response.statusCode >= 400) {
                // Surface the server's diagnostic body instead of the bare
                // status line, and only ask for a retry when the status can
                // actually succeed on a second attempt (issue #234).
                return {
                    result: isRetryableStatus(response.statusCode) ? "retry" : "failure",
                    error: responseReason(response.response, response.statusMessage, "Unknown error"),
                    statusCode: response.statusCode,
                    body: response.response
                }
            }
            else if (response.statusCode === 201) {
                return {
                    result: "success",
                    response: {}
                };
            }
            else if (response.statusCode === 200) {
                if (typeof response.response === 'string') {
                    return {
                        result: "success",
                        response: JSON.parse(response.response)
                    };
                }
                else {
                    return {
                        result: "success",
                        response: response.response
                    };
                }
            }
            else {
                throw new Error(`Unexpected status code ${response.statusCode}: ${response.statusMessage}`);
            }
        });
    }

    private async httpPost(tail: string, headers: HttpHeaders, contentType: PostContentType, accept: PostAccept, body: string, timeoutSeconds: number): Promise<FetchHttpResponse> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

        try {
            if (accept) {
                headers = {
                    'Accept': accept,
                    ...headers
                };
            }
            const response = await fetch(this.url + tail, {
                method: 'POST',
                headers: {
                    'Content-Type': contentType,
                    ...headers
                },
                body: body,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const responseContentType = response.headers.get('content-type') || '';
            const responseBody = responseContentType.includes(ContentTypeJson) ? await response.json() : await response.text();

            return {
                statusCode: response.status,
                statusMessage: response.statusText,
                responseType: responseContentType,
                response: responseBody
            };
        } catch (error: any) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                Trace.warn('Network request timed out.');
                return {
                    statusCode: 408,
                    statusMessage: "Request Timeout",
                    responseType: '',
                    response: null
                };
            } else {
                Trace.warn('Network request failed.');
                return {
                    statusCode: 500,
                    statusMessage: "Network request failed",
                    responseType: '',
                    response: null
                };
            }
        }
    }

    async getAcceptedContentTypes(path: string): Promise<string[]> {
        const response = await fetch(this.url + path, { method: 'OPTIONS' });
        const contentTypeHeader = response.headers.get('accept-post');
        return contentTypeHeader ? contentTypeHeader.split(',').map(type => type.trim()) : [];
    }
}