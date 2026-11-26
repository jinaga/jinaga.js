import { LabelOf, buildModel } from "../../../src/specification/model";
import { User } from "../../../src/model/user";

/**
 * The model and specifications behind `positiveExistentialBranchFeedSpec.ts`
 * (#372): a restoring branch nested inside a positive existential condition.
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

export class Reinstated {
    static Type = "Account.Mirror.Reinstated" as const;
    type = Reinstated.Type;
    constructor(public retired: Retired) { }
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
    .type(Mirror, x => x
        .predecessor("account", Account)
    )
    .type(Retired, x => x
        .predecessor("mirror", Mirror)
    )
    .type(Reinstated, x => x
        .predecessor("retired", Retired)
    )
    .type(ServicePrincipal, x => x
        .predecessor("tenant", Tenant)
        .predecessor("user", User)
    )
);

// A mirror still in service: retired, unless that retirement was reinstated.
// The negative condition is nested one level inside the positive existential,
// so the branch that follows it lands on even parity and is a restoring feed.
const mirrorInService = (a: LabelOf<Account>) => a.successors(Mirror, m => m.account)
    .notExists(m => m.successors(Retired, r => r.mirror)
        .notExists(r => r.successors(Reinstated, x => x.retired)));

const freezesOf = (a: LabelOf<Account>) => a.successors(Freeze, f => f.account);

// Accounts that have a mirror in service and are not frozen, in each of the two
// orders the two conditions can be written in. The order carries no meaning, so
// both have to produce feeds that carry the same facts.
export const servedAndUnfrozen = model.given(Tenant).match(tenant =>
    tenant.successors(Account, a => a.tenant)
        .exists(a => mirrorInService(a))
        .notExists(a => freezesOf(a))
        .select(a => a.identifier)
);

export const servedAndUnfrozenSwapped = model.given(Tenant).match(tenant =>
    tenant.successors(Account, a => a.tenant)
        .notExists(a => freezesOf(a))
        .exists(a => mirrorInService(a))
        .select(a => a.identifier)
);

// The same specification, projecting a component collection over the account.
// The restoring branch was handed `[]` for projection components, so the feeds
// of the collection were never built from it.
export const servedAndUnfrozenWithRegions = model.given(Tenant).match(tenant =>
    tenant.successors(Account, a => a.tenant)
        .exists(a => mirrorInService(a))
        .notExists(a => freezesOf(a))
        .select(a => ({
            identifier: a.identifier,
            regions: a.successors(Mirror, m => m.account).select(m => m.region)
        }))
);

export const servicePrincipals = model.given(Tenant).match(tenant => ServicePrincipal.usersOf(tenant));
