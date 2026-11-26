import { LabelOf, buildModel } from "../../../src/specification/model";
import { User } from "../../../src/model/user";

/**
 * The model issue #241 describes in production, behind
 * `predecessorNotExistsDistributionSpec.ts`. The `notExists` predicate walks up
 * a predecessor edge the query never walked down: `Invitation` is reached
 * through `code`, so `invitation.accessPath` binds an `AccessPath` and an
 * `Event` that appear nowhere else in the specification.
 */

export class Tenant {
    static Type = "Example.Tenant" as const;
    type = Tenant.Type;
    constructor(public creator: User) { }
}

export class Event {
    static Type = "Example.Event" as const;
    type = Event.Type;
    constructor(public tenant: Tenant, public id: string) { }

    static in(tenant: LabelOf<Tenant>) {
        return tenant.successors(Event, e => e.tenant)
            .notExists(e => e.successors(EventDelete, d => d.event)
                .notExists(d => d.successors(EventRestore, r => r.eventDelete)));
    }
}

export class EventDelete {
    static Type = "Example.Event.Delete" as const;
    type = EventDelete.Type;
    constructor(public event: Event) { }
}

export class EventRestore {
    static Type = "Example.Event.Restore" as const;
    type = EventRestore.Type;
    constructor(public eventDelete: EventDelete) { }
}

export class AccessPath {
    static Type = "Example.AttendeeAccessPath" as const;
    type = AccessPath.Type;
    constructor(public event: Event, public id: string) { }
}

export class InvitationCode {
    static Type = "Example.AttendeeInvitationCode" as const;
    type = InvitationCode.Type;
    constructor(public tenant: Tenant, public id: string) { }
}

export class Invitation {
    static Type = "Example.AttendeeInvitation" as const;
    type = Invitation.Type;
    constructor(public code: InvitationCode, public accessPath: AccessPath) { }
}

export const model = buildModel(b => b
    .type(User)
    .type(Tenant, x => x.predecessor("creator", User))
    .type(Event, x => x.predecessor("tenant", Tenant))
    .type(EventDelete, x => x.predecessor("event", Event))
    .type(EventRestore, x => x.predecessor("eventDelete", EventDelete))
    .type(AccessPath, x => x.predecessor("event", Event))
    .type(InvitationCode, x => x.predecessor("tenant", Tenant))
    .type(Invitation, x => x
        .predecessor("code", InvitationCode)
        .predecessor("accessPath", AccessPath))
);

// The reporter's original: two `.predecessor()` hops, each its own match.
export const viaPredecessorNotExists = model.given(Tenant).match(tenant =>
    tenant.successors(InvitationCode, c => c.tenant)
        .selectMany(code => code.successors(Invitation, i => i.code))
        .notExists(invitation => invitation.accessPath.predecessor()
            .selectMany(accessPath => accessPath.event.predecessor()
                .selectMany(event => event.successors(EventDelete, d => d.event)
                    .notExists(d => d.successors(EventRestore, r => r.eventDelete))))));

// The same walk spelled compactly, as one path condition carrying two roles
// rather than two matches carrying one each. It reaches a different branch of
// `skeletonOfSpecification`, so it is pinned separately.
export const viaCompactPredecessorNotExists = model.given(Tenant).match(tenant =>
    tenant.successors(InvitationCode, c => c.tenant)
        .selectMany(code => code.successors(Invitation, i => i.code))
        .notExists(invitation => invitation.accessPath.event.predecessor()
            .selectMany(event => event.successors(EventDelete, d => d.event)
                .notExists(d => d.successors(EventRestore, r => r.eventDelete)))));

// The restructuring the reporter says fixed it: successors end to end, reusing
// the sibling specification that always distributed correctly.
export const viaSuccessors = model.given(Tenant).match(tenant =>
    Event.in(tenant)
        .selectMany(event => event.successors(AccessPath, p => p.event))
        .selectMany(accessPath => accessPath.successors(Invitation, i => i.accessPath)));
