import { Trace } from "../util/trace";
import { HttpHeaders } from "./authenticationProvider";
import { HttpConnection, HttpResponse } from "./web-client";

interface XHRHttpResponse {
    statusCode: number;
    statusMessage: string | undefined;
    responseType: XMLHttpRequestResponseType;
    response: any;
}

export class XhrConnection implements HttpConnection {
    constructor(
        private url: string,
        private getHeaders: () => Promise<HttpHeaders>,
        private reauthenticate: () => Promise<boolean>
    ) { }

    get(path: string): Promise<{}> {
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
                if (response.responseType === 'json') {
                    return <{}>response.response;
                }
                else {
                    return <{}>JSON.parse(response.response);
                }
            }
            else {
                throw new Error(`Unexpected status code ${response.statusCode}: ${response.statusMessage}`);
            }
        });
    }
    
    private httpGet(tail: string, headers: HttpHeaders): Promise<XHRHttpResponse> {
        return new Promise<XHRHttpResponse>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", this.url + tail, true);
            xhr.onload = () => {
                resolve({
                    statusCode: xhr.status,
                    statusMessage: xhr.statusText,
                    responseType: xhr.responseType,
                    response: xhr.response
                });
            };
            xhr.ontimeout = (event) => {
                Trace.warn('Network request timed out.');
                resolve({
                    statusCode: 408,
                    statusMessage: "Request Timeout",
                    responseType: xhr.responseType,
                    response: xhr.response
                });
            };
            xhr.onerror = (event) => {
                Trace.warn('Network request failed.');
                resolve({
                    statusCode: 500,
                    statusMessage: "Network request failed",
                    responseType: xhr.responseType,
                    response: xhr.response
                });
            };
            xhr.setRequestHeader('Accept', 'application/json');
            setHeaders(headers, xhr);
            xhr.timeout = 30000;
            xhr.send();
        });
    }

    getStream(path: string, onResponse: (response: {}) => Promise<void>, onError: (err: Error) => void): () => void {
        const xhr = new XMLHttpRequest();
        let receivedBytes = 0;
        xhr.open("GET", this.url + path, true);
        xhr.setRequestHeader('Accept', 'application/x-jinaga-feed-stream');
        let closed = false;
        this.getHeaders().then(headers => {
            if (closed) {
                return;
            }
            setHeaders(headers, xhr);
            // As data comes in, parse non-blank lines to JSON and pass to onResponse.
            // Skip blank lines.
            // If an error occurs, call onError.
            // If the connection is closed, exit.
            xhr.onprogress = (event) => {
                const response = xhr.response;
                const text = response.substring(receivedBytes);
                // Receive only up to the last newline.
                const lastNewline = text.lastIndexOf('\n');
                if (lastNewline >= 0) {
                    const jsonText = text.substring(0, lastNewline);
                    receivedBytes += jsonText.length + 1;
                    const lines = jsonText.split(/\r?\n/);
                    for (const line of lines) {
                        if (line.length > 0) {
                            try {
                                const json = JSON.parse(line);
                                onResponse(json);
                            }
                            catch (err) {
                                onError(err as Error);
                            }
                        }
                    }
                }
            };
            xhr.onerror = (event) => {
                onError(new Error('Network request failed.'));
            };
            xhr.onload = (event) => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    // The connection was closed.
                    // Do nothing.
                }
                else {
                    onError(new Error(`Unexpected status code ${xhr.status}: ${xhr.statusText}`));
                }
            };
            xhr.send();
        });
        return () => {
            closed = true;
            xhr.abort();
        }
    }

    post(path: string, body: {} | string, timeoutSeconds: number): Promise<HttpResponse> {
        return Trace.dependency('POST', path, async () => {
            let headers = await this.getHeaders();
            let response = await this.httpPost(path, headers, body, timeoutSeconds);
            if (response.statusCode === 401 || response.statusCode === 407 || response.statusCode === 419) {
                const reauthenticated = await this.reauthenticate();
                if (reauthenticated) {
                    headers = await this.getHeaders();
                    response = await this.httpPost(path, headers, body, timeoutSeconds);
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
                if (response.responseType === 'json') {
                    return {
                        result: "success",
                        response: response.response
                    };
                }
                else {
                    return {
                        result: "success",
                        response: JSON.parse(response.response)
                    };
                }
            }
            else {
                throw new Error(`Unexpected status code ${response.statusCode}: ${response.statusMessage}`);
            }
        });
    }

    private httpPost(tail: string, headers: HttpHeaders, body: string | {}, timeoutSeconds: number): Promise<XHRHttpResponse> {
        return new Promise<XHRHttpResponse>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", this.url + tail, true);
            xhr.onload = () => {
                resolve({
                    statusCode: xhr.status,
                    statusMessage: xhr.statusText,
                    responseType: xhr.responseType,
                    response: xhr.response,
                });
            };
            xhr.ontimeout = (event) => {
                Trace.warn('Network request timed out.');
                resolve({
                    statusCode: 408,
                    statusMessage: "Request Timeout",
                    responseType: xhr.responseType,
                    response: xhr.response
                });
            };
            xhr.onerror = (event) => {
                Trace.warn('Network request failed.');
                resolve({
                    statusCode: 500,
                    statusMessage: "Network request failed",
                    responseType: xhr.responseType,
                    response: xhr.response
                });
            };
            xhr.setRequestHeader('Accept', 'application/json');
            setHeaders(headers, xhr);
            xhr.timeout = timeoutSeconds * 1000;
            if (typeof body === 'string') {
                xhr.setRequestHeader('Content-Type', 'text/plain');
                xhr.send(body);
            }
            else {
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(JSON.stringify(body));
            }
        });
    }
}

function setHeaders(headers: HttpHeaders, xhr: XMLHttpRequest) {
    for (const key in headers) {
        const value = headers[key];
        if (value) {
            xhr.setRequestHeader(key, value);
        }
    }
}
