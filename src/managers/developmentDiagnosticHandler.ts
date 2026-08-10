import { describeMissingGivens, ReadDiagnostic } from "./distributionDiagnostic";

/**
 * Upper bound on the dedupe set (issue #207 W7). A long-lived app in
 * development mode with dynamic specs/reasons would otherwise accumulate
 * distinct messages without bound; once the cap is reached the oldest entry is
 * evicted (FIFO — `Set` preserves insertion order). Eviction only means the
 * evicted message could be logged once more if it recurs, which is harmless for
 * a development aid.
 */
const MAX_DEDUP_ENTRIES = 1000;

/**
 * Create the default development-mode distribution-diagnostic handler
 * (issue #207 W7). Installed by `JinagaBrowser` when `developmentMode` is on, it
 * turns otherwise-silent distribution denials into deduplicated, actionable
 * console messages tiered by severity:
 *
 *  - `no-matching-rule` / `spec-more-restrictive-than-rule` → `console.error`
 *    (structural authoring errors that never self-heal),
 *  - any other non-reactive denial (`principal-excluded`, `not-authenticated`,
 *    or an unrecognized code) → `console.warn`,
 *  - any `reactive` decision → `console.info`
 *    (the pending-authorization race; will populate when the fact arrives).
 *
 * Writes straight to `console.*` rather than through `Trace` so the messages are
 * visible in development regardless of the configured tracer (the default
 * `NoOpTracer` would swallow them), and without flipping the global tracer on
 * and flooding the console with the library's internal traces.
 *
 * Deduplicated by message text (bounded — see `MAX_DEDUP_ENTRIES`) so a
 * long-lived subscription that re-reports the same feed does not spam the
 * console. (Clearing a `reactive` line once data flows is the
 * subscription-lifecycle concern handled separately in W9.)
 */
export function createDevelopmentDiagnosticHandler(): (diagnostic: ReadDiagnostic) => void {
    const seen = new Set<string>();
    return (diagnostic: ReadDiagnostic) => {
        const message = formatMessage(diagnostic);
        if (seen.has(message)) {
            return;
        }
        seen.add(message);
        // Bound the dedupe set: evict the oldest entry once over the cap.
        if (seen.size > MAX_DEDUP_ENTRIES) {
            seen.delete(seen.values().next().value as string);
        }

        // A clearing diagnostic (W9, and issue #232's given-found companion)
        // resolves an earlier line; always an informational, positive signal.
        if (diagnostic.cleared) {
            console.info(message);
        }
        // A given that could not have been supplied is an authoring or
        // lifecycle error, not a pending state: it will not self-heal on its
        // own, so it is reported at the same level as a structural denial
        // (issue #232). This is the channel that reaches a developer who never
        // awaits `loaded()` or registers `onDiagnostic`.
        else if (diagnostic.kind === 'given-not-found') {
            console.error(message);
        }
        else if (diagnostic.reactive) {
            console.info(message);
        }
        else if (diagnostic.code === 'no-matching-rule' || diagnostic.code === 'spec-more-restrictive-than-rule') {
            console.error(message);
        }
        else {
            console.warn(message);
        }
    };
}

function formatMessage(diagnostic: ReadDiagnostic): string {
    const spec = diagnostic.specification.trim();
    if (diagnostic.kind === 'given-not-found') {
        if (diagnostic.cleared) {
            return `[jinaga] The given fact is now in the local store; the specification can read from it. ` +
                `The earlier missing-given notice is resolved.\n${spec}`;
        }
        return `[jinaga] ${describeMissingGivens(diagnostic.references)} ` +
            `No replicator was consulted, so this specification returns empty because its starting point ` +
            `is absent, not because nothing matches. Save the fact, or check the hash.\n${spec}`;
    }
    if (diagnostic.cleared) {
        return `[jinaga] Specification is now authorized for the current user; ` +
            `data is flowing. The earlier pending-authorization notice is resolved.\n${spec}`;
    }
    if (diagnostic.reactive) {
        return `[jinaga] Specification is pending authorization for the current user; ` +
            `it will populate when the authorizing fact arrives.\n${spec}`;
    }
    switch (diagnostic.code) {
        case 'no-matching-rule':
            return `[jinaga] Specification has no distribution rule in the replicator. ` +
                `Add a share(...).with(...) rule for it. Results will remain empty until you do.\n${spec}`;
        case 'spec-more-restrictive-than-rule':
            return `[jinaga] Specification is narrower than its share rule (it adds a positive join). ` +
                `Distribution matches exact or predecessor-subset shapes only. Broaden the query or the rule.\n${spec}\n${diagnostic.reason}`;
        case 'principal-excluded':
            return `[jinaga] The logged-in user is not permitted to see this specification.\n${spec}`;
        case 'not-authenticated':
            return `[jinaga] No user is logged in, so this specification cannot be distributed.\n${spec}`;
        default:
            return `[jinaga] This specification is denied by distribution.\n${spec}\n${diagnostic.reason}`;
    }
}
