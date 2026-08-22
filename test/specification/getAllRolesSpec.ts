import { buildModel, getAllRoles, invertSpecification, User } from "@src";
import { expectWellOrdered } from "./specificationTestHelpers";

describe("getAllRoles", () => {
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
            expectWellOrdered(inverse.inverseSpecification);
            expect(() => getAllRoles(inverse.inverseSpecification)).not.toThrow();
        }
    });
});
