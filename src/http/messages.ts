import type { ReportedDenialCode, ReportedFeedDecisionKind } from '../distribution/distribution-engine';
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
 * `decision` and `code` both carry whatever the replicator said, because this
 * is the wire format and a newer peer may report a kind or a code this client
 * has never heard of (issue #439). Discarding either here would protect
 * nothing -- the value was already on the wire -- and would leave a developer
 * with no way to look it up. Every string has a defined meaning: one this
 * client knows carries that meaning, and any other is a denial that is neither
 * structural nor pending, which is what `isFeedDecisionKind` and
 * `isDistributionDenialCode` are for. Nothing reads an unrecognized kind as
 * authorization, because every reader of `decision` tests positively for the
 * kind it acts on.
 */
export interface FeedDecision {
    feed: string;                                   // hash
    decision: ReportedFeedDecisionKind;
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
