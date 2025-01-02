import { Fork } from "../fork/fork";
import { ObservableSource, SpecificationListener } from "../observable/observable";
import { Observer, ObserverImpl, ResultAddedFunc } from "../observer/observer";
import { testSpecificationForCompliance } from "../purge/purgeCompliance";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactReference, ProjectedResult, Storage } from "../storage";
import { Trace } from "../util/trace";
import { Network, NetworkManager } from "./NetworkManager";
import { PurgeManager } from "./PurgeManager";

export class FactManager {
    private networkManager: NetworkManager;
    private purgeManager: PurgeManager;

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
        await this.fork.save(envelopes);
        const saved = await this.store.save(envelopes);
        if (saved.length > 0) {
            Trace.counter("facts_saved", saved.length);
            await this.factsAdded(saved);
        }
        return saved;
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
}