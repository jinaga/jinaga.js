import { DistributionDenialCode } from "../distribution/distribution-engine";
import { FeedDecision } from "../http/messages";

/**
 * A developer-facing distribution diagnostic (issue #207). Emitted for a feed
 * that the replicator marked `reactive` or `denied`; authorized feeds produce
 * none.
 *
 * The single load-bearing field is `reactive`. When `true`, a rule's shape
 * matches the feed but the current user does not satisfy it *right now*. The
 * feed stays open and delivers if an authorizing fact arrives, so it must NEVER
 * be treated as fatal. Nothing in the decision predicts that such a fact will
 * arrive. The subscription race, where this client has saved the authorizing
 * fact and the replicator has not yet received it, is the case it exists for.
 *
 * A watch does not simply wait for one: it sends what this client has unsent
 * and asks the replicator again (issue #394), so a diagnostic it raised is
 * followed by `cleared` once the feed delivers, or by `settled` once the
 * replicator has had everything this client sent and still withholds it.
 * When `false`, the denial is structural (a missing or narrowed-past rule, or a
 * principal the rule excludes) and will not self-heal on its own.
 *
 * It is therefore *not* a copy of `decision`: a replicator that reports
 * `decision: "reactive"` for a structurally denied feed yields `reactive:
 * false` here. See `toDistributionDiagnostics`.
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
    operation: 'query' | 'watch' | 'subscribe';
    specification: string;            // describeSpecification(...)
    decision: 'reactive' | 'denied';
    code?: DistributionDenialCode;
    reactive: boolean;                // true => can self-heal; NEVER treat as fatal
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
    /**
     * True when a watch asked the replicator again, after everything this
     * client had queued had left it, and the feed was still pending (issue
     * #394).
     *
     * It is the watch's own verdict about one fetch, not a decision the
     * replicator reported: the replicator withheld this feed although it had
     * received every fact this client had to send, so waiting on this client's
     * own writes cannot change it. That is why it carries `reactive: false` and
     * `decision: 'denied'` rather than repeating the pending state, and why
     * `settled` is a field of its own rather than a denial code -- a code would
     * have to be one the replicator's wire format validates, and the replicator
     * never said this.
     *
     * A settled feed is settled *as of that fetch*. Another client's fact, or a
     * later batch from this one, can still authorize it, and the clearing
     * diagnostic then follows the settled one for the same feed.
     */
    settled?: boolean;
}

/**
 * The denial codes that describe the *shape* of the specification against the
 * shape of every rule: no rule matched it, or it carries structure no rule has.
 * Neither depends on which facts exist or on who is logged in, so no fact that
 * later arrives can change either verdict. That is what makes them structural,
 * and it is a property of the code alone.
 */
const structuralDenialCodes: readonly DistributionDenialCode[] = ['no-matching-rule', 'spec-more-restrictive-than-rule'];

/**
 * True when a denial code is one of those. A decision need not carry a code at
 * all — the replicator may report the pending case without one — and an absent
 * code claims nothing about the shapes, so it is not structural.
 */
function isStructuralCode(code: DistributionDenialCode | undefined): boolean {
    return code !== undefined && structuralDenialCodes.includes(code);
}

/**
 * True when a decision reports a feed that is *pending authorization*: a rule's
 * shape matches it, but the current user does not satisfy that rule right now.
 * The feed stays open and delivers if an authorizing fact arrives, so none of
 * its facts are in the local graph yet and nothing about the decision says they
 * ever will be.
 *
 * This is the one rule for that state (issue #402). Two things read it, and
 * they must agree: the `reactive` field of every diagnostic raised below, and
 * the observer's decision to withhold the cache date. A feed whose decision is
 * `reactive` but whose code is structural is *not* pending -- no arriving fact
 * changes a shape mismatch -- so it sets `reactive: false` and withholds
 * nothing.
 */
export function isPendingAuthorization(decision: FeedDecision): boolean {
    return decision.decision === 'reactive' && !isStructuralCode(decision.code);
}

