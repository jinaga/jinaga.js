import type { DistributionDenialCode } from '../distribution/distribution-engine';
import { FactRecord, FactReference } from '../storage';

export interface ProfileMessage {
    displayName: string;
};

export interface LoginResponse {
    userFact: FactRecord,
    profile: ProfileMessage
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

/**
 * The replicator's per-feed distribution decision, returned on `POST /feeds`
 * (issue #207). `feed` is the URL-safe feed hash. `decision: 'reactive'`
 * corresponds to the authorized-via-intersection case: the feed is denied for
 * the current user right now but will self-heal once the authorizing fact
 * arrives, so it must never be treated as a hard failure. `code` and the
 * human-readable `reason` describe why the feed was denied or made reactive.
 */
export interface FeedDecision {
    feed: string;                                   // hash
    decision: 'authorized' | 'reactive' | 'denied';
    code?: DistributionDenialCode;
    reason: string;
}

export interface FeedsResponse {
    feeds: string[];
    decisions?: FeedDecision[];                      // optional; old replicators omit it
}

export interface FeedResponse {
    references: FactReference[];
    bookmark: string;
}
