import { Trace } from "../util/trace";
import { HttpHeaders } from "./authenticationProvider";
import { PostAccept, PostContentType, ContentTypeJson } from "./ContentType";
import { HttpConnection, HttpResponse } from "./web-client";

interface FetchHttpResponse {
    statusCode: number;
    statusMessage: string | undefined;
    responseType: string;
    response: any;
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
            if (response.statusCode >= 400) {
                throw new Error(response.statusMessage);
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

    getStream(path: string, onResponse: (response: object) => Promise<void>, onError: (err: Error) => void): () => void {
        const controller = new AbortController();
        const signal = controller.signal;
        let closed = false;

        // Start a background task to read the stream.
        // This function will read one chunk and pass it to onResponse.
        // The function will then call itself to read the next chunk.
        // If an error occurs, it will call onError.
        (async () => {
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
                    throw new Error(`Unexpected status code ${response.status}: ${response.statusText}`);
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
            } catch (err: any) {
                if (err.name === 'AbortError') {
                    // Request was aborted, do nothing
                } else {
                    onError(err as Error);
                }
            }
        })();

        return () => {
            // If the connection is closed, exit.
            closed = true;
            controller.abort();
        };
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
                throw new Error(response.statusMessage);
            }
            else if (response.statusCode >= 400) {
                return {
                    result: "retry",
                    error: response.statusMessage || "Unknown error"
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
        const response = await fetch(path, { method: 'OPTIONS' });
        const contentTypeHeader = response.headers.get('Accept');
        return contentTypeHeader ? contentTypeHeader.split(',').map(type => type.trim()) : [];
    }
}