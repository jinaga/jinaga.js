import { generateKeyPair, KeyPair, signFacts } from "../cryptography/key-pair";
import { computeHash } from "../fact/hash";
import { Fork } from "../fork/fork";
import { PersistentFork } from "../fork/persistent-fork";
import { DistributionIntersectionBranch } from "../distribution/distribution-engine";
import { FeedDecision } from "../http/messages";
import { DistributionDiagnostic } from "./distributionDiagnostic";
import { InverseListener, ObservableSource, SpecificationListener } from "../observable/observable";
import { Observer, ObserverImpl, ResultAddedFunc } from "../observer/observer";
import { testSpecificationForCompliance } from "../purge/purgeCompliance";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactRecord, FactReference, ProjectedResult, Storage, saveAndNotify } from "../storage";
import { Trace } from "../util/trace";
import { CachedFeeds, Network, NetworkManager } from "./NetworkManager";
import { PurgeManager } from "./PurgeManager";

export class FactManager {
    private networkManager: NetworkManager;
    private purgeManager: PurgeManager;
    private singleUseKeyPair: KeyPair | null = null;

    constructor(
        private readonly fork: Fork,
        private readonly observableSource: ObservableSource,
        private readonly store: Storage,
        network: Network,
        private readonly purgeConditions: Specification[],
        feedRefreshIntervalSeconds?: number
    ) {
        this.networkManager = new NetworkManager(network, store,
            factsAdded => this.factsAdded(factsAdded), feedRefreshIntervalSeconds);

        this.purgeManager = new PurgeManager(store, purgeConditions);
    }

    addSpecificationListener(specification: Specification, onResult: (results: ProjectedResult[]) => Promise<void>): SpecificationListener {
        return this.observableSource.addSpecificationListener(specification, onResult);
    }

    removeSpecificationListener(listener: SpecificationListener): void {
        this.observableSource.removeSpecificationListener(listener);
    }

    addInverseListener(inverse: Specification, givenRefs: FactReference[], onResult: (results: ProjectedResult[]) => Promise<void>): InverseListener {
        return this.observableSource.addInverseListener(inverse, givenRefs, onResult);
    }

    removeInverseListener(listener: InverseListener): void {
        this.observableSource.removeInverseListener(listener);
    }

    async close(): Promise<void> {
        await this.fork.close();
        await this.store.close();
    }

    testSpecificationForCompliance(specification: Specification): string[] {
        return testSpecificationForCompliance(specification, this.purgeConditions);
    }

    async save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        // If we have a single-use key pair, sign the facts with it
        if (this.singleUseKeyPair) {
            envelopes = signFacts(this.singleUseKeyPair, envelopes.map(e => e.fact));
        }
        
