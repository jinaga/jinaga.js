import { Authentication } from "../authentication/authentication";
import { Channel } from "../fork/channel";
import { Fork } from "../fork/fork";
import { LoginResponse } from "../http/messages";
import { Observable, ObservableSource, SpecificationListener } from "../observable/observable";
import { Query } from "../query/query";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactPath, FactRecord, FactReference, ProjectedResult, Storage } from "../storage";
import { Network, NetworkManager } from "./NetworkManager";

export class FactManager {
    private networkManager: NetworkManager;

    constructor(
        private readonly authentication: Authentication,
        private readonly fork: Fork,
        private readonly observableSource: ObservableSource,
        private readonly store: Storage,
        network: Network
    ) {
        this.networkManager = new NetworkManager(network, store);
    }

    login(): Promise<LoginResponse> {
        return this.authentication.login();
    }

    local(): Promise<FactRecord> {
        return this.authentication.local();
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
        const authorized = await this.authentication.authorize(envelopes);
        await this.fork.save(authorized);
        const saved = await this.store.save(authorized);
        await this.observableSource.notify(saved);
        return saved;
    }

    async query(start: FactReference, query: Query): Promise<FactPath[]> {
        const results = await this.fork.query(start, query);
        return results;
    }

    async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        await this.networkManager.fetch(start, specification);
        return await this.store.read(start, specification);
    }

    load(references: FactReference[]): Promise<FactRecord[]> {
        return this.fork.load(references);
    }
}