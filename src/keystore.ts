import { FactEnvelope, FactRecord, FactSignature } from "./storage";
import { UserIdentity } from "./user-identity";

export interface Keystore {
    close(): Promise<void>;
    getOrCreateUserFact(userIdentity: UserIdentity): Promise<FactRecord>;
    getOrCreateDeviceFact(userIdentity: UserIdentity): Promise<FactRecord>;
    getUserFact(userIdentity: UserIdentity): Promise<FactRecord>;
    getDeviceFact(userIdentity: UserIdentity): Promise<FactRecord>;
    signFacts(userIdentity: UserIdentity, facts: FactRecord[]): Promise<FactEnvelope[]>;
}