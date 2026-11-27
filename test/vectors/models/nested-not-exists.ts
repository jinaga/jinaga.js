import { LabelOf, buildModel } from "../../../src/specification/model";
import { User } from "../../../src/model/user";

/**
 * The model and specifications behind `nestedNotExistsFeedSpec.ts` (#242): two
 * fact types in one top-level match block, each carrying its own `notExists`,
 * the first of them nested one level deep.
 */

export class Tenant {
    static Type = "Tenant" as const;
    type = Tenant.Type;
    constructor(public identifier: string) { }
}

export class Event {
    static Type = "Event" as const;
    type = Event.Type;
    constructor(public tenant: Tenant, public id: string) { }

    static in(tenant: LabelOf<Tenant>) {
        return tenant.successors(Event, event => event.tenant)
            .notExists(event => event.successors(EventDelete, d => d.event)
                .notExists(d => d.successors(EventRestore, r => r.eventDelete)));
    }
}

export class EventDelete {
    static Type = "Event.Delete" as const;
    type = EventDelete.Type;
    constructor(public event: Event) { }
}

export class EventRestore {
    static Type = "Event.Restore" as const;
    type = EventRestore.Type;
    constructor(public eventDelete: EventDelete) { }
}

export class AttendeeAccessPath {
    static Type = "AttendeeAccessPath" as const;
    type = AttendeeAccessPath.Type;
    constructor(public event: Event, public code: string) { }

    static for(event: LabelOf<Event>) {
        return event.successors(AttendeeAccessPath, path => path.event);
    }

    static in(tenant: LabelOf<Tenant>) {
        return Event.in(tenant).selectMany(event => AttendeeAccessPath.for(event));
    }
}

export class AccessPathConfigured {
    static Type = "AttendeeAccessPath.Configured" as const;
    type = AccessPathConfigured.Type;
    constructor(public accessPath: AttendeeAccessPath) { }

    static for(accessPath: LabelOf<AttendeeAccessPath>) {
        return accessPath.successors(AccessPathConfigured, c => c.accessPath);
    }
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
    .type(Event, x => x
        .predecessor("tenant", Tenant)
    )
    .type(EventDelete, x => x
        .predecessor("event", Event)
    )
    .type(EventRestore, x => x
        .predecessor("eventDelete", EventDelete)
    )
    .type(AttendeeAccessPath, x => x
        .predecessor("event", Event)
    )
    .type(AccessPathConfigured, x => x
        .predecessor("accessPath", AttendeeAccessPath)
    )
    .type(ServicePrincipal, x => x
        .predecessor("tenant", Tenant)
        .predecessor("user", User)
    )
);

export const accessPathsToConfigure = model.given(Tenant).match(tenant =>
    AttendeeAccessPath.in(tenant)
        .notExists(accessPath => AccessPathConfigured.for(accessPath))
);

export const servicePrincipals = model.given(Tenant).match(tenant => ServicePrincipal.usersOf(tenant));

// The shape from issue #242 comment 1: a composite `select()` inside a
// `selectMany` chain, three hops deep.
export const accessPathsWithConfiguration = model.given(Tenant).match(tenant =>
    Event.in(tenant).selectMany(event =>
        AttendeeAccessPath.for(event).select(accessPath => ({
            accessPath,
            configured: AccessPathConfigured.for(accessPath)
        }))
    )
);
