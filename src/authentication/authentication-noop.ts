import { Feed } from "../feed/feed";
import { Channel } from "../fork/channel";
import { LoginResponse } from "../http/messages";
import { Query } from "../query/query";
import { FactEnvelope, FactRecord, FactReference } from "../storage";
import { Authentication } from "./authentication";

export class AuthenticationNoOp implements Authentication {
    constructor(
        private inner: Feed
    ) { }

    login(): Promise<LoginResponse> {
        throw new Error('No logged in user.');
    }
    local(): Promise<FactRecord> {
        throw new Error('No persistent device.');
    }
    from(fact: FactReference, query: Query) {
        return this.inner.from(fact, query);
    }
    async save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        const saved = await this.inner.save(envelopes);
        return saved;
    }
    query(start: FactReference, query: Query) {
        return this.inner.query(start, query);
    }
    exists(fact: FactReference) {
        return this.inner.exists(fact);
    }
    load(references: FactReference[]) {
        return this.inner.load(references);
    }
    addChannel(fact: FactReference, query: Query): Channel {
        return null;
    }
    removeChannel(channel: Channel): void {
    }
}