import { DistributionEngine } from "../distribution/distribution-engine";
import { computeObjectHash } from "../fact/hash";
import { FeedResponse } from "../http/messages";
import { describeDeclaration, describeSpecification } from "../specification/description";
import { buildFeeds } from "../specification/feed-builder";
import { Skeleton, skeletonOfSpecification } from "../specification/skeleton";
import { Specification, reduceSpecification } from "../specification/specification";
import { FactEnvelope, FactReference, Storage, factReferenceEquals } from "../storage";
import { computeStringHash } from "../util/encoding";

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

interface FeedIdentifier {
    start: {
        factReference: FactReference,
        index: number
    }[],
    skeleton: Skeleton
}

interface FeedObject {
    start: {
        factReference: FactReference;
        index: number;
    }[];
    feed: Specification;
}

type FeedByHash = {
    [hash: string]: FeedObject
}

export class NetworkDistribution implements Network {
    private feedCache: FeedByHash = {};

    constructor(
        private readonly distributionEngine: DistributionEngine,
        private readonly user: FactReference | null
    ) { }

    async feeds(start: FactReference[], specification: Specification): Promise<string[]> {
        const feeds = buildFeeds(specification);
        const canDistribute = await this.distributionEngine.canDistributeToAll(feeds, start, this.user);
        if (canDistribute.type === 'failure') {
            throw new Error(`Not authorized: ${canDistribute.reason}`);
        }
        const feedsByHash = feeds.reduce((map, feed) => {
            const skeleton = skeletonOfSpecification(feed);
            const indexedStart = skeleton.inputs.map(input => ({
                factReference: start[input.inputIndex],
                index: input.inputIndex
            }));
            const feedIdentifier: FeedIdentifier = {
                start: indexedStart,
                skeleton
            };
            const feedObject: FeedObject = {
                start: indexedStart,
                feed
            };
            const hash = computeObjectHash(feedIdentifier);
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
        return feedHashes;
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
        const canDistribute = await this.distributionEngine.canDistributeToAll([feedObject.feed], start, this.user);

        if (canDistribute.type === 'failure') {
            throw new Error(`Not authorized: ${canDistribute.reason}`);
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
    private readonly feedsCache = new Map<string, string[]>();
    private readonly activeFeeds = new Map<string, Promise<void>>();
    private fectchCount = 0;
    private currentBatch: LoadBatch | null = null;

    constructor(
        private readonly network: Network,
        private readonly store: Storage,
        private readonly notifyFactsAdded: (factsAdded: FactEnvelope[]) => Promise<void>
    ) { }

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
        let bookmark: string = await this.store.loadBookmark(feed);

        while (true) {
            this.fectchCount++;
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
                    this.fectchCount--;
                    decremented = true;
                    if (this.fectchCount === 0) {
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
                    this.fectchCount--;
                    if (this.fectchCount === 0 && this.currentBatch !== null) {
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
    const declarationString = describeDeclaration(start, specification.given);
    const specificationString = describeSpecification(specification, 0);
    const request = `${declarationString}\n${specificationString}`;
    const hash = computeStringHash(request);
    return hash;
}