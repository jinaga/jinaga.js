import { DistributionRules } from "../../../src/distribution/distribution-rules";
import { buildModel } from "../../../src/specification/model";
import { User } from "../../../src/model/user";

/**
 * The model and specifications behind `intermediateProjectionFeedSpec.ts`
 * (#204): a distribution rule whose projection traverses *through* an
 * intermediate fact without exposing it as its own named component.
 */

export class Tenant {
    static Type = "Tenant" as const;
    type = Tenant.Type;
    constructor(public creator: User) { }
}

export class Administrator {
    static Type = "Administrator" as const;
    type = Administrator.Type;
    constructor(public tenant: Tenant, public user: User) { }
}

export class Event {
    static Type = "Event" as const;
    type = Event.Type;
    constructor(public tenant: Tenant, public id: string) { }
}

export class Competitor {
    static Type = "Competitor" as const;
    type = Competitor.Type;
    constructor(public tenant: Tenant) { }
}

// Finalist is the intermediate fact: the projection joins from Event to
// Finalist only to reach the Competitor predecessor; Finalist is never a
// named component of the projection.
export class Finalist {
    static Type = "Finalist" as const;
    type = Finalist.Type;
    constructor(public competitor: Competitor, public event: Event) { }
}

export class CompetitorName {
    static Type = "CompetitorName" as const;
    type = CompetitorName.Type;
    constructor(public competitor: Competitor, public value: string, public prior: CompetitorName[]) { }
}

export const model = buildModel(b => b
    .type(User)
    .type(Tenant, x => x.predecessor("creator", User))
    .type(Administrator, x => x
        .predecessor("tenant", Tenant)
        .predecessor("user", User)
    )
    .type(Event, x => x.predecessor("tenant", Tenant))
    .type(Competitor, x => x.predecessor("tenant", Tenant))
    .type(Finalist, x => x
        .predecessor("competitor", Competitor)
        .predecessor("event", Event)
    )
    .type(CompetitorName, x => x
        .predecessor("competitor", Competitor)
        .predecessor("prior", CompetitorName)
    )
);

// The share rule's target: the competitor names of an event's finalists,
// reached through the finalist without naming it.
export const competitorNamesOfFinalists = model.given(Event).select((event, facts) => ({
    // Finalist is only a traversal step toward the competitor projection.
    finalists: facts.ofType(Finalist)
        .join(finalist => finalist.event, event)
        .selectMany(finalist => finalist.competitor.predecessor()
            .select(competitor => ({
                competitorNames: facts.ofType(CompetitorName)
                    .join(name => name.competitor, competitor)
                    .notExists(name => facts.ofType(CompetitorName)
                        .join(next => next.prior, name)
                    )
            }))
        )
}));

// The intermediate fact, queried directly.
export const finalistsOfEvent = model.given(Event).match((event, facts) =>
    facts.ofType(Finalist).join(finalist => finalist.event, event)
);

export const administratorsOfEvent = model.given(Event).match((event, facts) =>
    facts.ofType(Administrator)
        .join(a => a.tenant, event.tenant)
        .selectMany(a => facts.ofType(User).join(u => u, a.user))
);

export const distribution = (r: DistributionRules) => r
    .share(competitorNamesOfFinalists)
    .with(administratorsOfEvent);
