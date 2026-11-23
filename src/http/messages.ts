import type { ReportedDenialCode } from '../distribution/distribution-engine';
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
 * the current user right now but can self-heal if an authorizing fact
 * arrives, so it must never be treated as a hard failure. `code` and the
 * human-readable `reason` describe why the feed was denied or made reactive.
 *
 * `decision` has exactly these three inhabitants, and a replicator that reports
 * a fourth does not widen it: the parser reads an unknown kind as `denied`, so
 * nothing downstream has an unknown kind to handle and nothing can mistake one
 * for authorization (issue #439). `code`, by contrast, carries whatever the
 * replicator said, because a diagnostic that dropped an unrecognized code would
 * leave a developer with no way to look it up. Every string has a defined
 * meaning there: one this client knows carries that meaning, and any other is a
 * denial that is neither structural nor pending.
 */
export interface FeedDecision {
    feed: string;                                   // hash
    decision: 'authorized' | 'reactive' | 'denied';
    code?: ReportedDenialCode;
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
