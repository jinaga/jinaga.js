import { AuthorizationRuleError, AuthorizationRules, FactRepository, LabelOf, User, describeAuthorizationRules } from "@src";
import { Owner, Workspace, model as linkModel } from "../linkModel";

// A rule whose first match seeks successors of the given: only an owner of the
// workspace may author it. Nothing precedes that match and it walks no
// predecessor, so the head has no matches, and the tail is given the
// workspace itself. A rule runs while its fact is being authorized, before the
// fact is saved, so that tail reads nothing and the rule admits nobody. It is
// refused where it is written rather than silently refusing every write.

const rule = (workspace: LabelOf<Workspace>, facts: FactRepository) =>
    facts.ofType(Owner)
        .join(o => o.workspace, workspace)
        .selectMany(o => facts.ofType(User)
            .join(u => u, o.user));

const authorization = (a: AuthorizationRules) => a
    .any(User)
    .any(Owner)
    .type(Workspace, rule);

describe("Authorization of a rule whose first match seeks successors of the given", () => {
    it("should refuse the rule where it is written", () => {
        expect(() => authorization(new AuthorizationRules(linkModel)))
            .toThrow(AuthorizationRuleError);
        expect(() => authorization(new AuthorizationRules(linkModel)))
            .toThrow(/reads 'p1' from the store: it seeks successors of 'p1'/);
    });

    it("should refuse the same rule loaded from a description", () => {
        // The description is built without constructing the rule, and parsed
        // back through the third place a rule is built.
        const description = `authorization {
    any Jinaga.User
    any Owner
    (p1: Workspace) {
        u1: Owner [
            u1->workspace: Workspace = p1
        ]
        u2: Jinaga.User [
            u2 = u1->user: Jinaga.User
        ]
    } => u2
}
`;

        expect(() => AuthorizationRules.loadFromDescription(description))
            .toThrow(AuthorizationRuleError);
    });

    it("should accept a rule that walks only predecessors of the given", () => {
        // The same intent, written against the creator instead of the owners,
        // has no tail and is accepted.
        const rules = describeAuthorizationRules(linkModel, a => a
            .type(Workspace, workspace => workspace.creator));

        expect(rules).toContain("(p1: Workspace)");
    });
});
