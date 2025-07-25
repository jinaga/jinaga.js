import { validateSpecificationInvariant } from "../../src/specification/inverse";
import { Specification, Match, Label, PathCondition, ExistentialCondition } from "../../src/specification/specification";

describe("specification invariant validation", () => {
    it("should accept empty specification", () => {
        const specification: Specification = {
            given: [],
            matches: [],
            projection: { type: "composite", components: [] }
        };

        expect(() => validateSpecificationInvariant(specification)).not.toThrow();
        expect(validateSpecificationInvariant(specification)).toBe(true);
    });

    it("should accept specification with only givens", () => {
        const specification: Specification = {
            given: [{ name: "p1", type: "Company" }],
            matches: [],
            projection: { type: "composite", components: [] }
        };

        expect(() => validateSpecificationInvariant(specification)).not.toThrow();
        expect(validateSpecificationInvariant(specification)).toBe(true);
    });

    it("should accept specification with single match and no conditions", () => {
        const specification: Specification = {
            given: [{ name: "p1", type: "Company" }],
            matches: [
                {
                    unknown: { name: "u1", type: "Office" },
                    conditions: []
                }
            ],
            projection: { type: "fact", label: "u1" }
        };

        expect(() => validateSpecificationInvariant(specification)).not.toThrow();
        expect(validateSpecificationInvariant(specification)).toBe(true);
    });

    it("should accept valid specification with path conditions", () => {
        const pathCondition: PathCondition = {
            type: "path",
            rolesLeft: [{ name: "company", predecessorType: "Company" }],
            labelRight: "p1",
            rolesRight: []
        };

        const specification: Specification = {
            given: [{ name: "p1", type: "Company" }],
            matches: [
                {
                    unknown: { name: "u1", type: "Office" },
                    conditions: []
                },
                {
                    unknown: { name: "u2", type: "President" },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [{ name: "office", predecessorType: "Office" }],
                            labelRight: "u1",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: { type: "fact", label: "u2" }
        };

        expect(() => validateSpecificationInvariant(specification)).not.toThrow();
        expect(validateSpecificationInvariant(specification)).toBe(true);
    });

    it("should reject match with no conditions when not first", () => {
        const specification: Specification = {
            given: [{ name: "p1", type: "Company" }],
            matches: [
                {
                    unknown: { name: "u1", type: "Office" },
                    conditions: []
                },
                {
                    unknown: { name: "u2", type: "President" },
                    conditions: [] // This should fail - no conditions on second match
                }
            ],
            projection: { type: "fact", label: "u2" }
        };

        expect(() => validateSpecificationInvariant(specification))
            .toThrow("Match 1 for unknown 'u2' has no conditions. All matches except the first must have at least one path condition.");
    });

    it("should reject match with non-path first condition", () => {
        const existentialCondition: ExistentialCondition = {
            type: "existential",
            exists: true,
            matches: []
        };

        const specification: Specification = {
            given: [{ name: "p1", type: "Company" }],
            matches: [
                {
                    unknown: { name: "u1", type: "Office" },
                    conditions: []
                },
                {
                    unknown: { name: "u2", type: "President" },
                    conditions: [existentialCondition] // This should fail - first condition is not path
                }
            ],
            projection: { type: "fact", label: "u2" }
        };

        expect(() => validateSpecificationInvariant(specification))
            .toThrow("Match 1 for unknown 'u2' does not start with a path condition. The first condition must be a path condition that references a prior label.");
    });

    it("should reject path condition referencing unknown label", () => {
        const specification: Specification = {
            given: [{ name: "p1", type: "Company" }],
            matches: [
                {
                    unknown: { name: "u1", type: "Office" },
                    conditions: []
                },
                {
                    unknown: { name: "u2", type: "President" },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [{ name: "office", predecessorType: "Office" }],
                            labelRight: "u3", // This label doesn't exist
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: { type: "fact", label: "u2" }
        };

        expect(() => validateSpecificationInvariant(specification))
            .toThrow("Match 1 for unknown 'u2' has path condition referencing 'u3', but this label is not available. Available labels: [p1, u1]");
    });

    it("should accept path condition referencing given", () => {
        const specification: Specification = {
            given: [{ name: "p1", type: "Company" }],
            matches: [
                {
                    unknown: { name: "u1", type: "Office" },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [{ name: "company", predecessorType: "Company" }],
                            labelRight: "p1",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: { type: "fact", label: "u1" }
        };

        expect(() => validateSpecificationInvariant(specification)).not.toThrow();
        expect(validateSpecificationInvariant(specification)).toBe(true);
    });

    it("should accept path condition referencing earlier match", () => {
        const specification: Specification = {
            given: [{ name: "p1", type: "Company" }],
            matches: [
                {
                    unknown: { name: "u1", type: "Office" },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [{ name: "company", predecessorType: "Company" }],
                            labelRight: "p1",
                            rolesRight: []
                        }
                    ]
                },
                {
                    unknown: { name: "u2", type: "President" },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [{ name: "office", predecessorType: "Office" }],
                            labelRight: "u1",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: { type: "fact", label: "u2" }
        };

        expect(() => validateSpecificationInvariant(specification)).not.toThrow();
        expect(validateSpecificationInvariant(specification)).toBe(true);
    });

    it("should accept multiple path conditions in same match", () => {
        const specification: Specification = {
            given: [
                { name: "p1", type: "Company" },
                { name: "p2", type: "User" }
            ],
            matches: [
                {
                    unknown: { name: "u1", type: "Office" },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [{ name: "company", predecessorType: "Company" }],
                            labelRight: "p1",
                            rolesRight: []
                        }
                    ]
                },
                {
                    unknown: { name: "u2", type: "President" },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [{ name: "office", predecessorType: "Office" }],
                            labelRight: "u1",
                            rolesRight: []
                        },
                        {
                            type: "path",
                            rolesLeft: [{ name: "user", predecessorType: "User" }],
                            labelRight: "p2",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: { type: "fact", label: "u2" }
        };

        expect(() => validateSpecificationInvariant(specification)).not.toThrow();
        expect(validateSpecificationInvariant(specification)).toBe(true);
    });

    it("should reject later path condition referencing unavailable label", () => {
        const specification: Specification = {
            given: [{ name: "p1", type: "Company" }],
            matches: [
                {
                    unknown: { name: "u1", type: "Office" },
                    conditions: []
                },
                {
                    unknown: { name: "u2", type: "President" },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [{ name: "office", predecessorType: "Office" }],
                            labelRight: "u1",
                            rolesRight: []
                        },
                        {
                            type: "path",
                            rolesLeft: [{ name: "manager", predecessorType: "Manager" }],
                            labelRight: "u3", // This label doesn't exist
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: { type: "fact", label: "u2" }
        };

        expect(() => validateSpecificationInvariant(specification))
            .toThrow("Match 1 for unknown 'u2' has path condition referencing 'u3', but this label is not available. Available labels: [p1, u1, u2]");
    });
});