/**
 * Map the replicator's per-feed decisions (issue #207 W4) to developer-facing
 * diagnostics. Only `denied` and `reactive` feeds produce a diagnostic;
 * `authorized` feeds are silent. Old replicators report no decisions, so this
 * yields an empty array and the new APIs are inert.
 *
 * `reactive` is derived from the *code* rather than copied from the decision.
 * A replicator can report `decision: "reactive"` alongside a structural code
 * (observed on jinaga-replicator 3.7.7, issue #242), and the two disagree: the
 * decision says the feed can self-heal, while the code says the shapes
 * never matched, which no arriving fact can change. The code is the narrower,
 * checkable claim, so it wins. `decision` still carries what the replicator
 * actually said, for a consumer that wants to see it.
 */
export function toDistributionDiagnostics(
    operation: DistributionDiagnostic['operation'],
    specification: string,
    decisions: FeedDecision[]
): DistributionDiagnostic[] {
    return decisions
        .filter(d => d.decision === 'denied' || d.decision === 'reactive')
        .map(d => ({
            operation,
            specification,
            decision: d.decision as 'reactive' | 'denied',
            code: d.code,
            reactive: isPendingAuthorization(d),
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
    operation: DistributionDiagnostic['operation'],
    specification: string,
    decision: FeedDecision
): DistributionDiagnostic {
    return {
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
 * Build the settled diagnostic (issue #394) a watch emits when it asked the
 * replicator again -- after everything this client had queued had left it --
 * and the feed was still pending.
 *
 * It carries the pending diagnostic's `feed` and `code`, so a consumer retires
 * the earlier pending signal by the same correlation it uses for a clearing
 * one. `reactive` is `false` and `decision` is `denied` because the state this
 * reports is not the pending one: a consumer that reads only those two fields
 * must not take it for another "the race may still resolve" event. What makes
 * it distinct from a replicator's own denial is `settled`, which says whose
 * verdict it is.
 */
export function toSettledDiagnostic(
    operation: DistributionDiagnostic['operation'],
    specification: string,
    decision: FeedDecision
): DistributionDiagnostic {
    return {
        operation,
        specification,
        decision: 'denied',
        code: decision.code,
        reactive: false,
        reason: 'The replicator still withheld this feed after receiving every fact this client had sent, so no write of this client\'s can authorize it.',
        feed: decision.feed,
        settled: true
    };
}

/**
 * The denial codes that are *structural* — a missing rule or a spec narrowed
 * past its rule. These never self-heal (unlike the subscription race), so they
 * are the only cases `query` throws for (issue #207 W8) and the ones the
 * default dev handler reports at error level (W7). A `reactive` diagnostic is
 * never structural — but `reactive` is itself derived from the code, so a
 * replicator calling a structural denial reactive does not suppress the throw.
 *
 * The throw is unconditional. `developmentMode` gates only the installation of
 * the console handler in `JinagaBrowser`, never `query`'s contract, so a
 * structural denial fails loudly in production too.
 *
 * Exported so that consumers classify diagnostics the way `query` does rather
 * than re-implementing it. It answers "will an incoming fact ever heal this?",
 * which is not an application's "does the app need to act?". The two diverge on
 * `not-authenticated`: it is not structural, because a login can change it, yet
 * a UI must act on it, so it usually shows as an error rather than as pending.
 * Use this to inform an application's policy, not to replace it.
 */
export function isStructuralDenial(diagnostic: DistributionDiagnostic): boolean {
    return !diagnostic.reactive
        && isStructuralCode(diagnostic.code);
}

/**
 * Thrown by `query` (issue #207 W8) when a feed is denied by a structural cause
 * that provably never self-heals — so a mis-authored spec fails loudly at the
 * call site instead of silently returning empty. Never thrown for a `reactive`
 * decision (that would break the subscription race), nor for a non-structural
 * denial (`principal-excluded` / `not-authenticated`), which are auth states
 * rather than authoring errors. `diagnostics` carries the structural
 * diagnostics that caused the throw.
 *
 * Thrown in every environment. `developmentMode` gates only the installation of
 * the console handler in `JinagaBrowser`, never this contract.
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
