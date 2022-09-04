import { ObservableSource } from '../observable/observable';
import { UserIdentity } from "../user-identity";
import { Query } from '../query/query';
import { Specification } from "../specification/specification";
import { FactFeed, FactRecord, FactReference } from '../storage';
import { Authorization } from './authorization';
import { Forbidden } from './authorization-engine';
import { Feed } from "../specification/feed";

export class AuthorizationNoOp implements Authorization {
    constructor(
        private observableSource: ObservableSource
    ) { }

    getOrCreateUserFact(userIdentity: UserIdentity): Promise<FactRecord> {
        throw new Forbidden();
    }

    query(userIdentity: UserIdentity, start: FactReference, query: Query): Promise<any[]> {
        return this.observableSource.query(start, query);
    }

    read(userIdentity: UserIdentity, start: FactReference[], specification: Specification): Promise<any[]> {
        return this.observableSource.read(start, specification);
    }

    load(userIdentity: UserIdentity, references: FactReference[]): Promise<FactRecord[]> {
        return this.observableSource.load(references);
    }

    feed(userIdentity: UserIdentity, feed: Feed, bookmark: string): Promise<FactFeed> {
        return this.observableSource.feed(feed, bookmark);
    }

    async save(userIdentity: UserIdentity, facts: FactRecord[]): Promise<FactRecord[]> {
        const envelopes = await this.observableSource.save(facts.map(fact => ({
            fact,
            signatures: []
        })));
        return envelopes.map(envelope => envelope.fact);
    }
}