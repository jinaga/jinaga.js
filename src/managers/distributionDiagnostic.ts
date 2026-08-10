import { DistributionDenialCode } from "../distribution/distribution-engine";
import { FeedDecision } from "../http/messages";
import { FactReference } from "../storage";

export type DiagnosticOperation = 'query' | 'watch' | 'subscribe';

/**
 * A developer-facing distribution diagnostic (issue #207). Emitted for a feed
 * that the replicator marked `reactive` or `denied`; authorized feeds produce
 * none.
 *
 * The single load-bearing field is `reactive`. When `true`, the decision is the
 * subscription race — the feed is denied for the current user *right now* but
 * will self-heal once the authorizing fact arrives — and must NEVER be treated
 * as fatal. When `false`, the denial is structural (a missing or narrowed-past
 * rule, or a principal the rule excludes) and will not self-heal on its own.
 *
 * `code` is optional because a `reactive` decision need not carry one (the
 * replicator may report the pending case without a denial code); a `denied`
 * decision always carries one.
 *
 * Defined here rather than in `jinaga.ts` so both the client (`Jinaga`) and the
 * `Observer` can build diagnostics without an import cycle (`jinaga.ts` already
 * imports from `observer.ts`).
 */
export interface DistributionDiagnostic {
    /**
     * Discriminant for `ReadDiagnostic` (issue #232). Required rather than
     * optional so there is exactly one spelling of this variant; an optional
     * discriminant would let `undefined` and `'distribution'` mean the same
     * thing.
     */
    kind: 'distribution';
    operation: DiagnosticOperation;
    specification: string;            // describeSpecification(...)
    decision: 'reactive' | 'denied';
    code?: DistributionDenialCode;
    reactive: boolean;                // true => will self-heal; NEVER treat as fatal
    reason: string;
    /**
     * The feed hash this diagnostic pertains to (issue #207 W9). Lets a
     * consumer correlate a raised diagnostic with its later clearing and
     * deduplicate per `(feed, code)`.
     */
    feed?: string;
    /**
     * True when this diagnostic reports that a previously `reactive` feed has
     * begun delivering data — the subscription race resolving (issue #207 W9).
     * The matching raised diagnostic (same `feed`) can be considered resolved.
     */
    cleared?: boolean;
}

/**
 * A read that could not be answered because one or more given facts are not
 * materialized in the local store, and nothing could have supplied them
 * (issue #232).
 *
 * Emitted only when `FetchOutcome.remoteConsulted` is false. When a remote
 * source was consulted, the replicator evaluated the specification from the
 * given and reported what matches; that answer is authoritative whether or not
 * the given is locally resident, so no diagnostic is produced.
 *
 * Carries none of `DistributionDiagnostic`'s per-feed fields. There is no feed
 * behind this condition and no denial code that describes it, and inventing a
 * `reactive` value in particular would be actively misleading, since that field
 * is documented as the load-bearing "will self-heal" signal.
 */
export interface GivenNotFoundDiagnostic {
    kind: 'given-not-found';
    operation: DiagnosticOperation;
    specification: string;            // describeSpecification(...)
    /** Every given that was absent, not merely the first. */
    references: FactReference[];
    reason: string;
    /**
     * True when this reports that a previously absent given has since been
     * materialized — the watch equivalent of `DistributionDiagnostic.cleared`.
     * The matching raised diagnostic can be considered resolved.
     */
    cleared?: boolean;
}

/**
 * Everything that can impair a read, on one channel (issue #232). Discriminated
 * by `kind` so a consumer switching exhaustively fails to compile when a
 * variant is added, rather than silently ignoring it.
 */
export type ReadDiagnostic = DistributionDiagnostic | GivenNotFoundDiagnostic;

/**
 * Build the diagnostic for a read whose givens were not found (issue #232).
 */
export function toGivenNotFoundDiagnostic(
    operation: DiagnosticOperation,
    specification: string,
    references: FactReference[]
): GivenNotFoundDiagnostic {
    return {
        kind: 'given-not-found',
        operation,
        specification,
        references,
        reason: describeMissingGivens(references) +
            ' No remote source was consulted for this read, so the empty result reflects ' +
            'the missing starting point rather than the specification.'
    };
}

/**
 * Build the clearing companion emitted when a previously absent given has been
 * materialized (issue #232), so a consumer can retire the earlier notice.
 */
export function toGivenFoundDiagnostic(
    operation: DiagnosticOperation,
    specification: string,
    references: FactReference[]
): GivenNotFoundDiagnostic {
    return {
        kind: 'given-not-found',
        operation,
        specification,
        references,
        reason: 'The given fact is now present in the local store; the read can proceed.',
        cleared: true
    };
}

export function describeMissingGivens(references: FactReference[]): string {
    const list = references.map(r => `${r.type} ${r.hash}`).join(', ');
    return references.length === 1
        ? `The given fact is not in the local store: ${list}.`
        : `${references.length} given facts are not in the local store: ${list}.`;
}

