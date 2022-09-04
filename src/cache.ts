import { Query } from './query/query';
import { Feed } from "./specification/feed";
import { Specification } from "./specification/specification";
import { FactEnvelope, FactFeed, FactReference, Storage } from './storage';

export class Cache implements Storage {
    constructor(private inner: Storage) {

    }

    save(envelopes: FactEnvelope[]) {
        return this.inner.save(envelopes);
    }

    query(start: FactReference, query: Query) {
        return this.inner.query(start, query);
    }

    read(start: FactReference[], specification: Specification): Promise<any[]> {
        return this.inner.read(start, specification);
    }

    feed(feed: Feed, bookmark: string, limit: number): Promise<FactFeed> {
        return this.inner.feed(feed, bookmark, limit);
    }

    whichExist(references: FactReference[]): Promise<FactReference[]> {
        return this.inner.whichExist(references);
    }

    load(references: FactReference[]) {
        return this.inner.load(references);
    }

    close() {
        return this.inner.close();
    }
}