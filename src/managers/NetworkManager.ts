import { DistributionEngine, DistributionIntersectionBranch } from "../distribution/distribution-engine";
import { FeedDecision, FeedResponse, FeedsResponse } from "../http/messages";
import { Subscriber } from "../observer/subscriber";
import { describeDeclaration, describeSpecification } from "../specification/description";
import { buildFeeds } from "../specification/feed-builder";
import { FeedCache } from "../specification/feed-cache";
import { Specification, reduceSpecification } from "../specification/specification";
import { FactEnvelope, FactReference, ReferencesByName, Storage, factReferenceEquals } from "../storage";
import { computeStringHash } from "../util/encoding";
import { Trace } from "../util/trace";

export interface Network {
    /**
     * Request the feed hashes for a specification from the replicator's
     * `POST /feeds`. The response carries the feed hashes and, from
     * replicator 3.7.0 onward, the per-feed distribution `decisions`
     * (issue #207). Old replicators omit `decisions`, which degrades
     * gracefully to no diagnostics.
     */
    feeds(start: FactReference[], specification: Specification): Promise<FeedsResponse>;
    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse>;
    streamFeed(feed: string, bookmark: string, onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>, onError: (err: Error) => void, feedRefreshIntervalSeconds: number): () => void;
    load(factReferences: FactReference[]): Promise<FactEnvelope[]>;

    /**
     * Phase 3 hook for j.subscribe authorization-as-spec. Returns one or more
     * `(start, specification)` branches so that subscribing to an
     * initially-forbidden feed succeeds and pushes results when an
     * authorizing fact later arrives. Multiple branches express OR
     * semantics across distribution rules. Implementations without
     * distribution rules should return the inputs unchanged in a single
     * branch.
     */
    intersectForSubscribe?(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]>;
}

export class NetworkNoOp implements Network {
    feeds(start: FactReference[], specification: Specification): Promise<FeedsResponse> {
        return Promise.resolve({ feeds: [] });
    }

    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        return Promise.resolve({ references: [], bookmark });
    }

    streamFeed(feed: string, bookmark: string, onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>, onError: (err: Error) => void, feedRefreshIntervalSeconds: number): () => void {
        // Do nothing.
        return () => { };
    }

    load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve([]);
    }

    async intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
        return [{ start, specification }];
    }
}

export class NetworkDistribution implements Network {
    private feedCache = new FeedCache();
    // Feed hashes this instance produced via Phase 3 intersection. Used as
    // an unforgeable bypass token for the authorization check on those
    // feeds: an intersected spec already encodes the auth pattern, and its
    // augmented skeleton doesn't match any distribution rule, so a normal
    // `canDistributeToAll` would reject it. The hashes are recorded only
    // by `intersectForSubscribe` (computed from feeds the engine itself
    // produced), so a caller can't spoof the bypass by crafting a spec
    // with a `distributionUser` given.
    private readonly intersectedFeeds = new Set<string>();

    constructor(
        private readonly distributionEngine: DistributionEngine,
        private readonly user: FactReference | null
    ) { }

    async feeds(start: FactReference[], specification: Specification): Promise<FeedsResponse> {
        const feeds = buildFeeds(specification);
        const namedStart = specification.given.reduce((map, given, index) => ({
            ...map,
            [given.label.name]: start[index]
        }), {} as ReferencesByName);
        // Compute feed hashes upfront so we can recognize feeds the engine
        // produced earlier via intersection (whose hashes we've cached) and
        // skip the auth check just for those. A caller-supplied spec that
        // happens to look intersected won't produce matching hashes unless
        // its content equals one we actually generated.
        const feedHashes = this.feedCache.addFeeds(feeds, namedStart);
        const allFromIntersection = feedHashes.length > 0
            && feedHashes.every(h => this.intersectedFeeds.has(h));
        if (!allFromIntersection) {
            const canDistribute = await this.distributionEngine.canDistributeToAll(feeds, namedStart, this.user);
            if (canDistribute.type === 'failure') {
                throw new Error(`Not authorized: ${canDistribute.reason}`);
            }
        }
        // The in-process engine either authorizes (returns the feed hashes) or
        // throws above; it does not surface per-feed decisions. Diagnostics
        // originate from the real replicator's `POST /feeds` response.
        return { feeds: feedHashes };
    }

    async fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        const feedObject = this.feedCache.getFeed(feed);
        if (!feedObject) {
            throw new Error(`Feed ${feed} not found`);
        }
        if (!this.intersectedFeeds.has(feed)) {
            const canDistribute = await this.distributionEngine.canDistributeToAll([feedObject.feed], feedObject.namedStart, this.user);
            if (canDistribute.type === 'failure') {
                throw new Error(`Not authorized: ${canDistribute.reason}`);
            }
        }

