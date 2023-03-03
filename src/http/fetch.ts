import { delay } from '../util/promise';
import { Trace } from "../util/trace";
import { HttpConnection, HttpResponse } from "./web-client";

export class FetchConnection implements HttpConnection {
  constructor(
    private url: string) {
  }

  get(path: string) {
    return Trace.dependency('GET', path, () => {
      const url = this.url;
      async function callFetch() {
        const response = await fetch(url + path);
        const body = await response.json();
        return body;
      }
      async function timeout() {
        await delay(1000);
        throw new Error('Timeout in login.');
      }
      return Promise.race([callFetch(), timeout()]);
    });
  }

  post(path: string, body: {} | string, timeoutSeconds: number): Promise<HttpResponse> {
    return Trace.dependency('POST', path, async () => {
      const response = await fetch(this.url + path, {
        method: 'POST',
        body: (typeof body === 'string') ? body : JSON.stringify(body),
        headers: {
          'Content-Type': (typeof body === 'string') ? 'text/plain' : 'application/json'
        }
      });
      const json = await response.json();
      return {
        result: 'success',
        response: json
      };
    });
  }
}