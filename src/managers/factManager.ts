import { Authentication } from "../authentication/authentication";
import { Channel } from "../fork/channel";
import { Fork } from "../fork/fork";
import { LoginResponse } from "../http/messages";
import { Observable, ObservableSource, SpecificationListener } from "../observable/observable";
import { Query } from "../query/query";
import { Feed } from "../specification/feed";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactFeed, FactPath, FactRecord, FactReference, ProjectedResult } from "../storage";

export class FactManager {
    constructor(
        private readonly authentication: Authentication,
        private readonly fork: Fork,
        private readonly observableSource: ObservableSource
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
        return this.fork.from(fact, query);
    }

    addSpecificationListener(specification: Specification, onResult: (results: ProjectedResult[]) => Promise<void>): SpecificationListener {
        return this.fork.addSpecificationListener(specification, onResult);
    }

    removeSpecificationListener(listener: SpecificationListener): void {
        this.fork.removeSpecificationListener(listener);
    }

    close(): Promise<void> {
        return this.fork.close();
    }

    async save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        await this.authentication.authorize(envelopes);
        return await this.fork.save(envelopes);
    }

    query(start: FactReference, query: Query): Promise<FactPath[]> {
        return this.fork.query(start, query);
    }

    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        return this.fork.read(start, specification);
    }

    feed(feed: Feed, bookmark: string): Promise<FactFeed> {
        return this.fork.feed(feed, bookmark);
    }

    whichExist(references: FactReference[]): Promise<FactReference[]> {
        return this.fork.whichExist(references);
    }

    load(references: FactReference[]): Promise<FactRecord[]> {
        return this.fork.load(references);
    }
}