import { FactReferenceByName } from "../distribution/distribution-engine";
import { Query } from '../query/query';
import { Specification } from "../specification/specification";
import { FactFeed, FactPath, FactRecord, FactReference, ProjectedResult } from '../storage';
import { UserIdentity } from "../user-identity";

export interface Authorization {
    getOrCreateUserFact(userIdentity: UserIdentity): Promise<FactRecord>;
    query(userIdentity: UserIdentity | null, start: FactReference, query: Query): Promise<FactPath[]>;
    read(userIdentity: UserIdentity | null, start: FactReference[], specification: Specification): Promise<ProjectedResult[]>;
    feed(userIdentity: UserIdentity | null, feed: Specification, start: FactReference[], bookmark: string): Promise<FactFeed>;
    load(userIdentity: UserIdentity | null, references: FactReference[]): Promise<FactRecord[]>;
    save(userIdentity: UserIdentity | null, facts: FactRecord[]): Promise<FactRecord[]>;
    verifyDistribution(userIdentity: UserIdentity | null, feeds: Specification[], namedStart: FactReferenceByName): Promise<void>;
}