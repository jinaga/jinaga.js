import { generateKeyPair, KeyPair, signFacts } from "../cryptography/key-pair";
import { computeHash } from "../fact/hash";
import { Fork } from "../fork/fork";
import { PersistentFork } from "../fork/persistent-fork";
import { ObservableSource, SpecificationListener } from "../observable/observable";
import { Observer, ObserverImpl, ResultAddedFunc } from "../observer/observer";
import { testSpecificationForCompliance } from "../purge/purgeCompliance";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactRecord, FactReference, ProjectedResult, Storage } from "../storage";
import { Trace } from "../util/trace";
import { Network, NetworkManager } from "./NetworkManager";
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
        private readonly purgeConditions: Specification[]
    ) {
        this.networkManager = new NetworkManager(network, store,
            factsAdded => this.factsAdded(factsAdded));

        this.purgeManager = new PurgeManager(store, purgeConditions);
    }

    addSpecificationListener(specification: Specification, onResult: (results: ProjectedResult[]) => Promise<void>): SpecificationListener {
        return this.observableSource.addSpecificationListener(specification, onResult);
    }

    removeSpecificationListener(listener: SpecificationListener): void {
        this.observableSource.removeSpecificationListener(listener);
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
        const saved = await this.store.save(envelopes);
        if (saved.length > 0) {
            Trace.counter("facts_saved", saved.length);
            await this.factsAdded(saved);
        }
        return saved;
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

    async fetch(start: FactReference[], specification: Specification) {
        this.purgeManager.checkCompliance(specification);
        await this.networkManager.fetch(start, specification);
    }

    async subscribe(start: FactReference[], specification: Specification) {
        this.purgeManager.checkCompliance(specification);
        return await this.networkManager.subscribe(start, specification);
    }

    unsubscribe(feeds: string[]) {
        this.networkManager.unsubscribe(feeds);
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

    startObserver<U>(references: FactReference[], specification: Specification, resultAdded: ResultAddedFunc<U>, keepAlive: boolean): Observer<U> {
        const observer = new ObserverImpl<U>(this, references, specification, resultAdded);
        observer.start(keepAlive);
        return observer;
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

