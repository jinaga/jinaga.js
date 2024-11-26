import { Fork } from "../fork/fork";
import { ObservableSource, SpecificationListener } from "../observable/observable";
import { Observer, ObserverImpl, ResultAddedFunc } from "../observer/observer";
import { testSpecificationForCompliance } from "../purge/purgeCompliance";
import { invertSpecification, SpecificationInverse } from "../specification/inverse";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactReference, ProjectedResult, Storage } from "../storage";
import { Network, NetworkManager } from "./NetworkManager";

export class FactManager {
    private networkManager: NetworkManager;
    private purgeInverses: SpecificationInverse[];

    constructor(
        private readonly fork: Fork,
        private readonly observableSource: ObservableSource,
        private readonly store: Storage,
        network: Network,
        private readonly purgeConditions: Specification[]
    ) {
        this.networkManager = new NetworkManager(network, store,
            factsAdded => this.factsAdded(factsAdded));

        this.purgeInverses = purgeConditions.map(pc => invertSpecification(pc)).flat();
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
        await this.factsAdded(saved);
        return saved;
    }

    async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        this.checkCompliance(specification);
        return await this.store.read(start, specification);
    }

    async fetch(start: FactReference[], specification: Specification) {
        this.checkCompliance(specification);
        await this.networkManager.fetch(start, specification);
    }

    async subscribe(start: FactReference[], specification: Specification) {
        this.checkCompliance(specification);
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

    private async factsAdded(factsAdded: FactEnvelope[]): Promise<void> {
        await this.observableSource.notify(factsAdded);

        for (const envelope of factsAdded) {
            const fact = envelope.fact;
            for (const purgeInverse of this.purgeInverses) {
                // Only run the purge inverse if the given type matches the fact type
                if (purgeInverse.inverseSpecification.given[0].type !== fact.type) {
                    continue;
                }

                const givenReference = {
                    type: fact.type,
                    hash: fact.hash
                };
                const results: ProjectedResult[] = await this.store.read([givenReference], purgeInverse.inverseSpecification);
                for (const result of results) {
                    const givenName = purgeInverse.givenSubset[0];
                    // The given is the purge root
                    const purgeRoot: FactReference = result.tuple[givenName];
                    // All other members of the result tuple are triggers
                    const triggers: FactReference[] = Object.keys(result.tuple)
                        .filter(k => k !== givenName)
                        .map(k => result.tuple[k]);

                    // Purge all descendants of the purge root except for the triggers
                    await this.store.purgeDescendants(purgeRoot, triggers);
                }
            }
        }
    }

    async purge(): Promise<void> {
        await this.store.purge(this.purgeConditions);
    }

    private checkCompliance(specification: Specification): void {
        const failures = testSpecificationForCompliance(specification, this.purgeConditions);
        if (failures.length > 0) {
            const message = failures.join("\n");
            throw new Error(message);
        }
    }
}