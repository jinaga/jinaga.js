import { JinagaTest, buildFeeds, invertSpecification } from "@src";
import { isExistentialCondition } from "../../src/specification/specification";
import { AccessPath, EventName, Synced, Tenant, model, toSync } from "../vectors/models/correlated-not-exists";

// The model and the specification are written in
// `test/vectors/models/correlated-not-exists.ts`, which is also where
// `npm run vectors` reads them from (#387).
//
// Issue #242 comment 3 reports a write-amplification loop: a subscription whose
// `notExists` is correlated on TWO predecessors never recognizes the completion
// fact it just wrote, so the handler re-fires and writes another one, forever.
// That would be a retraction-completeness failure — the inverse engine failing
// to notify that a row left the result set.
//
// These tests pin the behaviour that must hold for that not to happen. They all
// pass, so the loop's mechanism lies elsewhere (the replicator, which JinagaTest
// does not exercise). They exist so a future change cannot break what works.

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
