import { UserIdentity } from "../user-identity";
import { Query } from '../query/query';
import { Specification } from "../specification/specification";
import { FactPath, FactRecord, FactReference } from '../storage';

export interface Authorization {
    getOrCreateUserFact(userIdentity: UserIdentity): Promise<FactRecord>;
    query(userIdentity: UserIdentity, start: FactReference, query: Query): Promise<FactPath[]>;
    read(userIdentity: UserIdentity, start: FactReference[], specification: Specification): Promise<any[]>;
    load(userIdentity: UserIdentity, references: FactReference[]): Promise<FactRecord[]>;
    save(userIdentity: UserIdentity, facts: FactRecord[]): Promise<FactRecord[]>;
}