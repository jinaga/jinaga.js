import { Specification } from "../specification/specification";
import { FactEnvelope, FactFeed, FactRecord, FactReference, ProjectedResult, ReferencesByName } from "../storage";
import { UserIdentity } from "../user-identity";

export interface Authorization {
    getOrCreateUserFact(userIdentity: UserIdentity): Promise<FactRecord>;
    read(userIdentity: UserIdentity | null, start: FactReference[], specification: Specification): Promise<ProjectedResult[]>;
    feed(userIdentity: UserIdentity | null, feed: Specification, start: FactReference[], bookmark: string): Promise<FactFeed>;
    load(userIdentity: UserIdentity | null, references: FactReference[]): Promise<FactEnvelope[]>;
    save(userIdentity: UserIdentity | null, facts: FactEnvelope[]): Promise<FactEnvelope[]>;
    verifyDistribution(userIdentity: UserIdentity | null, feeds: Specification[], namedStart: ReferencesByName): Promise<void>;
}