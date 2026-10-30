import { DistributionDiagnostic, isStructuralDenial } from "@src";
import { distributionDenialCodes } from "../../src/distribution/distribution-engine";

// Issue #229: the classifier `query` throws on is exported from the package
// root, so a consumer such as jinaga-react classifies diagnostics the same way.

function diagnostic(overrides: Partial<DistributionDiagnostic>): DistributionDiagnostic {
    return {
        operation: "query",
        specification: "",
        decision: "denied",
        reactive: false,
        reason: "",
        ...overrides
    };
}

describe("isStructuralDenial from the package root", () => {
    const structural = ["no-matching-rule", "spec-more-restrictive-than-rule"];

    it.each(distributionDenialCodes.map(code => [code]))("classifies a denied %s", code => {
        expect(isStructuralDenial(diagnostic({ code }))).toBe(structural.includes(code));
    });

    it("does not treat not-authenticated as structural, though an app must act on it", () => {
        expect(isStructuralDenial(diagnostic({ code: "not-authenticated" }))).toBe(false);
    });

    it("never treats a reactive diagnostic as structural", () => {
        expect(isStructuralDenial(diagnostic({ decision: "reactive", reactive: true, code: "no-matching-rule" }))).toBe(false);
    });

    it("does not treat a diagnostic with no code as structural", () => {
        expect(isStructuralDenial(diagnostic({ decision: "reactive", reactive: true }))).toBe(false);
    });
});