        await this.fork.save(envelopes);
        return await saveAndNotify(this.store, envelopes, saved => this.factsAdded(saved));
    }

    /**
     * Begin a single-use session. Generates a key pair, creates a User fact with the public key,
     * signs it, and saves it to the store.
     * @returns A structure containing the user fact
     */
    async beginSingleUse(): Promise<{ graph: any, last: FactRecord }> {
        // Generate a key pair for the single-use principal
        const keyPair = generateKeyPair();
        
        // Create a User fact with the public key
        const fields = {
            publicKey: keyPair.publicPem
        };
        const predecessors = {};
        const hash = computeHash(fields, predecessors);
        
        const userFact: FactRecord = {
            hash,
            type: "Jinaga.User",
            fields,
            predecessors
        };
        
        // Sign the user fact with the key pair
        const signedEnvelopes = signFacts(keyPair, [userFact]);
        
        // Save the user fact
        await this.store.save(signedEnvelopes);
        
        // Store the key pair temporarily
        this.singleUseKeyPair = keyPair;
        
        // Return a structure containing the user fact
        return {
            graph: { facts: [userFact] },
            last: userFact
        };
    }

    /**
     * End a single-use session. Discards the private key.
     */
    endSingleUse(): void {
        // Discard the private key
        this.singleUseKeyPair = null;
    }

    async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        this.purgeManager.checkCompliance(specification);
        return await this.store.read(start, specification);
    }

    /**
     * Read a specification derived from one that has already been checked for
     * purge compliance.
     *
     * `testSpecificationForCompliance` examines a specification's own matches
     * and never descends into its projection, so a specification flattened out
     * of a nested collection -- the parent's matches followed by the
     * component's own -- presents matches that the specification it came from
     * never presented. Checking it again would fail for a purge condition the
     * original passed, so the caller that already checked the original reads
     * the derived form through here.
     */
    async readDerived(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        return await this.store.read(start, specification);
    }

    async fetch(start: FactReference[], specification: Specification): Promise<FeedDecision[]> {
        this.purgeManager.checkCompliance(specification);
        return await this.networkManager.fetch(start, specification);
    }

    /**
     * Hold the specification's feeds open. `feedTimeoutMs`, when given, bounds
     * the wait for the replicator's first response (issue #280).
     */
    async subscribe(start: FactReference[], specification: Specification, feedTimeoutMs?: number): Promise<CachedFeeds> {
        this.purgeManager.checkCompliance(specification);
        return await this.networkManager.subscribe(start, specification, feedTimeoutMs);
    }

    async intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
        return await this.networkManager.intersectForSubscribe(start, specification);
    }

    unsubscribe(feeds: string[]) {
        this.networkManager.unsubscribe(feeds);
    }

    /**
     * Register a listener fired when `feed` first delivers data (issue #207 W9),
     * so the observer can clear a `reactive` diagnostic once the race resolves.
     * Returns an unregister function.
     */
    onFeedData(feed: string, listener: () => void): () => void {
        return this.networkManager.onFeedData(feed, listener);
    }

    /**
     * Register a listener for the loading state (issue #306). Returns an
     * unregister function.
     */
    onLoading(listener: (loading: boolean) => void): () => void {
        return this.networkManager.onLoading(listener);
    }

    /**
     * Register a listener for a failed load (issue #306). Returns an unregister
     * function.
     */
    onLoadError(listener: (error: any) => void): () => void {
        return this.networkManager.onLoadError(listener);
    }

    /**
     * Register a listener for the number of facts waiting to be sent (issue
     * #306). Returns an unregister function.
     */
    onProgress(listener: (count: number) => void): () => void {
        return this.fork.onProgress(listener);
    }

    async load(references: FactReference[]): Promise<FactEnvelope[]> {
        const loaded = await this.fork.load(references);
        Trace.counter("facts_loaded", loaded.length);
        return loaded;
    }

    getMruDate(specificationHash: string): Promise<Date | null> {
        return this.store.getMruDate(specificationHash);
    }

    setMruDate(specificationHash: string, mruDate: Date): Promise<void> {
        return this.store.setMruDate(specificationHash, mruDate);
    }

    startObserver<U>(references: FactReference[], specification: Specification, resultAdded: ResultAddedFunc<U>, keepAlive: boolean, onDiagnostics?: (diagnostics: DistributionDiagnostic[]) => void): Observer<U> {
        const observer = new ObserverImpl<U>(this, references, specification, resultAdded, onDiagnostics);
        observer.start(keepAlive);
        return observer;
    }

    /**
     * Notify observers of facts that arrived from somewhere other than
     * `save` -- a WebSocket graph stream, for one -- and run the purge step
     * for them.
     *
     * The returned promise is the caller's ordering signal: await it before
     * reading the next batch, or that batch lands while this one is still
     * being notified.
     *
     * Nothing bounds how long it takes. The notification runs the caller's
     * own watch handlers, and `ObservableSource` abandons a wedged listener
     * only after `listenerTimeoutMs`, once per specification group. So a
     * handler that waits for a fact arriving on the same socket stalls that
     * socket for up to `listenerTimeoutMs` per group registered for the
     * fact's type. A source that awaits this promise is buying ordering at
     * that price, and a source that cannot afford the stall should not await
     * it.
     */
    notifyFactsAdded(envelopes: FactEnvelope[]): Promise<void> {
        return this.factsAdded(envelopes);
    }

    private async factsAdded(factsAdded: FactEnvelope[]): Promise<void> {
        await this.observableSource.notify(factsAdded);
        await this.purgeManager.triggerPurge(factsAdded);
    }

    async purge(): Promise<void> {
        await this.purgeManager.purge();
    }

    /**
     * Processes the queue immediately, bypassing any delay.
     * Only works if the fork is a PersistentFork.
     */
    async push(): Promise<void> {
        await this.fork.processQueueNow();
    }
}

