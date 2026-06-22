import { buildModel, getAllRoles, invertSpecification, Specification, User } from "@src";

describe("getAllRoles", () => {
    // Regression for jinaga/jinaga-replicator#52. When a positive existential
    // (.exists) is inverted, the resulting inverse can carry that existential on
    // its given, with an inner match that path-references a SIBLING match label
    // rather than the given itself. The Postgres store resolves role IDs through
    // getAllRoles, which previously seeded its label map with only the given
    // labels and threw "Label <name> not found" on such inverses — surfacing as
    // an HTTP 500 on /save. (The in-memory store never calls getAllRoles, which
    // is why JinagaTest did not reproduce it.)
    it("resolves an existential on the given that references a sibling match label", () => {
        const specification: Specification = {
            given: [{
                label: { name: "u3", type: "Redemption" },
                conditions: [{
                    type: "existential",
                    exists: true,
                    matches: [{
                        unknown: { name: "u4", type: "Receipt" },
                        conditions: [{
                            type: "path",
                            rolesLeft: [{ name: "request", predecessorType: "Request" }],
                            labelRight: "u2",
                            rolesRight: []
                        }]
                    }]
                }]
            }],
            matches: [{
                unknown: { name: "u2", type: "Request" },
                conditions: [{
                    type: "path",
                    rolesLeft: [],
                    labelRight: "u3",
                    rolesRight: [{ name: "request", predecessorType: "Request" }]
                }]
            }],
            projection: { type: "fact", label: "u2" }
        };

        expect(() => getAllRoles(specification)).not.toThrow();

        const roles = getAllRoles(specification);
        // The role referenced through the sibling label must be resolved with
        // the correct successor type (Receipt -> request -> Request).
        expect(roles).toContainEqual({
            successorType: "Receipt",
            name: "request",
            predecessorType: "Request"
        });
    });

    it("resolves roles for every inverse of a spec with a nested positive existential", () => {
        class Domain { static Type = "Domain" as const; type = Domain.Type; constructor(public identifier: string) { } }
        class Provisioner { static Type = "Provisioner" as const; type = Provisioner.Type; constructor(public user: User, public domain: Domain) { } }
        class Request { static Type = "Request" as const; type = Request.Type; constructor(public domain: Domain, public identifier: string) { } }
        class Redemption { static Type = "Redemption" as const; type = Redemption.Type; constructor(public request: Request) { } }
        class Receipt { static Type = "Receipt" as const; type = Receipt.Type; constructor(public request: Request) { } }

        const model = buildModel(m => m
            .type(User).type(Domain)
            .type(Provisioner, f => f.predecessor("user", User).predecessor("domain", Domain))
            .type(Request, f => f.predecessor("domain", Domain))
            .type(Redemption, f => f.predecessor("request", Request))
            .type(Receipt, f => f.predecessor("request", Request)));

        const specification = model.given(User).match((user, facts) =>
            facts.ofType(Provisioner).join(p => p.user, user)
                .selectMany(p => facts.ofType(Request).join(r => r.domain, p.domain)
                    .exists(r => facts.ofType(Redemption).join(red => red.request, r)
                        .exists(red => facts.ofType(Receipt).join(rc => rc.request, r)))));

        const inverses = invertSpecification(specification.specification);
        for (const inverse of inverses) {
            expect(() => getAllRoles(inverse.inverseSpecification)).not.toThrow();
        }
    });
});
