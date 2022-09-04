import { FactPath, FactRecord, FactReference } from '../storage';

export interface ProfileMessage {
    displayName: string;
};

export interface LoginResponse {
    userFact: FactRecord,
    profile: ProfileMessage
};

export interface QueryMessage {
    start: FactReference,
    query: string
};

export interface QueryResponse {
    results: FactPath[]
};

export interface SaveMessage {
    facts: FactRecord[]
};

export interface LoadMessage {
    references: FactReference[]
};

export interface LoadResponse {
    facts: FactRecord[]
};

export interface FeedsResponse {
    feeds: string[];
}

export interface FeedResponse {
    references: FactReference[];
    bookmark: string;
}
