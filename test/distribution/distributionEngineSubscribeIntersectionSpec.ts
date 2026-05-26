import {
    dehydrateFact,
    DistributionEngine,
    DistributionRules,
    MemoryStore,
    User
} from "@src";
import { Administrator, Company, model } from "../companyModel";

// Direct coverage of `DistributionEngine.intersectForSubscribe` — the seam
// Phase 3 wires intersection through. Verifies that:
//  - already-authorized callers see the original (start, spec) untouched;
//  - unauthorized callers get a rewritten spec that carries the auth
//    pattern, plus a synthetic distributionUser ref appended to start.
describe("DistributionEngine.intersectForSubscribe", () => {
    const creator = new User("creator");
    const subscriber = new User("subscriber");
    const company = new Company(creator, "Co");

    const ruleUserSpec = model.given(Company).match((c, facts) =>
        facts.ofType(Administrator)
            .join(a => a.company, c)
            .selectMany(a => facts.ofType(User).join(u => u, a.user))
    );
    const shareSpec = model.given(Company).match((c, facts) =>
        facts.ofType(Administrator).join(a => a.company, c)
    );

    function makeEngine(seedAdmin: boolean): DistributionEngine {
        const store = new MemoryStore();
        const records = [
            ...dehydrateFact(creator),
            ...dehydrateFact(subscriber),
            ...dehydrateFact(company)
        ];
        if (seedAdmin) {
            records.push(...dehydrateFact(new Administrator(company, subscriber, new Date("2026-05-26"))));
        }
        store.save(records.map(r => ({ fact: r, signatures: [] })));
        const rules = new DistributionRules([])
            .share(shareSpec).with(ruleUserSpec);
        return new DistributionEngine(rules, store);
    }

    const spec = model.given(Company).match((c, facts) =>
        facts.ofType(Administrator).join(a => a.company, c)
    ).specification;
    const companyRef = dehydrateFact(company)[1]; // [0] is the creator User
    const subscriberRef = dehydrateFact(subscriber)[0];

    it("returns the original spec when the user is already authorized", async () => {
        const engine = makeEngine(/* seedAdmin */ true);
        const result = await engine.intersectForSubscribe(
            [companyRef],
            spec,
            subscriberRef
        );
        expect(result.intersected).toBe(false);
        expect(result.specification).toBe(spec);
        expect(result.start).toEqual([companyRef]);
    });

    it("intersects when the user is not yet authorized", async () => {
        const engine = makeEngine(/* seedAdmin */ false);
        const result = await engine.intersectForSubscribe(
            [companyRef],
            spec,
            subscriberRef
        );
        expect(result.intersected).toBe(true);
        // The synthetic distributionUser given is appended; the start carries
        // the user fact reference in matching position.
        expect(result.specification.given).toHaveLength(2);
        expect(result.specification.given[1].label.type).toBe(User.Type);
        expect(result.start).toHaveLength(2);
        expect(result.start[1]).toEqual({ type: subscriberRef.type, hash: subscriberRef.hash });
    });

    it("returns the original spec when no rule's shape matches the target", async () => {
        const engine = makeEngine(/* seedAdmin */ false);
        // A spec the rule doesn't cover at all (different fact type). The
        // engine has no business intersecting an unrelated spec — that would
        // change semantics for downstream evaluation — so it falls back.
        const otherSpec = model.given(Company).match((c, facts) =>
            facts.ofType(User).join(u => u, c.creator)
        ).specification;

        const result = await engine.intersectForSubscribe(
            [companyRef],
            otherSpec,
            subscriberRef
        );
        expect(result.intersected).toBe(false);
        expect(result.specification).toBe(otherSpec);
    });
});
