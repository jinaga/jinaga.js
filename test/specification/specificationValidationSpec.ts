import { DistributionRules, Match, Specification, SpecificationParser, buildFeeds, skeletonOfSpecification, validateSpecification } from "@src";
import { AuthorizationRuleSpecification } from "../../src/authorization/authorizationRules";

// Issue #226: a match whose only condition is a positive existential parses, but
// nothing can run it. `SpecificationRunner` starts a match by following its first
// path condition, and `skeletonOfSpecification` registers the match's label while
// it walks one, so a match with no path condition names no facts at all. The
// defect used to survive parsing and feed building, and only surfaced as
// "Label workspace not found" from deep inside skeleton building -- in
// `DistributionRules`' case, from a rule unrelated to the query being authorized.

function parse(text: string): Specification {
    const parser = new SpecificationParser(text);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

const existentialOnlyMatch = `(user: Some.User) {
    workspace: Some.Workspace [
        E {
            admin: Some.Administrator [
                admin->user: Some.User = user
                admin->workspace: Some.Workspace = workspace
            ]
        }
    ]
} => {
    name = workspace.name
}`;

// The same intent, written as a traversal: reach the administrators of the user,
// then take the workspace each one names as its predecessor.
const traversal = `(user: Some.User) {
    admin: Some.Administrator [
        admin->user: Some.User = user
    ]
    workspace: Some.Workspace [
        workspace = admin->workspace: Some.Workspace
    ]
} => {
    name = workspace.name
}`;

// Built by hand rather than parsed, standing in for a specification that a
// downstream authoring tool composed without going through the parser.
const workspaceMatch: Match = {
    unknown: { name: "workspace", type: "Some.Workspace" },
    conditions: [
        {
            type: "existential",
            exists: true,
            matches: [
                {
                    unknown: { name: "admin", type: "Some.Administrator" },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [{ name: "user", predecessorType: "Some.User" }],
                            labelRight: "user",
                            rolesRight: []
                        },
                        {
                            type: "path",
                            rolesLeft: [{ name: "workspace", predecessorType: "Some.Workspace" }],
                            labelRight: "workspace",
                            rolesRight: []
                        }
                    ]
                }
            ]
        }
    ]
};

const unbuildableSpecification: Specification = {
    given: [{ label: { name: "user", type: "Some.User" }, conditions: [] }],
    matches: [workspaceMatch],
    projection: { type: "fact", label: "workspace" }
};

describe("specification validation", () => {
    it("rejects a match whose only condition is an existential", () => {
        expect(() => parse(existentialOnlyMatch))
            .toThrow(/The match for 'workspace' has no path condition/);
    });

    it("rejects a match that begins with an existential condition", () => {
        expect(() => parse(`(user: Some.User) {
            workspace: Some.Workspace [
                E {
                    admin: Some.Administrator [
                        admin->user: Some.User = user
                        admin->workspace: Some.Workspace = workspace
                    ]
                }
                workspace->creator: Some.User = user
            ]
        }`)).toThrow(/The match for 'workspace' begins with an existential condition/);
    });

    it("rejects an unrooted match nested in an existential condition", () => {
        expect(() => parse(`(user: Some.User) {
            admin: Some.Administrator [
                admin->user: Some.User = user
                E {
                    workspace: Some.Workspace [
                        E {
                            other: Some.Administrator [
                                other->workspace: Some.Workspace = workspace
                                other->user: Some.User = user
                            ]
                        }
                    ]
                }
            ]
        }`)).toThrow(/The match for 'workspace' has no path condition/);
    });

    it("accepts the traversal that expresses the same intent", () => {
        const specification = parse(traversal);

        expect(validateSpecification(specification)).toEqual([]);
        for (const feed of buildFeeds(specification)) {
            expect(() => skeletonOfSpecification(feed)).not.toThrow();
        }
    });

    it("reports the defect in a specification that did not come from the parser", () => {
        const errors = validateSpecification(unbuildableSpecification);

        expect(errors.length).toBe(1);
        expect(errors[0]).toMatch(/The match for 'workspace' has no path condition/);
    });

    it("reports the defect in a match of a projection", () => {
        const errors = validateSpecification({
            given: [{ label: { name: "user", type: "Some.User" }, conditions: [] }],
            matches: [
                {
                    unknown: { name: "admin", type: "Some.Administrator" },
                    conditions: [
                        {
                            type: "path",
                            rolesLeft: [{ name: "user", predecessorType: "Some.User" }],
                            labelRight: "user",
                            rolesRight: []
                        }
                    ]
                }
            ],
            projection: {
                type: "composite",
                components: [
                    {
                        type: "specification",
                        name: "workspaces",
                        matches: [workspaceMatch],
                        projection: { type: "fact", label: "workspace" }
                    }
                ]
            }
        });

        expect(errors.length).toBe(1);
        expect(errors[0]).toMatch(/The match for 'workspace' has no path condition/);
    });

    it("finds nothing wrong with a sound specification", () => {
        expect(validateSpecification(parse(`(user: Some.User) {
            admin: Some.Administrator [
                admin->user: Some.User = user
                !E {
                    revoked: Some.Administrator.Revoked [
                        revoked->admin: Some.Administrator = admin
                    ]
                }
            ]
        }`))).toEqual([]);
    });

    it("would have built the skeleton of the feed, had the specification been sound", () => {
        // The shape of the failure this validation prevents. `buildFeeds` flattens
        // the positive existential, leaving a `workspace` match with no conditions
        // at all, which skeleton building cannot root.
        const feeds = buildFeeds(unbuildableSpecification);

        expect(feeds.length).toBeGreaterThan(0);
        expect(() => feeds.forEach(feed => skeletonOfSpecification(feed)))
            .toThrow("Label workspace not found. Known labels: user, admin");
    });
});

describe("rules that carry a specification", () => {
    it("refuses to load a distribution rule that cannot be built", () => {
        // The rule from the issue: it was accepted at load time, and every
        // subsequent authorization -- including of queries that had nothing to do
        // with this rule -- threw from `canAuthorizeByComposition`.
        expect(() => DistributionRules.combine(DistributionRules.empty, unbuildableSpecification, null))
            .toThrow(/The specification of a distribution rule is not valid\. The match for 'workspace' has no path condition/);
    });

    it("refuses to load a distribution rule whose user specification cannot be built", () => {
        expect(() => DistributionRules.combine(DistributionRules.empty, parse(traversal), unbuildableSpecification))
            .toThrow(/The user specification of a distribution rule is not valid/);
    });

    it("refuses to load a distribution policy that contains one", () => {
        expect(() => DistributionRules.loadFromDescription(`distribution {
            share ${existentialOnlyMatch}
            with everyone
        }`)).toThrow(/The match for 'workspace' has no path condition/);
    });

    it("still loads a sound distribution policy", () => {
        const rules = DistributionRules.loadFromDescription(`distribution {
            share ${traversal}
            with everyone
        }`);

        expect(rules.rules.length).toBe(1);
        for (const feed of rules.rules[0].feeds) {
            expect(() => skeletonOfSpecification(feed)).not.toThrow();
        }
    });

    it("refuses to build an authorization rule that cannot be run", () => {
        expect(() => new AuthorizationRuleSpecification(unbuildableSpecification))
            .toThrow(/The specification of an authorization rule is not valid/);
    });
});
