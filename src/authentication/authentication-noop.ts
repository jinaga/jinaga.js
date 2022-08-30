import { ObservableSource } from "../observable/observable";
import { Channel } from "../fork/channel";
import { LoginResponse } from "../http/messages";
import { Query } from "../query/query";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactRecord, FactReference } from "../storage";
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
        return this.inner.whichExist(references);
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