import { Feed } from '../feed/feed';
import { UserIdentity } from '../keystore';
import { Query } from '../query/query';
import { FactRecord, FactReference } from '../storage';
import { Authorization } from './authorization';
import { Forbidden } from './authorization-engine';

export class AuthorizationNoOp implements Authorization {
    constructor(
        private feed: Feed
    ) { }

    getOrCreateUserFact(userIdentity: UserIdentity): Promise<FactRecord> {
        throw new Forbidden();
    }

    query(userIdentity: UserIdentity, start: FactReference, query: Query): Promise<any[]> {
        return this.feed.query(start, query);
    }

    load(userIdentity: UserIdentity, references: FactReference[]): Promise<FactRecord[]> {
        return this.feed.load(references);
    }

    async save(userIdentity: UserIdentity, facts: FactRecord[]): Promise<FactRecord[]> {
        const envelopes = await this.feed.save(facts.map(fact => ({
            fact,
            signatures: []
        })));
        return envelopes.map(envelope => envelope.fact);
    }
}