import { Condition, describeSpecification, invertSpecification, Match, Specification, SpecificationParser } from "@src";

function parseSpecification(input: string): Specification {
    const parser = new SpecificationParser(input);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

function roundTrip(specification: Specification): Specification {
    return parseSpecification(describeSpecification(specification, 0));
}

// An item is shown while its root has no lock. The negative condition on the
// item joins the given that the item also joins, and does not join the item
// itself. `wellFormedErrors` accepts that, as does jinaga-spec's `isWellFormed`,
// and `detectDisconnectedSpecification` accepts it because a negative
// condition's matches are filters that no feed carries as a product. The parser
// used to refuse the text, so `describeSpecification` wrote a specification
// that `parseSpecification` could not read back.
const itemWithNoLock = `(r: Root) {
    b: Item [
        b->root: Root = r
        !E {
            a: Lock [
                a->root: Root = r
            ]
        }
    ]
} => b`;

const path = (name: string, predecessorType: string, labelRight: string): Condition => ({
    type: "path",
    rolesLeft: [{ name, predecessorType }],
    labelRight,
    rolesRight: []
});

const match = (name: string, type: string, ...conditions: Condition[]): Match => ({
    unknown: { name, type },
    conditions
});

const itemWithNoLockObject: Specification = {
    given: [{ label: { name: "r", type: "Root" }, conditions: [] }],
    matches: [
        match("b", "Item",
            path("root", "Root", "r"),
            {
                type: "existential",
                exists: false,
                matches: [match("a", "Lock", path("root", "Root", "r"))]
            }
        )
    ],
    projection: { type: "fact", label: "b" }
};

describe("An existential condition that joins only a given", () => {
    it("reads back the text it is described as", () => {
        const specification = parseSpecification(itemWithNoLock);

        expect(roundTrip(specification)).toEqual(specification);
    });

    it("describes the specification built as an object to text that parses back to it", () => {
        expect(roundTrip(itemWithNoLockObject)).toEqual(itemWithNoLockObject);
    });

    it("parses the text to the same specification the object builds", () => {
        expect(parseSpecification(itemWithNoLock)).toEqual(itemWithNoLockObject);
    });

    it("describes every inverse to text that parses back to it", () => {
        const inverses = invertSpecification(itemWithNoLockObject);
        expect(inverses.length).toBeGreaterThan(0);

        for (const inverse of inverses) {
            // The `add` inverse given `r` has the shape of the original, so
            // before the parser's anchoring rule was removed this threw.
            expect(roundTrip(inverse.inverseSpecification))
                .toEqual(inverse.inverseSpecification);
        }
    });
});
