import { Authentication } from "../authentication/authentication";
import { Channel } from "../fork/channel";
import { Fork } from "../fork/fork";
import { LoginResponse } from "../http/messages";
import { Observable, ObservableSource, SpecificationListener } from "../observable/observable";
import { Query } from "../query/query";
import { Feed } from "../specification/feed";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactFeed, FactPath, FactRecord, FactReference, ProjectedResult, Storage } from "../storage";

export class FactManager {
    constructor(
        private readonly authentication: Authentication,
        private readonly fork: Fork,
        private readonly observableSource: ObservableSource,
        private readonly store: Storage
    ) { }

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
        await this.authentication.authorize(envelopes);
        await this.fork.save(envelopes);
        const saved = await this.store.save(envelopes);
        await this.observableSource.notify(saved);
        return saved;
    }

    async query(start: FactReference, query: Query): Promise<FactPath[]> {
        const results = await this.fork.query(start, query);
        return results;
    }

    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        return this.store.read(start, specification);
    }

    feed(feed: Feed, bookmark: string): Promise<FactFeed> {
        return this.store.feed(feed, bookmark);
    }

    whichExist(references: FactReference[]): Promise<FactReference[]> {
        return this.store.whichExist(references);
    }

    load(references: FactReference[]): Promise<FactRecord[]> {
        return this.fork.load(references);
    }
}