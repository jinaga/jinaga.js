import { Authentication } from "../authentication/authentication";
import { Channel } from "../fork/channel";
import { LoginResponse } from "../http/messages";
import { Observable, SpecificationListener } from "../observable/observable";
import { Query } from "../query/query";
import { Feed } from "../specification/feed";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactFeed, FactPath, FactRecord, FactReference, ProjectedResult } from "../storage";

export class FactManager {
    constructor(
        private readonly authentication: Authentication
    ) { }

    login(): Promise<LoginResponse> {
        return this.authentication.login();
    }

    local(): Promise<FactRecord> {
        return this.authentication.local();
    }

    addChannel(fact: FactReference, query: Query): Channel 
    {
        return this.authentication.addChannel(fact, query);
    }

    removeChannel(channel: Channel): void {
        this.authentication.removeChannel(channel);
    }

    from(fact: FactReference, query: Query): Observable {
        return this.authentication.from(fact, query);
    }

    addSpecificationListener(specification: Specification, onResult: (results: ProjectedResult[]) => Promise<void>): SpecificationListener {
        return this.authentication.addSpecificationListener(specification, onResult);
    }

    removeSpecificationListener(listener: SpecificationListener): void {
        this.authentication.removeSpecificationListener(listener);
    }

    close(): Promise<void> {
        return this.authentication.close();
    }

    save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        return this.authentication.save(envelopes);
    }

    query(start: FactReference, query: Query): Promise<FactPath[]> {
        return this.authentication.query(start, query);
    }

    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        return this.authentication.read(start, specification);
    }

    feed(feed: Feed, bookmark: string): Promise<FactFeed> {
        return this.authentication.feed(feed, bookmark);
    }

    whichExist(references: FactReference[]): Promise<FactReference[]> {
        return this.authentication.whichExist(references);
    }

    load(references: FactReference[]): Promise<FactRecord[]> {
        return this.authentication.load(references);
    }
}