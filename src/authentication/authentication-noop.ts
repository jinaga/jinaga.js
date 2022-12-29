import { Channel } from "../fork/channel";
import { LoginResponse } from "../http/messages";
import { ObservableSource, SpecificationListener } from "../observable/observable";
import { Query } from "../query/query";
import { Feed } from "../specification/feed";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactFeed, FactRecord, FactReference, ProjectedResult } from "../storage";
import { Authentication } from "./authentication";

export class AuthenticationNoOp implements Authentication {
    constructor(
        private inner: ObservableSource
    ) { }

    async close(): Promise<void> {
        await this.inner.close();
    }
    login(): Promise<LoginResponse> {
        throw new Error('No logged in user.');
    }
    local(): Promise<FactRecord> {
        throw new Error('No persistent device.');
    }
    from(fact: FactReference, query: Query) {
        return this.inner.from(fact, query);
    }
    addSpecificationListener(specification: Specification, onResult: (results: ProjectedResult[]) => Promise<void>) {
        return this.inner.addSpecificationListener(specification, onResult);
    }
    removeSpecificationListener(listener: SpecificationListener) {
        return this.inner.removeSpecificationListener(listener);
    }
    async save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        const saved = await this.inner.save(envelopes);
        return saved;
    }
    query(start: FactReference, query: Query) {
        return this.inner.query(start, query);
    }
    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        return this.inner.read(start, specification);
    }
    feed(feed: Feed, bookmark: string): Promise<FactFeed> {
        return this.inner.feed(feed, bookmark);
    }
    whichExist(references: FactReference[]): Promise<FactReference[]> {
        return this.inner.whichExist(references);
    }
    load(references: FactReference[]) {
        return this.inner.load(references);
    }
    addChannel(fact: FactReference, query: Query): Channel {
        return Channel.NoOp;
    }
    removeChannel(channel: Channel): void {
    }
}