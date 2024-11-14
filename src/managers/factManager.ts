import { Fork } from "../fork/fork";
import { ObservableSource, SpecificationListener } from "../observable/observable";
import { Observer, ObserverImpl, ResultAddedFunc } from "../observer/observer";
import { testSpecificationForCompliance } from "../purge/purgeCompliance";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactReference, ProjectedResult, Storage } from "../storage";
import { Network, NetworkManager } from "./NetworkManager";

export class FactManager {
    private networkManager: NetworkManager;

    constructor(
        private readonly fork: Fork,
        private readonly observableSource: ObservableSource,
        private readonly store: Storage,
        network: Network,
        private readonly purgeConditions: Specification[]
    ) {
        this.networkManager = new NetworkManager(network, store,
            factsAdded => this.observableSource.notify(factsAdded));
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
        await this.observableSource.notify(saved);
        return saved;
    }

    async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        var failures = testSpecificationForCompliance(specification, this.purgeConditions);
        if (failures.length > 0) {
            var message = failures.join("\n");
            throw new Error(message);
        }
        return await this.store.read(start, specification);
    }

    async fetch(start: FactReference[], specification: Specification) {
        var failures = testSpecificationForCompliance(specification, this.purgeConditions);
        if (failures.length > 0) {
            var message = failures.join("\n");
            throw new Error(message);
        }
        await this.networkManager.fetch(start, specification);
    }

    async subscribe(start: FactReference[], specification: Specification) {
        var failures = testSpecificationForCompliance(specification, this.purgeConditions);
        if (failures.length > 0) {
            var message = failures.join("\n");
            throw new Error(message);
        }
        return await this.networkManager.subscribe(start, specification);
    }

    unsubscribe(feeds: string[]) {
        this.networkManager.unsubscribe(feeds);
    }

    load(references: FactReference[]): Promise<FactEnvelope[]> {
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