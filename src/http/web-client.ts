import { serializeSave } from "../fork/serialize";
import { FactEnvelope } from "../storage";
import { Trace } from "../util/trace";
import { FeedResponse, FeedsResponse, LoadMessage, LoadResponse, LoginResponse, SaveMessage } from "./messages";

export type SyncStatus = {
    sending: boolean;
    retrying: boolean;
    retryInSeconds: number;
    warning: string;
}

export class SyncStatusNotifier {
    private syncStatusHandlers: ((status: SyncStatus) => void)[] = [];

    onSyncStatus(handler: (status: SyncStatus) => void) {
        this.syncStatusHandlers.push(handler);
    }

    notify(status: SyncStatus) {
        this.syncStatusHandlers.forEach(handler => {
            handler(status);
        });
    }
}

export interface HttpSuccess {
    result: "success";
    response: {}
}

export interface HttpFailure {
    result: "failure";
    error: string;
}

export interface HttpRetry {
    result: "retry";
    error: string
}

export type HttpResponse = HttpSuccess | HttpFailure | HttpRetry;

export interface HttpConnection {
    get(path: string): Promise<{}>;
    getStream(path: string, onResponse: (response: {}) => Promise<void>, onError: (err: Error) => void): () => void;
    post(path: string, body: {} | string, timeoutSeconds: number): Promise<HttpResponse>;
}

function delay(timeSeconds: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        setTimeout(resolve, timeSeconds * 1000);
    });
}

export interface WebClientConfig {
    timeoutSeconds: number;
}

export class WebClient {
    constructor(
        private httpConnection: HttpConnection,
        private syncStatusNotifier: SyncStatusNotifier,
        private config: WebClientConfig) {
    }

    async login() {
        return <LoginResponse> await this.httpConnection.get('/login');
    }

    async save(envelopes: FactEnvelope[]) {
        await this.post('/save', serializeSave(envelopes));
    }

    async saveWithRetry(envelopes: FactEnvelope[]) {
        await this.postWithLimitedRetry('/save', serializeSave(envelopes));
    }

    async load(load: LoadMessage) {
        return <LoadResponse> await this.post('/load', load);
    }

    async loadWithRetry(load: LoadMessage) {
        return <LoadResponse> await this.postWithLimitedRetry('/load', load);
    }

    async feeds(request: string): Promise<FeedsResponse> {
        return <FeedsResponse> await this.post('/feeds', request);
    }

    async feed(feed: string, bookmark: string): Promise<FeedResponse> {
        return <FeedResponse> await this.httpConnection.get(`/feeds/${feed}?b=${bookmark}`);
    }

    streamFeed(feed: string, bookmark: string, onResponse: (response: FeedResponse) => Promise<void>, onError: (err: Error) => void): () => void {
        return this.httpConnection.getStream(`/feeds/${feed}?b=${bookmark}`, r => onResponse(r as FeedResponse), onError);
    }

    private async post(path: string, body: {} | string) {
        const response = await this.httpConnection.post(path, body, this.config.timeoutSeconds);
        if (response.result === 'success') {
            return response.response;
        }
        else {
            throw new Error(response.error);
        }
    }

    private async postWithLimitedRetry(path: string, body: {} | string) {
        let timeoutSeconds = this.config.timeoutSeconds;
        let retrySeconds = 1;

        while (true) {
            const response = await this.httpConnection.post(path, body, this.config.timeoutSeconds);
            if (response.result === 'success') {
                return response.response;
            }
            else if (response.result === 'failure') {
                throw new Error(response.error);
            }
            else {
                if (retrySeconds <= 4) {
                    Trace.warn(`Retrying in ${retrySeconds} seconds: ${response.error}`);
                    await delay(retrySeconds + Math.random());
                    timeoutSeconds = Math.min(timeoutSeconds * 2, 60);
                    retrySeconds = retrySeconds * 2;
                }
                else {
                    throw new Error(response.error);
                }
            }
        }
    }

    private async postWithInfiniteRetry(path: string, body: {} | string) {
        let timeoutSeconds = this.config.timeoutSeconds;
        let retrySeconds = 1;

        while (true) {
            this.syncStatusNotifier.notify({
                sending: true,
                retrying: false,
                retryInSeconds: 0,
                warning: ''
            });
            const response = await this.httpConnection.post(path, body, timeoutSeconds);
            if (response.result === "success") {
                this.syncStatusNotifier.notify({
                    sending: false,
                    retrying: false,
                    retryInSeconds: 0,
                    warning: ''
                });
                return response.response;
            }
            else if (response.result === "failure") {
                this.syncStatusNotifier.notify({
                    sending: false,
                    retrying: false,
                    retryInSeconds: 0,
                    warning: response.error
                });
                throw new Error(response.error);
            }
            else {
                this.syncStatusNotifier.notify({
                    sending: false,
                    retrying: true,
                    retryInSeconds: retrySeconds,
                    warning: response.error
                });
                Trace.warn(`Retrying in ${retrySeconds} seconds: ${response.error}`);
                await delay(retrySeconds + Math.random());
                timeoutSeconds = Math.min(timeoutSeconds * 2, 60);
                retrySeconds = Math.min(retrySeconds * 2, 60);
            }
        }
    }
}