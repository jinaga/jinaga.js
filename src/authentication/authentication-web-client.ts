import { Observable } from '../observable/observable';
import { Channel } from "../fork/channel";
import { Fork } from "../fork/fork";
import { WebClient } from '../http/web-client';
import { Query } from '../query/query';
import { Specification } from "../specification/specification";
import { FactEnvelope, FactRecord, FactReference } from '../storage';
import { Authentication } from './authentication';

export class Principal {
    
}

export class AuthenticationWebClient implements Authentication {
    private principal: Principal;

    constructor(private inner: Fork, private client: WebClient) {
    }

    async close(): Promise<void> {
        await this.inner.close();
    }

    login() {
        return this.client.login();
    }

    local(): Promise<FactRecord> {
        throw new Error('Local device has no persistence.');
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
        throw new Error("whichExist method not implemented on AuthenticationImpl.");
    }

    load(references: FactReference[]): Promise<FactRecord[]> {
        return this.inner.load(references);
    }

    from(fact: FactReference, query: Query): Observable {
        return this.inner.from(fact, query);
    }

    addChannel(fact: FactReference, query: Query): Channel {
        return this.inner.addChannel(fact, query);
    }

    removeChannel(channel: Channel) {
        this.inner.removeChannel(channel);
    }
}