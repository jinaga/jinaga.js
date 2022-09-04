import { LoadMessage, LoadResponse, LoginResponse, QueryMessage, QueryResponse, SaveMessage } from "./messages";

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
    post(path: string, body: {}, timeoutSeconds: number): Promise<HttpResponse>;
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

    async query(query: QueryMessage) {
        return <QueryResponse> await this.postWithLimitedRetry('/query', query);
    }

    async save(save: SaveMessage) {
        await this.postWithInfiniteRetry('/save', save);
    }

    async load(load: LoadMessage) {
        return <LoadResponse> await this.postWithLimitedRetry('/load', load);
    }

    private async postWithLimitedRetry(path: string, body: {}) {
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
                await delay(retrySeconds + Math.random());
                timeoutSeconds = Math.min(timeoutSeconds * 2, 60);
                retrySeconds = retrySeconds * 2;
                if (retrySeconds >= 8) {
                    throw new Error(response.error);
                }
            }
        }
    }

    private async postWithInfiniteRetry(path: string, body: {}) {
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
                await delay(retrySeconds + Math.random());
                timeoutSeconds = Math.min(timeoutSeconds * 2, 60);
                retrySeconds = Math.min(retrySeconds * 2, 60);
            }
        }
    }
}