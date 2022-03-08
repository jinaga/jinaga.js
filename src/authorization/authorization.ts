import { UserIdentity } from '../keystore';
import { Query } from '../query/query';
import { FactPath, FactRecord, FactReference } from '../storage';

export interface Authorization {
    getOrCreateUserFact(userIdentity: UserIdentity): Promise<FactRecord>;
    query(userIdentity: UserIdentity, start: FactReference, query: Query): Promise<FactPath[]>;
    load(userIdentity: UserIdentity, references: FactReference[]): Promise<FactRecord[]>;
    save(userIdentity: UserIdentity, facts: FactRecord[]): Promise<FactRecord[]>;
}