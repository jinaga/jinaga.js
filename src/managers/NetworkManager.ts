import { DistributionEngine } from "../distribution/distribution-engine";
import { FeedResponse } from "../http/messages";
import { Subscriber } from "../observer/subscriber";
import { describeDeclaration, describeSpecification } from "../specification/description";
import { buildFeeds } from "../specification/feed-builder";
import { FeedCache } from "../specification/feed-cache";
import { Specification, reduceSpecification } from "../specification/specification";
import { FactEnvelope, FactReference, ReferencesByName, Storage, factReferenceEquals } from "../storage";
import { computeStringHash } from "../util/encoding";
import { Trace } from "../util/trace";

export interface Network {
    feeds(start: FactReference[], specification: Specification): Promise<string[]>;
    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse>;
    streamFeed(feed: string, bookmark: string, onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>, onError: (err: Error) => void, feedRefreshIntervalSeconds?: number): () => void;
    load(factReferences: FactReference[]): Promise<FactEnvelope[]>;

}

export class NetworkNoOp implements Network {
    feeds(start: FactReference[], specification: Specification): Promise<string[]> {
        return Promise.resolve([]);
    }

    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        return Promise.resolve({ references: [], bookmark });
    }

    streamFeed(feed: string, bookmark: string, onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>, onError: (err: Error) => void, feedRefreshIntervalSeconds?: number): () => void {
        // Do nothing.
        return () => { };
    }

    load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve([]);
    }
}

export class NetworkDistribution implements Network {
    private feedCache = new FeedCache();

    constructor(
        private readonly distributionEngine: DistributionEngine,
        private readonly user: FactReference | null
    ) { }

    async feeds(start: FactReference[], specification: Specification): Promise<string[]> {
        const feeds = buildFeeds(specification);
        const namedStart = specification.given.reduce((map, given, index) => ({
            ...map,
            [given.label.name]: start[index]
        }), {} as ReferencesByName);
        const canDistribute = await this.distributionEngine.canDistributeToAll(feeds, namedStart, this.user);
        if (canDistribute.type === 'failure') {
            throw new Error(`Not authorized: ${canDistribute.reason}`);
        }
        return this.feedCache.addFeeds(feeds, namedStart);
    }

    async fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        const feedObject = this.feedCache.getFeed(feed);
        if (!feedObject) {
            throw new Error(`Feed ${feed} not found`);
        }
        const canDistribute = await this.distributionEngine.canDistributeToAll([feedObject.feed], feedObject.namedStart, this.user);

        if (canDistribute.type === 'failure') {
            throw new Error(`Not authorized: ${canDistribute.reason}`);
        }

        // Pretend that we are at the end of the feed.
        return {
            references: [],
            bookmark
        };
    }

    streamFeed(feed: string, bookmark: string, onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>, onError: (err: Error) => void, feedRefreshIntervalSeconds?: number): () => void {
        const feedObject = this.feedCache.getFeed(feed);
        if (!feedObject) {
            onError(new Error(`Feed ${feed} not found`));
            return () => { };
        }
        this.distributionEngine.canDistributeToAll([feedObject.feed], feedObject.namedStart, this.user)
            .then(canDistribute => {
                if (canDistribute.type === 'failure') {
                    onError(new Error(`Not authorized: ${canDistribute.reason}`));
                    return;
                }
                // Pretend that we are at the end of the feed.
                onResponse([], bookmark);
            })
            .catch(err => {
                onError(err);
            });
        return () => { };
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
        if (factsAdded.length > 0) {
            Trace.counter("facts_saved", factsAdded.length);
            await this.notifyFactsAdded(factsAdded);
        }
    }
}

export class NetworkManager {
    private readonly feedsCache = new Map<string, string[]>();
    private readonly activeFeeds = new Map<string, Promise<void>>();
    private fetchCount = 0;
    private currentBatch: LoadBatch | null = null;
    private subscribers: Map<string, Subscriber> = new Map();
    private readonly feedRefreshIntervalSeconds: number;

    constructor(
        private readonly network: Network,
        private readonly store: Storage,
        private readonly notifyFactsAdded: (factsAdded: FactEnvelope[]) => Promise<void>,
        feedRefreshIntervalSeconds?: number
    ) { 
        this.feedRefreshIntervalSeconds = feedRefreshIntervalSeconds || 4 * 60; // Default to 4 minutes
    }

