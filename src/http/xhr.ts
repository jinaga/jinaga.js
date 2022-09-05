import { HttpConnection, HttpResponse } from "./web-client";

function createXHR(
    method: string,
    path: string,
    resolve: (result: any) => void,
    reject: (reason: any) => void,
    retry: (reason: any) => void
) {
    const xhr = new XMLHttpRequest();
    xhr.open(method, path, true);
    xhr.onload = () => {
        if (xhr.status === 403) {
            reject(xhr.responseText);
        }
        else if (xhr.status >= 400) {
            retry(xhr.responseText);
        }
        else if (xhr.status === 201) {
            resolve(0);
        }
        else if (xhr.responseType === 'json') {
            const response = <{}>xhr.response;
            resolve(response);
        }
        else {
            const response = <{}>JSON.parse(xhr.response);
            resolve(response);
        }
    };
    xhr.ontimeout = (event) => {
        retry('Network request timed out.');
    };
    xhr.onerror = (event) => {
        retry('Network request failed.');
    };
    xhr.setRequestHeader('Accept', 'application/json');
    return xhr;
}

export class XhrConnection implements HttpConnection {
    constructor(
        private url: string) {
    }

    get(path: string) {
        return new Promise<{}>((resolve, reject) => {
            const xhr = createXHR('GET', this.url + path, resolve, reject, reject);
            xhr.send();
        });
    }

    post(path: string, body: {}, timeoutSeconds: number) {
        return new Promise<HttpResponse>((resolve,reject) => {
            const xhr = createXHR('POST', this.url + path,
                (result: any) => {
                    resolve({
                        result: "success",
                        response: result
                    })
                },
                (reason: any) => {
                    resolve({
                        result: "failure",
                        error: reason
                    })
                },
                (reason: any) => {
                    resolve({
                        result: "retry",
                        error: reason
                    });
                }
            );
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = timeoutSeconds * 1000;
            xhr.send(JSON.stringify(body));
        });
    }
}