import { HttpConnection, HttpResponse } from "./web-client";
import { delay } from '../util/promise';

export class FetchConnection implements HttpConnection {
  constructor(
    private url: string) {
  }

  get(path: string) {
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
  }

  async post(path: string, body: {} | string, timeoutSeconds: number): Promise<HttpResponse> {
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
  }
}