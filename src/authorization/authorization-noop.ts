import { FactManager } from "../managers/factManager";
import { Query } from '../query/query';
import { Specification } from "../specification/specification";
import { FactEnvelope, FactFeed, FactRecord, FactReference, ProjectedResult, ReferencesByName, Storage } from "../storage";
import { UserIdentity } from "../user-identity";
import { Authorization } from './authorization';
import { Forbidden } from './authorization-engine';

export class AuthorizationNoOp implements Authorization {
    constructor(
        private factManager: FactManager,
        private store: Storage
    ) { }

    getOrCreateUserFact(userIdentity: UserIdentity): Promise<FactRecord> {
        throw new Forbidden();
    }

    query(userIdentity: UserIdentity, start: FactReference, query: Query): Promise<any[]> {
        return this.factManager.query(start, query);
    }

    read(userIdentity: UserIdentity, start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        return this.factManager.read(start, specification);
    }

    load(userIdentity: UserIdentity, references: FactReference[]): Promise<FactRecord[]> {
        return this.factManager.load(references);
    }

    feed(userIdentity: UserIdentity, specification: Specification, start: FactReference[], bookmark: string): Promise<FactFeed> {
        return this.store.feed(specification, start, bookmark);
    }

    async save(userIdentity: UserIdentity, envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        return await this.factManager.save(envelopes);
    }

    verifyDistribution(userIdentity: UserIdentity, feeds: Specification[], namedStart: ReferencesByName): Promise<void> {
        return Promise.resolve();
    }
}