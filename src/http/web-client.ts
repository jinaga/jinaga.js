import { serializeSave } from "../fork/serialize";
import { FactEnvelope } from "../storage";
import { Trace } from "../util/trace";
import { ContentTypeGraph, ContentTypeJson, ContentTypeText, PostAccept, PostContentType } from "./ContentType";
import { HttpError } from "./errors";
import { parseFeedsResponse } from "./messageParsers";
import { FeedResponse, FeedsResponse, LoadMessage, LoadResponse, LoginResponse } from "./messages";
import { RetryOptions, RetrySchedule, RetryWaits, resolveRetrySchedule } from "./retry";
import { serializeGraph } from "./serializer";

export type SyncStatus = {
    sending: boolean;
    retrying: boolean;
    retryInSeconds: number;
    warning: string;
}

/**
 * Report that a request is about to wait before trying again, with the wait the
 * schedule just produced and the transient error that provoked it (issue #399).
 *
 * The call site supplies it rather than the retry loop deciding for itself.
 * `SyncStatus` describes outgoing facts, so a retried `POST /save` reports and a
 * retried `POST /load` reports nothing, and that is a property of the caller
 * rather than of the loop: passing the reporting in keeps the loop from
 * branching on the path it was handed.
 */
export type RetryReporter = (waitMs: number, error: string) => void;

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

function delay(timeMs: number): Promise<void> {
    return new Promise<void>(resolve => {
        setTimeout(resolve, timeMs);
    });
}

export interface WebClientConfig {
    timeoutSeconds: number;
    /**
     * How long a failed request waits before it is retried, and how long the
     * retrying may go on (issue #305). Defaults reproduce the schedule the
     * client used when it was fixed: four attempts over roughly seven seconds.
     */
    retry?: RetryOptions;
}

export class WebClient {
    private saveContentTypes: string[] | null = null;
    private readonly retrySchedule: RetrySchedule;

    constructor(
        private httpConnection: HttpConnection,
        private syncStatusNotifier: SyncStatusNotifier,
        private config: WebClientConfig) {
        this.retrySchedule = resolveRetrySchedule(config.retry);
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
            await this.postWithLimitedRetry('/save', ContentTypeGraph, undefined, serializeGraph(envelopes), this.reportSaveRetry);
        } else {
            await this.postWithLimitedRetry('/save', ContentTypeJson, ContentTypeJson, JSON.stringify(serializeSave(envelopes)), this.reportSaveRetry);
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

    /**
     * Publish each retry of a `POST /save` through the sync status, so a
     * consumer learns that the save is stalled while it still is rather than
     * once the schedule has run out (issue #399). An unreachable replicator
     * reaches the retry loop too -- `FetchConnection` reports a network error
     * and its own timeout as statuses the loop reads as transient -- so without
     * this the first a consumer heard of one was the stall warning, minutes
     * later, or never under an unbounded schedule.
     *
     * `retryInSeconds` is the wait the schedule just produced, carried here in
     * the milliseconds the loop is about to wait, rather than a second
     * calculation of the backoff beside the one that does the waiting
     * (Article 2).
     */
    private readonly reportSaveRetry: RetryReporter = (waitMs, error) => {
        this.notifySyncStatus({
            sending: true,
            retrying: true,
            retryInSeconds: waitMs / 1000,
            warning: error
        });
    };

    /**
     * Post, retrying a response the connection reported as transient. The
     * waits, and the point at which the retrying gives up, come from the
     * configured schedule rather than from constants here (issue #305).
     *
     * `onRetry`, where the caller supplies one, hears about each wait before it
     * is taken.
     */
    private async postWithLimitedRetry(path: string, contentType: PostContentType, accept: PostAccept, body: string, onRetry?: RetryReporter) {
        const waits = new RetryWaits(this.retrySchedule);

        while (true) {
            const response = await this.httpConnection.post(path, contentType, accept, body, this.config.timeoutSeconds);
            if (response.result === 'success') {
                return response.response;
            }
            else if (response.result === 'failure') {
                throw httpError(response);
            }
            else {
                const waitMs = waits.next();
                if (waitMs === null) {
                    throw httpError(response);
                }
                Trace.warn(`Retrying in ${waitMs / 1000} seconds: ${response.error}`);
                // Reported before the wait rather than after it. A report that
                // arrives once the wait has elapsed tells a consumer about a
                // delay it can no longer act on, and leaves `retryInSeconds`
                // naming a wait that is already over.
                if (onRetry) {
                    onRetry(waitMs, response.error);
                }
                await delay(waitMs);
            }
        }
    }
}
