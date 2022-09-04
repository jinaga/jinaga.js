import { UserIdentity } from "../user-identity";
import { Query } from '../query/query';
import { Specification } from "../specification/specification";
import { FactFeed, FactPath, FactRecord, FactReference } from '../storage';
import { Feed } from "../specification/feed";

export interface Authorization {
    getOrCreateUserFact(userIdentity: UserIdentity): Promise<FactRecord>;
    query(userIdentity: UserIdentity, start: FactReference, query: Query): Promise<FactPath[]>;
    read(userIdentity: UserIdentity, start: FactReference[], specification: Specification): Promise<any[]>;
    feed(userIdentity: UserIdentity, feed: Feed, bookmark: string): Promise<FactFeed>;
    load(userIdentity: UserIdentity, references: FactReference[]): Promise<FactRecord[]>;
    save(userIdentity: UserIdentity, facts: FactRecord[]): Promise<FactRecord[]>;
}