import { Trace } from "../util/trace";
import { HttpHeaders } from "./authenticationProvider";
import { HttpConnection, HttpResponse } from "./web-client";

interface XHRResponseSuccess {
    result: "success";
    response: any;
}

interface XHRResponseRetry {
    result: "retry";
    error: string;
}

interface XHRResponseReauthenticate {
    result: "reauthenticate";
}

type XHRResponse = XHRResponseSuccess | XHRResponseRetry | XHRResponseReauthenticate;

function createXHR(
    method: string,
    path: string,
    getHeaders: () => Promise<HttpHeaders>,
    timeoutSeconds: number = 30,
    body: {} | string | null = null
): Promise<XHRResponse> {
    return new Promise<XHRResponse>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, path, true);
        xhr.onload = () => {
            if (xhr.status === 401 || xhr.status === 407 || xhr.status === 419) {
                resolve({
                    result: "reauthenticate"
                });
            }
            else if (xhr.status === 403) {
                reject(xhr.responseText);
            }
            else if (xhr.status >= 400) {
                resolve({
                    result: "retry",
                    error: xhr.responseText
                });
            }
            else if (xhr.status === 201) {
                resolve({
                    result: "success",
                    response: 0
                });
            }
            else if (xhr.status === 200) {
                if (xhr.responseType === 'json') {
                    const response = <{}>xhr.response;
                    resolve({
                        result: "success",
                        response: response
                    });
                }
                else {
                    const response = <{}>JSON.parse(xhr.response);
                    resolve({
                        result: "success",
                        response: response
                    });
                }
            }
            else {
                resolve({
                    result: "retry",
                    error: 'Unexpected response code: ' + xhr.status
                });
            }
        };
        xhr.ontimeout = (event) => {
            Trace.warn('Network request timed out.');
            resolve({
                result: "retry",
                error: 'Network request timed out.'
            });
        };
        xhr.onerror = (event) => {
            Trace.warn('Network request failed.');
            resolve({
                result: "retry",
                error: 'Network request failed.'
            });
        };
        xhr.setRequestHeader('Accept', 'application/json');
        getHeaders()
            .then(headers => {
                setHeaders(headers, xhr);
                xhr.timeout = timeoutSeconds * 1000;
                if (body) {
                    if (typeof body === 'string') {
                        xhr.setRequestHeader('Content-Type', 'text/plain');
                        xhr.send(body);
                    }
                    else {
                        xhr.setRequestHeader('Content-Type', 'application/json');
                        xhr.send(JSON.stringify(body));
                    }
                }
                xhr.send();
            })
            .catch(reject);
    });
}

export class XhrConnection implements HttpConnection {
    constructor(
        private url: string,
        private getHeaders: () => Promise<HttpHeaders>,
        private reauthenticate: () => Promise<boolean>
    ) { }

    get(path: string): Promise<{}> {
        return Trace.dependency('GET', path, async () => {
            let attemptsRemaining = 2;
            while (attemptsRemaining > 0) {
                const response = await createXHR('GET', this.url + path, this.getHeaders);
                if (response.result === "success") {
                    return response.response;
                }
                else if (response.result === "retry") {
                    throw new Error(response.error);
                }
                else if (response.result === "reauthenticate") {
                    const retry = await this.reauthenticate();
                    if (!retry) {
                        throw new Error('Authentication failed');
                    }
                }
                attemptsRemaining--;
            }
            throw new Error('Authentication failed');
        });
    }

    post(path: string, body: {} | string, timeoutSeconds: number): Promise<HttpResponse> {
        return Trace.dependency('POST', path, async () => {
            let attemptsRemaining = 2;
            while (attemptsRemaining > 0) {
                const response = await createXHR('POST', this.url + path, this.getHeaders, timeoutSeconds, body);
                if (response.result === "success") {
                    return {
                        result: "success",
                        response: response.response
                    };
                }
                else if (response.result === "retry") {
                    return {
                        result: "retry",
                        error: response.error
                    };
                }
                else if (response.result === "reauthenticate") {
                    const retry = await this.reauthenticate();
                    if (!retry) {
                        throw new Error('Authentication failed');
                    }
                }
                attemptsRemaining--;
            }
            throw new Error('Authentication failed');
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