    async fetch(start: FactReference[], specification: Specification) {
        const reducedSpecification = reduceSpecification(specification);
        const feeds: string[] = await this.getFeedsFromCache(start, reducedSpecification);

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
        try {
            await Promise.all(promises);
        }
        catch (e) {
            // If any feed fails, then remove the specification from the cache.
            this.removeFeedsFromCache(start, reducedSpecification);
            throw e;
        }
    }

    async subscribe(start: FactReference[], specification: Specification): Promise<string[]> {
        const reducedSpecification = reduceSpecification(specification);
        const feeds: string[] = await this.getFeedsFromCache(start, reducedSpecification);

        const subscribers = feeds.map(feed => {
            let subscriber = this.subscribers.get(feed);
            if (!subscriber) {
                subscriber = new Subscriber(feed, this.network, this.store, this.notifyFactsAdded, this.feedRefreshIntervalSeconds);
                this.subscribers.set(feed, subscriber);
            }
            return subscriber;
        });
        const promises = subscribers.map(async subscriber => {
            if (subscriber.addRef()) {
                await subscriber.start();
            }
        });

        try {
            await Promise.all(promises);
        }
        catch (e) {
            // If any feed fails, then remove the specification from the cache.
            this.removeFeedsFromCache(start, reducedSpecification);
            this.unsubscribe(feeds);
            throw e;
        }
        return feeds;
    }

    unsubscribe(feeds: string[]) {
        for (const feed of feeds) {
            const subscriber = this.subscribers.get(feed);
            if (!subscriber) {
                throw new Error(`Subscriber not found for feed ${feed}`);
            }
            if (subscriber.release()) {
                subscriber.stop();
                this.subscribers.delete(feed);
            }
        }
    }

    private async getFeedsFromCache(start: FactReference[], specification: Specification): Promise<string[]> {
        const hash = getSpecificationHash(start, specification);
        const cached = this.feedsCache.get(hash);
        if (cached) {
            return cached;
        }
        const feeds = await this.network.feeds(start, specification);
        this.feedsCache.set(hash, feeds);
        return feeds;
    }

    private removeFeedsFromCache(start: FactReference[], specification: Specification) {
        const hash = getSpecificationHash(start, specification);
        this.feedsCache.delete(hash);
    }

    private async processFeed(feed: string) {
        let bookmark = await this.store.loadBookmark(feed);

        while (true) {
            this.fetchCount++;
            let decremented = false;
            try {
                const { references: factReferences, bookmark: nextBookmark } = await this.network.fetchFeed(feed, bookmark);

                if (factReferences.length === 0) {
                    break;
                }

                const knownFactReferences: FactReference[] = await this.store.whichExist(factReferences);
                const unknownFactReferences: FactReference[] = factReferences.filter(fr => !knownFactReferences.includes(fr));
                if (unknownFactReferences.length > 0) {
                    let batch = this.currentBatch;
                    if (batch === null) {
                        // Begin a new batch.
                        batch = new LoadBatch(this.network, this.store, this.notifyFactsAdded, () => {
                            if (this.currentBatch === batch) {
                                this.currentBatch = null;
                            }
                        });
                        this.currentBatch = batch;
                    }
                    batch.add(unknownFactReferences);
                    this.fetchCount--;
                    decremented = true;
                    if (this.fetchCount === 0) {
                        // This is the last fetch, so trigger the batch.
                        batch.trigger();
                    }
                    await batch.completed;
                }

                bookmark = nextBookmark;
                await this.store.saveBookmark(feed, bookmark);
            }
            finally {
                if (!decremented) {
                    this.fetchCount--;
                    if (this.fetchCount === 0 && this.currentBatch !== null) {
                        // This is the last fetch, so trigger the batch.
                        this.currentBatch.trigger();
                    }
                }
            }
        }

        this.activeFeeds.delete(feed);
    }
}

function getSpecificationHash(start: FactReference[], specification: Specification) {
    const declarationString = describeDeclaration(start, specification.given.map(g => g.label));
    const specificationString = describeSpecification(specification, 0);
    const request = `${declarationString}\n${specificationString}`;
    const hash = computeStringHash(request);
    return hash;
}