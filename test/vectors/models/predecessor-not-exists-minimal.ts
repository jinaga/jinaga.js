import { buildModel } from "../../../src/specification/model";
import { User } from "../../../src/model/user";

/**
 * The minimal reproduction from issue #241, behind
 * `predecessorNotExistsDistributionSpec.ts`: a `notExists` predicate that walks
 * predecessors before it reaches a successor.
 */

export class Tenant {
    static Type = "Example.Tenant" as const;
    type = Tenant.Type;
    constructor(public creator: User) { }
}

export class Parent {
    static Type = "Example.Parent" as const;
    type = Parent.Type;
    constructor(public tenant: Tenant, public id: string) { }
}

export class ParentDeleted {
    static Type = "Example.Parent.Deleted" as const;
    type = ParentDeleted.Type;
    constructor(public parent: Parent, public deletedAt: string) { }
}

export class ParentRestored {
    static Type = "Example.Parent.Restored" as const;
    type = ParentRestored.Type;
    constructor(public deletion: ParentDeleted) { }
}

export class Child {
    static Type = "Example.Child" as const;
    type = Child.Type;
    constructor(public parent: Parent, public id: string) { }
}

export class Grandchild {
    static Type = "Example.Grandchild" as const;
    type = Grandchild.Type;
    constructor(public child: Child, public id: string) { }
}

export const model = buildModel(b => b
    .type(User)
    .type(Tenant, x => x.predecessor("creator", User))
    .type(Parent, x => x.predecessor("tenant", Tenant))
    .type(ParentDeleted, x => x.predecessor("parent", Parent))
    .type(ParentRestored, x => x.predecessor("deletion", ParentDeleted))
    .type(Child, x => x.predecessor("parent", Parent))
    .type(Grandchild, x => x.predecessor("child", Child))
);

// The issue's "works" variant: every notExists predicate calls only
// successors, and the predecessor walk happens outside any notExists.
export const viaSuccessors = model.given(Tenant).match(tenant =>
    tenant.successors(Parent, p => p.tenant)
        .notExists(parent => parent.successors(ParentDeleted, d => d.parent)
            .notExists(d => d.successors(ParentRestored, r => r.deletion)))
        .selectMany(parent => parent.successors(Child, c => c.parent))
        .selectMany(child => child.successors(Grandchild, g => g.child)));

// The issue's "fails" variant: the notExists predicate itself walks two
// predecessor hops before reaching successors.
export const viaPredecessorNotExists = model.given(Tenant).match(tenant =>
    tenant.successors(Parent, p => p.tenant)
        .selectMany(parent => parent.successors(Child, c => c.parent))
        .selectMany(child => child.successors(Grandchild, g => g.child))
        .notExists(grandchild => grandchild.child.predecessor()
            .selectMany(child => child.parent.predecessor()
                .selectMany(parent => parent.successors(ParentDeleted, d => d.parent)
                    .notExists(d => d.successors(ParentRestored, r => r.deletion))))));
