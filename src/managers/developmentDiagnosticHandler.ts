import { DistributionDiagnostic } from "./distributionDiagnostic";

/**
 * Create the default development-mode distribution-diagnostic handler
 * (issue #207 W7). Installed by `JinagaBrowser` when `developmentMode` is on, it
 * turns otherwise-silent distribution denials into deduplicated, actionable
 * console messages tiered by severity:
 *
 *  - `no-matching-rule` / `spec-more-restrictive-than-rule` → `console.error`
 *    (structural authoring errors that never self-heal),
 *  - non-reactive `principal-excluded` → `console.warn`
 *    (the logged-in user is simply not permitted),
 *  - any `reactive` decision → `console.info`
 *    (the pending-authorization race; will populate when the fact arrives).
 *
 * Writes straight to `console.*` rather than through `Trace` so the messages are
 * visible in development regardless of the configured tracer (the default
 * `NoOpTracer` would swallow them), and without flipping the global tracer on
 * and flooding the console with the library's internal traces.
 *
 * Deduplicated by message text so a long-lived subscription that re-reports the
 * same feed does not spam the console. (Clearing a `reactive` line once data
 * flows is the subscription-lifecycle concern handled separately in W9.)
 */
export function createDevelopmentDiagnosticHandler(): (diagnostic: DistributionDiagnostic) => void {
    const seen = new Set<string>();
    return (diagnostic: DistributionDiagnostic) => {
        const message = formatMessage(diagnostic);
        if (seen.has(message)) {
            return;
        }
        seen.add(message);

        if (diagnostic.reactive) {
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

function formatMessage(diagnostic: DistributionDiagnostic): string {
    const spec = diagnostic.specification.trim();
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