        // Pretend that we are at the end of the feed.
        return {
            references: [],
            bookmark
        };
    }

    streamFeed(feed: string, bookmark: string, onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>, onError: (err: Error) => void, feedRefreshIntervalSeconds: number): () => void {
        const feedObject = this.feedCache.getFeed(feed);
        if (!feedObject) {
            onError(new Error(`Feed ${feed} not found`));
            return () => { };
        }
        if (this.intersectedFeeds.has(feed)) {
            onResponse([], bookmark);
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

    async intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
        const result = await this.distributionEngine.intersectForSubscribe(start, specification, this.user);
        if (result.intersected) {
            // Pre-compute feed hashes from each intersected branch and
            // remember them. When the observer later calls `feeds` (after
            // `reduceSpecification` reshapes the spec into a fresh object),
            // we recognize the produced hashes and skip auth — without
            // trusting the spec's structure as a marker.
            for (const branch of result.branches) {
                const reducedIntersected = reduceSpecification(branch.specification);
                const namedStart = reducedIntersected.given.reduce((map, given, index) => ({
                    ...map,
                    [given.label.name]: branch.start[index]
                }), {} as ReferencesByName);
                const producedFeeds = buildFeeds(reducedIntersected);
                const producedHashes = this.feedCache.addFeeds(producedFeeds, namedStart);
                for (const h of producedHashes) this.intersectedFeeds.add(h);
            }
        }
        return result.branches;
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

/**
 * The feed hashes for a specification together with the replicator's per-feed
 * distribution decisions (issue #207 W4). `decisions` is empty when the
 * replicator does not report them (old replicators), which makes every
 * downstream diagnostic channel inert. This is the single choke point the
 * instance hook (W5), the observer (W6), and `queryWithDiagnostics` (W8b) all
 * draw from.
 *
 * Both fields are cached under the same specification key. Feed hashes are
 * deterministic in the specification, but decisions depend on the requester's
 * authorization state and can change over time — most notably a `reactive`
 * feed becoming `authorized` once the authorizing fact arrives. Caching the
 * decision keeps a non-self-healing denial (`denied`) reported on repeated
 * calls, which is correct; the only staleness is a `reactive` decision that
 * should stop being reported once data begins to flow. Clearing a diagnostic
 * on that transition is W9's responsibility (re-emit only on transition; fire
 * a clearing diagnostic when a `reactive`/`denied` feed starts delivering),
 * which is deferred to a later tranche. Within a single `queryWithDiagnostics`
 * call the decisions are correlated to that fetch's specification and start.
 */
export interface CachedFeeds {
    feeds: string[];
    decisions: FeedDecision[];
}

export class NetworkManager {
    private readonly feedsCache = new Map<string, CachedFeeds>();
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
        this.feedRefreshIntervalSeconds = feedRefreshIntervalSeconds || 90; // Default to 90 seconds
    }

    /**
     * Fetch all feeds for a specification and return the replicator's per-feed
     * distribution decisions correlated to this exact fetch (issue #207 W4).
     * Callers that don't need diagnostics (plain `query`/`watch`) ignore the
     * return value; `queryWithDiagnostics` (W8b) maps it to diagnostics.
     */
    async fetch(start: FactReference[], specification: Specification): Promise<FeedDecision[]> {
        const reducedSpecification = reduceSpecification(specification);
        const { feeds, decisions } = await this.getFeedsFromCache(start, reducedSpecification);

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
        return decisions;
    }

    async intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
        if (this.network.intersectForSubscribe) {
            return await this.network.intersectForSubscribe(start, specification);
        }
        return [{ start, specification }];
    }

    async subscribe(start: FactReference[], specification: Specification): Promise<string[]> {
        const reducedSpecification = reduceSpecification(specification);
        const { feeds } = await this.getFeedsFromCache(start, reducedSpecification);

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

    private async getFeedsFromCache(start: FactReference[], specification: Specification): Promise<CachedFeeds> {
        const hash = getSpecificationHash(start, specification);
        const cached = this.feedsCache.get(hash);
        if (cached) {
            return cached;
        }
        const response = await this.network.feeds(start, specification);
        // Old replicators omit `decisions`; normalize to an empty array so every
        // downstream diagnostic channel is simply inert rather than undefined.
        const cachedFeeds: CachedFeeds = {
            feeds: response.feeds,
            decisions: response.decisions ?? []
        };
        this.feedsCache.set(hash, cachedFeeds);
        return cachedFeeds;
    }

    private removeFeedsFromCache(start: FactReference[], specification: Specification) {
        const hash = getSpecificationHash(start, specification);
        this.feedsCache.delete(hash);
    }

    private async processFeed(feed: string) {
        try {
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
        }
        finally {
            this.activeFeeds.delete(feed);
        }
    }
}

function getSpecificationHash(start: FactReference[], specification: Specification) {
    const declarationString = describeDeclaration(start, specification.given.map(g => g.label));
    const specificationString = describeSpecification(specification, 0);
    const request = `${declarationString}\n${specificationString}`;
    const hash = computeStringHash(request);
    return hash;
}