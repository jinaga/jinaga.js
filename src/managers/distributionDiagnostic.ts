import { DistributionDenialCode } from "../distribution/distribution-engine";
import { FeedDecision } from "../http/messages";

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
 * The denial codes that describe the *shape* of the specification against the
 * shape of every rule: no rule matched it, or it carries structure no rule has.
 * Neither depends on which facts exist or on who is logged in, so no fact that
 * later arrives can change either verdict. That is what makes them structural,
 * and it is a property of the code alone.
 */
const structuralDenialCodes: readonly string[] = ['no-matching-rule', 'spec-more-restrictive-than-rule'];

/**
 * Map the replicator's per-feed decisions (issue #207 W4) to developer-facing
 * diagnostics. Only `denied` and `reactive` feeds produce a diagnostic;
 * `authorized` feeds are silent. Old replicators report no decisions, so this
 * yields an empty array and the new APIs are inert.
 *
 * `reactive` is derived from the *code* rather than copied from the decision.
 * A replicator can report `decision: "reactive"` alongside a structural code
 * (observed on jinaga-replicator 3.7.7, issue #242), and the two disagree: the
 * decision predicts the feed will self-heal, while the code says the shapes
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
            reactive: d.decision === 'reactive' && !structuralDenialCodes.includes(d.code ?? ''),
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
 */
export function isStructuralDenial(diagnostic: DistributionDiagnostic): boolean {
    return !diagnostic.reactive
        && structuralDenialCodes.includes(diagnostic.code ?? '');
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
