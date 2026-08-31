import { serializeSave } from "../fork/serialize";
import { FactEnvelope } from "../storage";
import { Trace } from "../util/trace";
import { ContentTypeGraph, ContentTypeJson, ContentTypeText, PostAccept, PostContentType } from "./ContentType";
import { HttpError } from "./errors";
import { parseFeedsResponse } from "./messageParsers";
import { FeedResponse, FeedsResponse, LoadMessage, LoadResponse, LoginResponse } from "./messages";
import { serializeGraph } from "./serializer";

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
    /** HTTP status, when the connection knows it. See {@link httpError}. */
    statusCode?: number;
    /** Raw response body, preserved for callers that want to inspect it. */
    body?: unknown;
}

export interface HttpRetry {
    result: "retry";
    error: string
    /** HTTP status, when the connection knows it. See {@link httpError}. */
    statusCode?: number;
    /** Raw response body, preserved for callers that want to inspect it. */
    body?: unknown;
}

export type HttpResponse = HttpSuccess | HttpFailure | HttpRetry;

export interface HttpConnection {
    get(path: string): Promise<{}>;
    getStream(path: string, onResponse: (response: {}) => Promise<void>, onError: (err: Error) => void, feedRefreshIntervalSeconds: number): () => void;
    post(path: string, contentType: PostContentType, accept: PostAccept, body: string, timeoutSeconds: number): Promise<HttpResponse>;
    getAcceptedContentTypes(path: string): Promise<string[]>;
}

/**
 * Build the error to throw for a failed response. A connection that reports the
 * status gets the richer `HttpError`, so callers can read `statusCode` and the
 * raw `body` (issue #234); the status is optional on `HttpFailure`/`HttpRetry`,
 * so a third-party `HttpConnection` that omits it still gets a plain `Error`.
 */
function httpError(response: HttpFailure | HttpRetry): Error {
    return response.statusCode === undefined
        ? new Error(response.error)
        : new HttpError(response.error, response.statusCode, response.body);
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
    private saveContentTypes: string[] | null = null;

    constructor(
        private httpConnection: HttpConnection,
        private syncStatusNotifier: SyncStatusNotifier,
        private config: WebClientConfig) {
    }

    async login() {
        return <LoginResponse> await this.httpConnection.get('/login');
    }

    /**
     * Publish a sync status to whoever registered through `j.onSyncStatus`.
     * The notifier has been held here since the client was written but never
     * fired, so the public handler could never observe anything. The save
     * queue uses it to report that it is not draining (issue #245).
     */
    notifySyncStatus(status: SyncStatus) {
        this.syncStatusNotifier.notify(status);
    }

    async save(envelopes: FactEnvelope[]) {
        if (this.saveContentTypes === null) {
            this.saveContentTypes = await this.httpConnection.getAcceptedContentTypes('/save');
        }

        if (this.saveContentTypes.includes(ContentTypeGraph)) {
            await this.post('/save', ContentTypeGraph, undefined, serializeGraph(envelopes));
        } else {
            await this.post('/save', ContentTypeJson, ContentTypeJson, JSON.stringify(serializeSave(envelopes)));
        }
    }

    async saveWithRetry(envelopes: FactEnvelope[]) {
        if (this.saveContentTypes === null) {
            this.saveContentTypes = await this.httpConnection.getAcceptedContentTypes('/save');
        }

        if (this.saveContentTypes.includes(ContentTypeGraph)) {
            await this.postWithLimitedRetry('/save', ContentTypeGraph, undefined, serializeGraph(envelopes));
        } else {
            await this.postWithLimitedRetry('/save', ContentTypeJson, ContentTypeJson, JSON.stringify(serializeSave(envelopes)));
        }
    }

    async load(load: LoadMessage) {
        return <LoadResponse> await this.post('/load', ContentTypeJson, ContentTypeJson, JSON.stringify(load));
    }

    async loadWithRetry(load: LoadMessage) {
        return <LoadResponse> await this.postWithLimitedRetry('/load', ContentTypeJson, ContentTypeJson, JSON.stringify(load));
    }

    async feeds(request: string): Promise<FeedsResponse> {
        const response = await this.post('/feeds', ContentTypeText, ContentTypeJson, request);
        return parseFeedsResponse(response);
    }

    async feed(feed: string, bookmark: string): Promise<FeedResponse> {
        return <FeedResponse> await this.httpConnection.get(`/feeds/${feed}?b=${bookmark}`);
    }

    streamFeed(feed: string, bookmark: string, onResponse: (response: FeedResponse) => Promise<void>, onError: (err: Error) => void, feedRefreshIntervalSeconds: number): () => void {
        return this.httpConnection.getStream(`/feeds/${feed}?b=${bookmark}`, r => onResponse(r as FeedResponse), onError, feedRefreshIntervalSeconds);
    }

    private async post(path: string, contentType: PostContentType, accept: PostAccept, body: string) {
        const response = await this.httpConnection.post(path, contentType, accept, body, this.config.timeoutSeconds);
        if (response.result === 'success') {
            return response.response;
        }
        else {
            throw httpError(response);
        }
    }

    private async postWithLimitedRetry(path: string, contentType: PostContentType, accept: PostAccept, body: string) {
        let timeoutSeconds = this.config.timeoutSeconds;
        let retrySeconds = 1;

        while (true) {
            const response = await this.httpConnection.post(path, contentType, accept, body, this.config.timeoutSeconds);
            if (response.result === 'success') {
                return response.response;
            }
            else if (response.result === 'failure') {
                throw httpError(response);
            }
            else {
                if (retrySeconds <= 4) {
                    Trace.warn(`Retrying in ${retrySeconds} seconds: ${response.error}`);
                    await delay(retrySeconds + Math.random());
                    timeoutSeconds = Math.min(timeoutSeconds * 2, 60);
                    retrySeconds = retrySeconds * 2;
                }
                else {
                    throw httpError(response);
                }
            }
        }
    }
}
