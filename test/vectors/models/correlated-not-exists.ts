import { buildModel } from "../../../src/specification/model";
import { User } from "../../../src/model/user";

/**
 * The model and specification behind `correlatedNotExistsRetractionSpec.ts`
 * (#242 comment 3): a `notExists` correlated on two predecessors.
 */

export class Tenant {
    static Type = "Tenant" as const;
    type = Tenant.Type;
    constructor(public identifier: string) { }
}

export class AccessPath {
    static Type = "AccessPath" as const;
    type = AccessPath.Type;
    constructor(public tenant: Tenant, public code: string) { }
}

export class EventName {
    static Type = "EventName" as const;
    type = EventName.Type;
    constructor(public tenant: Tenant, public value: string, public prior: EventName[]) { }
}

export class Synced {
    static Type = "Synced" as const;
    type = Synced.Type;
    constructor(public accessPath: AccessPath, public eventName: EventName, public at: Date | string) { }
}

export const model = buildModel(b => b
    .type(User)
    .type(Tenant)
    .type(AccessPath, x => x
        .predecessor("tenant", Tenant)
    )
    .type(EventName, x => x
        .predecessor("tenant", Tenant)
        .predecessor("prior", EventName)
    )
    .type(Synced, x => x
        .predecessor("accessPath", AccessPath)
        .predecessor("eventName", EventName)
    )
);

// "access path / current event name pairs that have not been synced yet"
export const toSync = model.given(Tenant).match((tenant, facts) =>
    facts.ofType(AccessPath).join(accessPath => accessPath.tenant, tenant)
        .selectMany(accessPath => facts.ofType(EventName).join(name => name.tenant, tenant)
            .notExists(name => facts.ofType(EventName).join(next => next.prior, name))
            .notExists(name => facts.ofType(Synced)
                .join(synced => synced.eventName, name)
                .join(synced => synced.accessPath, accessPath))
            .select(name => ({ accessPath, name }))));
