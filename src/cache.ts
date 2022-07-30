import { Query } from './query/query';
import { Specification } from "./specification/specification";
import { FactEnvelope, FactReference, Storage } from './storage';

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