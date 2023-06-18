import { DistributionEngine } from "../distribution/distribution-engine";
import { computeObjectHash } from "../fact/hash";
import { FeedResponse } from "../http/messages";
import { Feed } from "../specification/feed";
import { buildFeeds } from "../specification/feed-builder";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactReference, factReferenceEquals, Storage } from "../storage";
import { Trace } from "../util/trace";

export interface Network {
    feeds(start: FactReference[], specification: Specification): Promise<string[]>;
    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse>;
    load(factReferences: FactReference[]): Promise<FactEnvelope[]>;

}

export class NetworkNoOp implements Network {
    feeds(start: FactReference[], specification: Specification): Promise<string[]> {
        return Promise.resolve([]);
    }

    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        return Promise.resolve({ references: [], bookmark });
    }

    load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve([]);
    }
}

type FeedByHash = {
    [hash: string]: {
        start: {
            factReference: FactReference,
            index: number
        }[],
        feed: Feed
    }
}

export class NetworkDistribution implements Network {
    private feedCache: FeedByHash = {};

    constructor(
        private readonly distributionEngine: DistributionEngine,
        private readonly user: FactReference | null
    ) { }

    feeds(start: FactReference[], specification: Specification): Promise<string[]> {
        const feeds = buildFeeds(specification);
        const feedsByHash = feeds.reduce((map, feed) => {
            const indexedStart = feed.inputs.map(input => ({
                factReference: start[input.inputIndex],
                index: input.inputIndex
            }));
            const feedObject = {
                start: indexedStart,
                feed
            };
            const hash = computeObjectHash(feedObject);
            return ({
                ...map,
                [hash]: feedObject
            });
        }, {} as FeedByHash);
        const feedHashes = Object.keys(feedsByHash);
        this.feedCache = {
            ...this.feedCache,
            ...feedsByHash
        };
        return Promise.resolve(feedHashes);
    }

    async fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        const feedObject = this.feedCache[feed];
        if (!feedObject) {
            throw new Error(`Feed ${feed} not found`);
        }
        const start = feedObject.start.reduce((start, input) => {
            start[input.index] = input.factReference;
            return start;
        }, [] as FactReference[]);
        const canDistribute = await this.distributionEngine.canDistribute(feedObject.feed, start, this.user);

        if (!canDistribute) {
            throw new Error(`Feed ${feed} not authorized`);
        }

        // Pretend that we are at the end of the feed.
        return {
            references: [],
            bookmark
        };
    }

    load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve([]);
    }
}

class LoadBatch {
    private readonly factReferences: FactReference[] = [];
    private started = false;
    public readonly completed: Promise<void>;
    private resolve: (() => void) | undefined;
    private reject: ((reason: any) => void) | undefined;
    private timeout: NodeJS.Timeout;

    constructor(
        private readonly network: Network,
        private readonly store: Storage,
        private readonly notifyFactsAdded: (factsAdded: FactEnvelope[]) => Promise<void>,
        private readonly onRun: () => void
    ) {
        this.completed = new Promise<void>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
        this.timeout = setTimeout(() => {
            Trace.info('Trigger batch on timeout');
            this.run();
            this.onRun();
        }, 100);
    }

    add(factReferences: FactReference[]) {
        for (const fr of factReferences) {
            if (!this.factReferences.some(factReferenceEquals(fr))) {
                this.factReferences.push(fr);
            }
        }
    }

    trigger() {
        clearTimeout(this.timeout);
        this.run();
        this.onRun();
    }

    private run() {
        if (!this.started) {
            this.load()
                .then(this.resolve)
                .catch(this.reject);
            this.started = true;
        }
    }

    private async load() {
        const graph: FactEnvelope[] = await this.network.load(this.factReferences);

        const factsAdded = await this.store.save(graph);

        await this.notifyFactsAdded(factsAdded);
    }
}

export class NetworkManager {
    private activeFeeds = new Map<string, Promise<void>>();
    private fectchCount = 0;
    private currentBatch: LoadBatch | null = null;

    constructor(
        private readonly network: Network,
        private readonly store: Storage,
        private readonly notifyFactsAdded: (factsAdded: FactEnvelope[]) => Promise<void>
    ) { }

    async fetch(start: FactReference[], specification: Specification) {
        const feeds: string[] = await this.network.feeds(start, specification);

        // Fork to fetch from each feed.
        const promises = feeds.map(feed => {
            if (this.activeFeeds.has(feed)) {
                return this.activeFeeds.get(feed);
            }
            else {
                const promise = this.processFeed(feed);
                this.activeFeeds.set(feed, promise);
                return promise;
            }
        });
        await Promise.all(promises);
    }

    private async processFeed(feed: string) {
        let bookmark: string = await this.store.loadBookmark(feed);

        while (true) {
            this.fectchCount++;
            Trace.metric('Fetch begin', { fectchCount: this.fectchCount });
            let decremented = false;
            try {
                const { references: factReferences, bookmark: nextBookmark } = await this.network.fetchFeed(feed, bookmark);

                if (factReferences.length === 0) {
                    Trace.info('End of feed');
                    break;
                }

                const knownFactReferences: FactReference[] = await this.store.whichExist(factReferences);
                const unknownFactReferences: FactReference[] = factReferences.filter(fr => !knownFactReferences.includes(fr));
                if (unknownFactReferences.length > 0) {
                    let batch = this.currentBatch;
                    if (batch === null) {
                        // Begin a new batch.
                        Trace.info('Begin batch');
                        batch = new LoadBatch(this.network, this.store, this.notifyFactsAdded, () => {
                            if (this.currentBatch === batch) {
                                this.currentBatch = null;
                            }
                        });
                        this.currentBatch = batch;
                    }
                    batch.add(unknownFactReferences);
                    this.fectchCount--;
                    Trace.metric('Fetch end', { fectchCount: this.fectchCount });
                    decremented = true;
                    if (this.fectchCount === 0) {
                        // This is the last fetch, so trigger the batch.
                        Trace.info('Trigger batch on last fetch');
                        batch.trigger();
                    }
                    await batch.completed;
                }

                bookmark = nextBookmark;
                await this.store.saveBookmark(feed, bookmark);
            }
            finally {
                if (!decremented) {
                    this.fectchCount--;
                    Trace.metric('Fetch aborted', { fectchCount: this.fectchCount });
                    if (this.fectchCount === 0 && this.currentBatch !== null) {
                        // This is the last fetch, so trigger the batch.
                        Trace.info('Trigger batch on last fetch');
                        this.currentBatch.trigger();
                    }
                }
            }
        }

        this.activeFeeds.delete(feed);
    }
}
