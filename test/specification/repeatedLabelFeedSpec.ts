import { DistributionRules, MemoryStore, Specification, SpecificationOf, buildFeeds, skeletonOfSpecification, validateSpecification, wellFormedErrors } from "@src";
import { DistributionEngine } from "../../src/distribution/distribution-engine";
import { repeatedLabelWithNext, repeatedLabelWithNextRespelled, repeatedLabelWithoutNext, repeatedLabelWithoutNextRespelled } from "../vectors/feed-cases";

// Issue #426: a label declared inside a negative condition and declared again
// by a child specification ended up twice in one feed, because `buildFeeds`
// joins a descendant's matches into one feed. The feed failed jinaga.js's own
// well-formedness check and its skeleton could not be built, so no share rule
// over the specification could be written.
//
// The specifications these tests pass to `buildFeeds` are written in
// `test/vectors/feed-cases.ts`, which is also where `npm run vectors` reads
// them from (#387).

const variants: [string, Specification, Specification][] = [
    ["with !E { next }", repeatedLabelWithNext, repeatedLabelWithNextRespelled],
    ["without !E { next }", repeatedLabelWithoutNext, repeatedLabelWithoutNextRespelled]
];

describe("feeds of a specification that repeats a label in one descendant", () => {
    it.each(variants)("are well formed and have skeletons, %s", (_, specification) => {
        const feeds = buildFeeds(specification);
        expect(feeds.length).toBeGreaterThan(0);
        for (const feed of feeds) {
            expect(validateSpecification(feed).concat(wellFormedErrors(feed))).toEqual([]);
            expect(() => skeletonOfSpecification(feed)).not.toThrow();
        }
    });

    // The second target spells the child's label `rate`. It means the same,
    // so the rule must authorize it too. Before the fix, without `!E { next }`,
    // the rule's feed reused the `Rehired` fact as the `Rate` and so did not
    // match the correctly shaped feed of the second spelling.
    it.each(variants)("can be shared with everyone, %s", async (_, specification, respelled) => {
        const rules = DistributionRules.empty
            .share(new SpecificationOf<unknown, unknown>(specification))
            .withEveryone();
        const engine = new DistributionEngine(rules, new MemoryStore(), false);
        const start = { r: { type: "Restaurant", hash: "r" } };
        expect((await engine.canDistributeToAll(buildFeeds(specification), start, null)).type).toBe("success");
        expect((await engine.canDistributeToAll(buildFeeds(respelled), start, null)).type).toBe("success");
    });
});
