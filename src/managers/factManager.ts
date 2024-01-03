import { Channel } from "../fork/channel";
import { Fork } from "../fork/fork";
import { Observable, ObservableSource, SpecificationListener } from "../observable/observable";
import { Observer, ObserverImpl, ResultAddedFunc } from "../observer/observer";
import { Query } from "../query/query";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactPath, FactRecord, FactReference, ProjectedResult, Storage } from "../storage";
import { Network, NetworkManager } from "./NetworkManager";

export class FactManager {
    private networkManager: NetworkManager;

    constructor(
        private readonly fork: Fork,
        private readonly observableSource: ObservableSource,
        private readonly store: Storage,
        network: Network
    ) {
        this.networkManager = new NetworkManager(network, store,
            factsAdded => this.observableSource.notify(factsAdded));
    }

    addChannel(fact: FactReference, query: Query): Channel 
    {
        return this.fork.addChannel(fact, query);
    }

    removeChannel(channel: Channel): void {
        this.fork.removeChannel(channel);
    }

    from(fact: FactReference, query: Query): Observable {
        const observable = this.observableSource.from(fact, query);
        return this.fork.decorateObservable(fact, query, observable);
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

    async save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        await this.fork.save(envelopes);
        const saved = await this.store.save(envelopes);
        await this.observableSource.notify(saved);
        return saved;
    }

    async query(start: FactReference, query: Query): Promise<FactPath[]> {
        const results = await this.fork.query(start, query);
        return results;
    }

    async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        return await this.store.read(start, specification);
    }

    async fetch(start: FactReference[], specification: Specification) {
        await this.networkManager.fetch(start, specification);
    }

    async subscribe(start: FactReference[], specification: Specification) {
        return await this.networkManager.subscribe(start, specification);
    }

    unsubscribe(feeds: string[]) {
        this.networkManager.unsubscribe(feeds);
    }

    load(references: FactReference[]): Promise<FactRecord[]> {
        return this.fork.load(references);
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
}