import { JinagaTest, User, buildFeeds, buildModel, invertSpecification } from "@src";
import { isExistentialCondition } from "../../src/specification/specification";

// Issue #242 comment 3 reports a write-amplification loop: a subscription whose
// `notExists` is correlated on TWO predecessors never recognizes the completion
// fact it just wrote, so the handler re-fires and writes another one, forever.
// That would be a retraction-completeness failure — the inverse engine failing
// to notify that a row left the result set.
//
// These tests pin the behaviour that must hold for that not to happen. They all
// pass, so the loop's mechanism lies elsewhere (the replicator, which JinagaTest
// does not exercise). They exist so a future change cannot break what works.

class Tenant {
    static Type = "Tenant" as const;
    type = Tenant.Type;
    constructor(public identifier: string) { }
}

class AccessPath {
    static Type = "AccessPath" as const;
    type = AccessPath.Type;
    constructor(public tenant: Tenant, public code: string) { }
}

class EventName {
    static Type = "EventName" as const;
    type = EventName.Type;
    constructor(public tenant: Tenant, public value: string, public prior: EventName[]) { }
}

class Synced {
    static Type = "Synced" as const;
    type = Synced.Type;
    constructor(public accessPath: AccessPath, public eventName: EventName, public at: Date | string) { }
}

const model = buildModel(b => b
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
const toSync = model.given(Tenant).match((tenant, facts) =>
    facts.ofType(AccessPath).join(accessPath => accessPath.tenant, tenant)
        .selectMany(accessPath => facts.ofType(EventName).join(name => name.tenant, tenant)
            .notExists(name => facts.ofType(EventName).join(next => next.prior, name))
            .notExists(name => facts.ofType(Synced)
                .join(synced => synced.eventName, name)
                .join(synced => synced.accessPath, accessPath))
            .select(name => ({ accessPath, name }))));

describe("retraction of a notExists correlated on two predecessors", () => {
    it("produces a remove inverse given the completion fact", () => {
        const inverses = invertSpecification(toSync.specification);
        const retraction = inverses.filter(inverse =>
            inverse.operation === "remove" &&
            inverse.inverseSpecification.given[0].label.type === Synced.Type);
        expect(retraction).toHaveLength(1);
    });

    it("carries both join conditions into the excluding feed", () => {
        const excluding = buildFeeds(toSync.specification)
            .flatMap(feed => feed.matches)
            .filter(match => match.unknown.type === Synced.Type);
        expect(excluding).toHaveLength(1);
        expect(excluding[0].conditions.filter(c => c.type === "path")).toHaveLength(2);
    });

    it("keeps every feed to a single level of negation", () => {
        for (const feed of buildFeeds(toSync.specification)) {
            for (const match of feed.matches) {
                for (const condition of match.conditions.filter(isExistentialCondition)) {
                    for (const inner of condition.matches) {
                        expect(inner.conditions.filter(isExistentialCondition)).toEqual([]);
                    }
                }
            }
        }
    });

    it("retracts the row when the completion fact arrives", async () => {
        const j = JinagaTest.create({ model });
        const tenant = await j.fact(new Tenant("tenant-1"));
        const accessPath = await j.fact(new AccessPath(tenant, "code-1"));
        const name = await j.fact(new EventName(tenant, "Launch", []));

        const live: string[] = [];
        const observer = j.watch(toSync, tenant, row => {
            const key = j.hash(row.name);
            live.push(key);
            return () => { live.splice(live.indexOf(key), 1); };
        });
        await observer.loaded();
        expect(live).toHaveLength(1);

        await j.fact(new Synced(accessPath, name, new Date(1)));
        observer.stop();

        expect(live).toEqual([]);
    });

    it("adds and retracts exactly once per revision", async () => {
        const j = JinagaTest.create({ model });
        const tenant = await j.fact(new Tenant("tenant-1"));
        const accessPath = await j.fact(new AccessPath(tenant, "code-1"));
        const first = await j.fact(new EventName(tenant, "Launch", []));

        const notifications: string[] = [];
        const observer = j.watch(toSync, tenant, row => {
            notifications.push("add");
            return () => { notifications.push("remove"); };
        });
        await observer.loaded();

        await j.fact(new Synced(accessPath, first, new Date(1)));
        const second = await j.fact(new EventName(tenant, "Launch Party", [first]));
        await j.fact(new Synced(accessPath, second, new Date(2)));
        observer.stop();

        expect(notifications).toEqual(["add", "remove", "add", "remove"]);
    });

    it("does not re-fire when a second completion fact arrives for the same pair", async () => {
        const j = JinagaTest.create({ model });
        const tenant = await j.fact(new Tenant("tenant-1"));
        const accessPath = await j.fact(new AccessPath(tenant, "code-1"));
        const name = await j.fact(new EventName(tenant, "Launch", []));

        const notifications: string[] = [];
        const observer = j.watch(toSync, tenant, () => {
            notifications.push("add");
            return () => { notifications.push("remove"); };
        });
        await observer.loaded();

        // Each Synced fact is distinct — a different timestamp is a different fact.
        await j.fact(new Synced(accessPath, name, new Date(1)));
        await j.fact(new Synced(accessPath, name, new Date(2)));
        await j.fact(new Synced(accessPath, name, new Date(3)));
        observer.stop();

        expect(notifications).toEqual(["add", "remove"]);
    });
});