/**
 * Map the replicator's per-feed decisions (issue #207 W4) to developer-facing
 * diagnostics. Only `denied` and `reactive` feeds produce a diagnostic;
 * `authorized` feeds are silent. Old replicators report no decisions, so this
 * yields an empty array and the new APIs are inert.
 */
export function toDistributionDiagnostics(
    operation: DiagnosticOperation,
    specification: string,
    decisions: FeedDecision[]
): DistributionDiagnostic[] {
    return decisions
        .filter(d => d.decision === 'denied' || d.decision === 'reactive')
        .map(d => ({
            kind: 'distribution' as const,
            operation,
            specification,
            decision: d.decision as 'reactive' | 'denied',
            code: d.code,
            reactive: d.decision === 'reactive',
            reason: d.reason,
            feed: d.feed
        }));
}

/**
 * Build the clearing diagnostic (issue #207 W9) emitted when a previously
 * `reactive` feed begins delivering data — the subscription race resolving. It
 * carries the same feed/code/operation as the raised diagnostic, with
 * `cleared: true`, so a consumer can retire the earlier "pending authorization"
 * signal.
 */
export function toClearingDiagnostic(
    operation: DiagnosticOperation,
    specification: string,
    decision: FeedDecision
): DistributionDiagnostic {
    return {
        kind: 'distribution',
        operation,
        specification,
        decision: decision.decision === 'denied' ? 'denied' : 'reactive',
        code: decision.code,
        // The race has resolved, so this is no longer a pending state: a
        // consumer that only inspects `reactive`/`reason` (ignoring `cleared`)
        // must not read it as another pending-authorization event. Hence
        // `reactive: false` and a resolution-specific reason rather than reusing
        // the original "pending authorization" text.
        reactive: false,
        reason: 'Distribution is now authorized for the current user; the feed is delivering data.',
        feed: decision.feed,
        cleared: true
    };
}

/**
 * The denial codes that are *structural* — a missing rule or a spec narrowed
 * past its rule. These never self-heal (unlike the subscription race), so they
 * are the only cases `query` throws for in development mode (issue #207 W8) and
 * the ones the default dev handler reports at error level (W7). A `reactive`
 * diagnostic is never structural regardless of its code.
 */
export function isStructuralDenial(diagnostic: ReadDiagnostic): boolean {
    // Narrow before touching the distribution-only fields. A given-not-found
    // diagnostic has no denial code and is never a distribution decision.
    return diagnostic.kind === 'distribution'
        && !diagnostic.reactive
        && (diagnostic.code === 'no-matching-rule'
            || diagnostic.code === 'spec-more-restrictive-than-rule');
}

/**
 * Thrown by `query` in development mode (issue #207 W8) when a feed is denied by
 * a structural cause that provably never self-heals — so a mis-authored spec
 * fails loudly at the call site instead of silently returning empty. Never
 * thrown for a `reactive` decision (that would break the subscription race) and
 * never in production, where `query` stays silent-empty. `diagnostics` carries
 * the structural diagnostics that caused the throw.
 */
export class DistributionDeniedError extends Error {
    constructor(public readonly diagnostics: DistributionDiagnostic[]) {
        super(DistributionDeniedError.buildMessage(diagnostics));
        this.name = 'DistributionDeniedError';
        // Restore the prototype chain so `instanceof` works after TypeScript's
        // down-level `extends Error` transpilation.
        Object.setPrototypeOf(this, DistributionDeniedError.prototype);
    }

    private static buildMessage(diagnostics: DistributionDiagnostic[]): string {
        return diagnostics.map(d => d.reason).join('\n\n')
            || 'The specification is denied by distribution.';
    }
}

/**
 * Thrown by `query` when a given fact is not in the local store and nothing
 * could have supplied it (issue #232) — no replicator is configured, or the
 * fetch ran no feeds.
 *
 * A one-shot `query` has no "later" in which the fact might arrive, so a silent
 * empty result would be indistinguishable from a correct answer. `watch` and
 * `subscribe` do have a later, so they report the same condition as a
 * diagnostic and never throw. Callers that want to inspect the condition
 * without throwing use `queryWithDiagnostics`.
 *
 * Never thrown when a remote source was consulted: the replicator evaluated the
 * specification from the given and reported what matches, which is an
 * authoritative answer regardless of local residency.
 */
export class GivenNotFoundError extends Error {
    constructor(public readonly references: FactReference[]) {
        super(describeMissingGivens(references) +
            ' It may have been purged, evicted, or never fetched; or the hash may be wrong. ' +
            'Save the fact, or use queryWithDiagnostics to handle this without an exception.');
        this.name = 'GivenNotFoundError';
        // Restore the prototype chain so `instanceof` works after TypeScript's
        // down-level `extends Error` transpilation.
        Object.setPrototypeOf(this, GivenNotFoundError.prototype);
    }
}
