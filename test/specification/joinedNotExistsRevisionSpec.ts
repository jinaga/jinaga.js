import { buildModel, Condition, describeSpecification, invertSpecification, Jinaga, JinagaTest, LabelOf, Match, Specification, User } from "@src";

// Issue #238: a `notExists` correlated on TWO predecessors via `.join()` crashes an
// already-running subscription with "The label u1 is not defined" when a second
// revision of the joined predecessor arrives.
//
// Root <- Item (fixed identity) <- Value (mutable, revisioned through `prior`).
// Synced is a completion fact correlated on BOTH Item and Value: "has this item been
// synced for THIS SPECIFIC value revision".

class Root {
    static Type = "Test.Root" as const;
    type = Root.Type;
    constructor(public creator: User) { }
}

class Item {
    static Type = "Test.Item" as const;
    type = Item.Type;
    constructor(public root: Root, public id: string) { }

    static in(root: LabelOf<Root>) {
        return root.successors(Item, i => i.root);
    }
}

class Value {
    static Type = "Test.Value" as const;
    type = Value.Type;
    constructor(public item: Item, public value: string, public prior: Value[]) { }

    static current(item: LabelOf<Item>) {
        return item.successors(Value, v => v.item)
            .notExists(v => v.successors(Value, next => next.prior));
    }
}

class Synced {
    static Type = "Test.Synced" as const;
    type = Synced.Type;
    constructor(public item: Item, public value: Value, public syncedAt: Date | string) { }

    static for(item: LabelOf<Item>, value: LabelOf<Value>) {
        return item.successors(Synced, s => s.item).join(s => s.value, value);
    }
}

const model = buildModel(b => b
    .type(Root, x => x
        .predecessor("creator", User)
    )
    .type(Item, x => x
        .predecessor("root", Root)
    )
    .type(Value, x => x
        .predecessor("item", Item)
        .predecessor("prior", Value)
    )
    .type(Synced, x => x
        .predecessor("item", Item)
        .predecessor("value", Value)
    )
);

// "Items whose current Value has not been synced yet."
const specification = model.given(Root).match(root =>
    Item.in(root).selectMany(item =>
        Value.current(item)
            .notExists(value => Synced.for(item, value))
            .select(value => ({
                itemId: item.id,
                value: value.value
            }))
    )
);

describe("joined notExists across a fact revision", () => {
    let creator: User;
    let root: Root;
    let item: Item;
    let j: Jinaga;

    beforeEach(() => {
        creator = new User("--- KEY ---");
        root = new Root(creator);
        item = new Item(root, "item-1");
        j = JinagaTest.create({
            model,
            initialState: [creator, root, item],
            user: creator
        });
    });

    it("delivers the second revision to a running subscription", async () => {
        const delivered: string[] = [];
        const observer = j.watch(specification, root, result => {
            delivered.push(result.value);
            return () => {
                const index = delivered.indexOf(result.value);
                if (index >= 0) {
                    delivered.splice(index, 1);
                }
            };
        });
        await observer.loaded();
        expect(delivered).toEqual([]);

        // First revision: delivered correctly today.
        const v1 = new Value(item, "v1", []);
        await j.fact(v1);
        expect(delivered).toEqual(["v1"]);

        // Second revision, superseding v1 through `prior`. This is what crashes the
        // already-running subscription.
        await j.fact(new Value(item, "v2", [v1]));
        expect(delivered).toEqual(["v2"]);

        observer.stop();
    });

    it("still applies the joined notExists as a filter after a revision", async () => {
        const delivered: string[] = [];
        const observer = j.watch(specification, root, result => {
            delivered.push(result.value);
            return () => {
                const index = delivered.indexOf(result.value);
                if (index >= 0) {
                    delivered.splice(index, 1);
                }
            };
        });
        await observer.loaded();

        const v1 = new Value(item, "v1", []);
        await j.fact(v1);
        const v2 = new Value(item, "v2", [v1]);
        await j.fact(v2);
        expect(delivered).toEqual(["v2"]);

        // Syncing the current revision removes it from the result set.
        await j.fact(new Synced(item, v2, new Date(2026, 1, 1)));
        expect(delivered).toEqual([]);

        observer.stop();
    });

    it("matches the result of a one-shot query", async () => {
        const v1 = new Value(item, "v1", []);
        const v2 = new Value(item, "v2", [v1]);
        const client = JinagaTest.create({
            model,
            initialState: [creator, root, item, v1, v2],
            user: creator
        });

        const results = await client.query(specification, root);
        expect(results.map(r => r.value)).toEqual(["v2"]);
    });
});

describe("inversion of a joined notExists", () => {
    it("places the condition on the match that binds its labels", () => {
        const inverses = invertSpecification(specification.specification);

        // The inverse taken on the superseding Value. `shakeTree` puts u3 first, which
        // pushes u1 after u2, so the Synced condition has to travel with u1.
        const inverse = inverses.find(i =>
            i.inverseSpecification.given[0].label.type === Value.Type &&
            i.operation === "remove");
        expect(inverse).toBeDefined();

        expect(formatInverse(inverse!.inverseSpecification)).toBe(`
            (u3: Test.Value) {
                u2: Test.Value [
                    u2 = u3->prior: Test.Value
                ]
                u1: Test.Item [
                    u1 = u2->item: Test.Item
                    !E {
                        u4: Test.Synced [
                            u4->item: Test.Item = u1
                            u4->value: Test.Value = u2
                        ]
                    }
                ]
                p1: Test.Root [
                    p1 = u1->root: Test.Root
                ]
            } => {
                itemId = u1.id
                value = u2.value
            }`);
    });

    it("produces only well-ordered inverses", () => {
        for (const inverse of invertSpecification(specification.specification)) {
            expectWellOrdered(inverse.inverseSpecification);
        }
    });
});

/**
 * Render an inverse the way inverseSpec.ts does, so that the golden string reads as
 * an indented block with no trailing newline.
 */
function formatInverse(specification: Specification): string {
    const description = describeSpecification(specification, 3);
    return "\n" + description.substring(0, description.length - 1);
}

/**
 * Every label that a condition references must be bound by the given or by an
 * earlier match. SpecificationRunner throws "The label X is not defined" otherwise.
 */
function expectWellOrdered(specification: Specification) {
    const bound = new Set<string>(specification.given.map(g => g.label.name));
    for (const given of specification.given) {
        for (const condition of given.conditions) {
            expectLabelsBound(condition, bound, given.label.name);
        }
    }
    for (const match of specification.matches) {
        bound.add(match.unknown.name);
        for (const condition of match.conditions) {
            expectLabelsBound(condition, bound, match.unknown.name);
        }
    }
}

function expectLabelsBound(condition: Condition, bound: Set<string>, owner: string) {
    if (condition.type === "path") {
        if (!bound.has(condition.labelRight)) {
            throw new Error(`Condition on ${owner} references unbound label ${condition.labelRight}. ` +
                `Bound: [${Array.from(bound).join(", ")}]`);
        }
    }
    else {
        expectMatchesBound(condition.matches, bound, owner);
    }
}

function expectMatchesBound(matches: Match[], bound: Set<string>, owner: string) {
    const inner = new Set<string>(bound);
    for (const match of matches) {
        inner.add(match.unknown.name);
        for (const condition of match.conditions) {
            expectLabelsBound(condition, inner, owner);
        }
    }
}
