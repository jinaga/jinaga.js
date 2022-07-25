import { Feed, Observable } from './feed/feed';
import { WebClient } from './http/web-client';
import { Query } from './query/query';
import { Specification } from "./specification/specification";
import { FactEnvelope, FactRecord, FactReference } from './storage';

export class Principal {
    
}

export class Authentication implements Feed {
    private principal: Principal;

    constructor(private inner: Feed, private client: WebClient) {
    }

    async close(): Promise<void> {
        await this.inner.close();
    }

    login() {
        return this.client.login();
    }

    async save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        const saved = await this.inner.save(envelopes);
        return saved;
    }

    query(start: FactReference, query: Query) {
        return this.inner.query(start, query);
    }

    read(start: FactReference[], specification: Specification): Promise<any[]> {
        return this.inner.read(start, specification);
    }

    whichExist(references: FactReference[]): Promise<FactReference[]> {
        throw new Error("whichExist method not implemented on Authentication.");
    }

    load(references: FactReference[]): Promise<FactRecord[]> {
        return this.inner.load(references);
    }

    from(fact: FactReference, query: Query): Observable {
        return this.inner.from(fact, query);
    }
}