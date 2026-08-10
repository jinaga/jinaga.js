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
     * Whether `load` can return facts that are not already in the local store
     * (issue #232). A purely local implementation always returns an empty
     * graph, so nothing it does can ever materialize an absent given; an
     * absent given is therefore terminal rather than pending.
     *
     * Required rather than optional on purpose: an optional flag would have
     * three states for a two-state property, with `undefined` meaning the same
     * thing as `true`, and it would leave a genuinely remote implementation
     * correct by accident instead of by declaration.
     */
    readonly canLoad: boolean;

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
    // Nothing behind this network, so `load` can never supply a missing fact.
    readonly canLoad = false;

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
    // Evaluates distribution rules in process against the local store. It
    // produces real feed hashes, but `fetchFeed` reports end-of-feed and
    // `load` returns nothing, so it can never supply a missing fact either.
    readonly canLoad = false;

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

/**
 * The outcome of a one-shot `fetch` (issue #232). Carries the per-feed
 * distribution decisions of issue #207 alongside the single derived answer to
 * "could this fetch have supplied a fact the local store is missing?".
 */
export interface FetchOutcome {
    decisions: FeedDecision[];
    /**
     * True when a source capable of supplying facts absent from the local store
     * was consulted for this specification and answered. False means nothing
     * could have backfilled a missing given, so an absent given is terminal
     * rather than pending.
     *
     * A denial counts as an answer: the replicator was asked and refused, which
     * explains the empty result without implying anything about whether the
     * given exists.
     *
     * When this is true and a given is still absent, the replicator evaluated
     * the specification server-side from that given and reported what matches.
     * That answer stands whether or not the given is locally resident, so an
     * empty result is authoritative and no diagnostic is warranted.
     */
    remoteConsulted: boolean;
}

/**
 * The outcome of a keep-alive `subscribe`. Adds the feed hashes the caller
 * needs for its unsubscribe bookkeeping to the same information `fetch` returns.
 */
export interface SubscribeOutcome extends CachedFeeds {
    remoteConsulted: boolean;
}

export class NetworkManager {
    private readonly feedsCache = new Map<string, CachedFeeds>();
    private readonly activeFeeds = new Map<string, Promise<void>>();
    private fetchCount = 0;
    private currentBatch: LoadBatch | null = null;
    private subscribers: Map<string, Subscriber> = new Map();
    private readonly feedRefreshIntervalSeconds: number;
    // Per-feed "began delivering data" signal (issue #207 W9). `feedsDelivered`
    // remembers feeds that have delivered at least one fact so a late listener
    // fires immediately; `feedDataListeners` holds observers waiting to clear a
    // reactive diagnostic when the feed's race resolves.
    private readonly feedsDelivered = new Set<string>();
    private readonly feedDataListeners = new Map<string, Set<() => void>>();

    constructor(
        private readonly network: Network,
        private readonly store: Storage,
        private readonly notifyFactsAdded: (factsAdded: FactEnvelope[]) => Promise<void>,
        feedRefreshIntervalSeconds?: number
    ) {
        this.feedRefreshIntervalSeconds = feedRefreshIntervalSeconds || 90; // Default to 90 seconds
    }

    /**
     * Register a listener fired the first time `feed` delivers data (issue #207
     * W9). If the feed has already delivered, the listener fires immediately.
     * Returns an unregister function. The observer uses this to clear a
     * `reactive` diagnostic once the subscription race resolves.
     */
    onFeedData(feed: string, listener: () => void): () => void {
        if (this.feedsDelivered.has(feed)) {
            // Already delivered — fire immediately (isolated) and don't retain.
            try { listener(); } catch (e) { Trace.error(e); }
            return () => { };
        }
        let listeners = this.feedDataListeners.get(feed);
        if (!listeners) {
            listeners = new Set();
            this.feedDataListeners.set(feed, listeners);
        }
        listeners.add(listener);
        return () => {
            const set = this.feedDataListeners.get(feed);
            if (set) {
                set.delete(listener);
                if (set.size === 0) this.feedDataListeners.delete(feed);
            }
        };
    }

    // Called when a feed's subscriber saves new facts. Fires waiting listeners
    // once, on the first delivery for that feed.
    private handleFeedData(feed: string) {
        if (this.feedsDelivered.has(feed)) {
            return;
        }
        this.feedsDelivered.add(feed);
        const listeners = this.feedDataListeners.get(feed);
        if (listeners) {
            this.feedDataListeners.delete(feed);
            for (const listener of listeners) {
                try { listener(); } catch (e) { Trace.error(e); }
            }
        }
    }

    /**
     * Fetch all feeds for a specification and return the replicator's per-feed
     * distribution decisions correlated to this exact fetch (issue #207 W4),
     * alongside whether a source capable of supplying absent facts was actually
     * consulted (issue #232).
     *
     * `remoteConsulted` is derived here rather than at the call sites because
     * this is the only place holding all three terms it depends on. Callers get
     * one boolean instead of recombining the same formula in `query`,
     * `queryWithDiagnostics`, and the observer.
     */
    async fetch(start: FactReference[], specification: Specification): Promise<FetchOutcome> {
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
        // Reaching here means the feed request and every feed fetch completed:
        // the catch above rethrows otherwise, so completion needs no flag of
        // its own — a caller never sees `remoteConsulted` from a failed fetch.
        //
        // Deliberately not conditioned on the number of feeds. A replicator
        // that denies the specification reports the decision and returns no
        // feed to fetch, and one that has nothing to send returns an empty
        // feed; in both cases it was asked about this specification and
        // answered. Requiring a non-empty feed list would report a missing
        // given on top of a denial, which is noise at best and wrong at worst,
        // since a denial says nothing about whether the given exists.
        return {
            decisions,
            remoteConsulted: this.network.canLoad
        };
    }

    async intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
        if (this.network.intersectForSubscribe) {
            return await this.network.intersectForSubscribe(start, specification);
        }
        return [{ start, specification }];
    }

    async subscribe(start: FactReference[], specification: Specification): Promise<SubscribeOutcome> {
        const reducedSpecification = reduceSpecification(specification);
        const { feeds, decisions } = await this.getFeedsFromCache(start, reducedSpecification);

        const subscribers = feeds.map(feed => {
            let subscriber = this.subscribers.get(feed);
            if (!subscriber) {
                // Wrap notifyFactsAdded so this feed's "began delivering data"
                // signal fires after facts are saved (issue #207 W9), letting a
                // reactive diagnostic clear when the race resolves. Only signal
                // when facts actually arrived: the subscriber calls
                // notifyFactsAdded even for an empty graph (references present
                // but load() returned nothing), which must not count as delivery.
                const notify = async (envelopes: FactEnvelope[]) => {
                    await this.notifyFactsAdded(envelopes);
                    if (envelopes.length > 0) {
                        this.handleFeedData(feed);
                    }
                };
                subscriber = new Subscriber(feed, this.network, this.store, notify, this.feedRefreshIntervalSeconds);
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
        // Return the feed hashes alongside the per-feed decisions so the observer
        // can surface diagnostics (issue #207 W5/W6) while still using `feeds`
        // for its keep-alive/unsubscribe bookkeeping. `remoteConsulted` is
        // derived on the same terms as in `fetch` (issue #232).
        return {
            feeds,
            decisions,
            remoteConsulted: this.network.canLoad
        };
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