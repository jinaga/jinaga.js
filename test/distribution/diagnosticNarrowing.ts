import { DistributionDiagnostic, GivenNotFoundDiagnostic, ReadDiagnostic } from "@src";

/**
 * Narrow a diagnostic from the shared read channel to a distribution decision.
 *
 * Issue #232 widened that channel from `DistributionDiagnostic` to the
 * `ReadDiagnostic` union, so a test that means to assert on per-feed fields
 * has to say so. Failing loudly here beats a cast: if a given-not-found
 * diagnostic ever turns up where a distribution decision was expected, that is
 * a real defect the test should catch rather than paper over.
 */
export function asDistribution(diagnostic: ReadDiagnostic): DistributionDiagnostic {
    if (diagnostic.kind !== "distribution") {
        throw new Error(`Expected a distribution diagnostic, but received '${diagnostic.kind}'.`);
    }
    return diagnostic;
}

/**
 * The mirror of `asDistribution` for the given-not-found variant.
 */
export function asGivenNotFound(diagnostic: ReadDiagnostic): GivenNotFoundDiagnostic {
    if (diagnostic.kind !== "given-not-found") {
        throw new Error(`Expected a given-not-found diagnostic, but received '${diagnostic.kind}'.`);
    }
    return diagnostic;
}
