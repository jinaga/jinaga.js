import { LabelOf, buildModel } from "../../../src/specification/model";
import { User } from "../../../src/model/user";

/**
 * The model and specifications behind `siblingConditionFeedSpec.ts` (#368): a
 * restoring branch followed by a sibling negative condition on the same match.
 *
 * They live here so the feed vectors and the spec file read one definition.
 */

export class Tenant {
    static Type = "Tenant" as const;
    type = Tenant.Type;
    constructor(public identifier: string) { }
}

export class Account {
    static Type = "Account" as const;
    type = Account.Type;
    constructor(public tenant: Tenant, public identifier: string) { }
}

export class Freeze {
    static Type = "Account.Freeze" as const;
    type = Freeze.Type;
    constructor(public account: Account) { }
}

export class Unfreeze {
    static Type = "Account.Unfreeze" as const;
    type = Unfreeze.Type;
    constructor(public freeze: Freeze) { }
}

export class Mirror {
    static Type = "Account.Mirror" as const;
    type = Mirror.Type;
    constructor(public account: Account, public region: string) { }
}

export class Retired {
    static Type = "Account.Mirror.Retired" as const;
    type = Retired.Type;
    constructor(public mirror: Mirror) { }
}

export class ServicePrincipal {
    static Type = "ServicePrincipal" as const;
    type = ServicePrincipal.Type;
    constructor(public tenant: Tenant, public user: User) { }

    static usersOf(tenant: LabelOf<Tenant>) {
        return tenant.successors(ServicePrincipal, sp => sp.tenant)
            .selectMany(sp => sp.user.predecessor());
    }
}

export const model = buildModel(b => b
    .type(User)
    .type(Tenant)
    .type(Account, x => x
        .predecessor("tenant", Tenant)
    )
    .type(Freeze, x => x
        .predecessor("account", Account)
    )
    .type(Unfreeze, x => x
        .predecessor("freeze", Freeze)
    )
    .type(Mirror, x => x
        .predecessor("account", Account)
    )
    .type(Retired, x => x
        .predecessor("mirror", Mirror)
    )
    .type(ServicePrincipal, x => x
        .predecessor("tenant", Tenant)
        .predecessor("user", User)
    )
);

// A freeze that has not been undone. Nested one level deep, so the branch that
// follows it lands on even parity and is a restoring feed.
const unrestoredFreeze = (a: LabelOf<Account>) => a.successors(Freeze, f => f.account)
    .notExists(f => f.successors(Unfreeze, u => u.freeze));

// A mirror that has not been retired. The same shape, as the sibling condition.
const currentMirror = (a: LabelOf<Account>) => a.successors(Mirror, m => m.account)
    .notExists(m => m.successors(Retired, r => r.mirror));

// Live accounts with no current mirror, in each of the two orders the two
// conditions can be written in. The order carries no meaning, so both have to
// produce feeds that carry the same facts.
export const needsMirror = model.given(Tenant).match(tenant =>
    tenant.successors(Account, a => a.tenant)
        .notExists(a => unrestoredFreeze(a))
        .notExists(a => currentMirror(a))
        .select(a => a.identifier)
);

export const needsMirrorSwapped = model.given(Tenant).match(tenant =>
    tenant.successors(Account, a => a.tenant)
        .notExists(a => currentMirror(a))
        .notExists(a => unrestoredFreeze(a))
        .select(a => a.identifier)
);

export const servicePrincipals = model.given(Tenant).match(tenant => ServicePrincipal.usersOf(tenant));
