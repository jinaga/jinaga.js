import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describeSpecification, SpecificationParser } from "@src";
import { Specification } from "../../src/specification/specification";
import { FeedCase, feedCases, simpleSuccessor } from "./feed-cases";
import { feedVectors, serializeFeedVector, writeFeedVectors } from "./generate";

// Issue #387: a port of `buildFeeds` and `skeletonOfSpecification`
// (jinaga/jinaga.net#201) has to match this implementation exactly, so the
// vectors it compares against are generated from this implementation rather
// than copied out of it. These tests hold the generator to what a consumer
// needs: text it can read back, and output that does not move between runs at
// one commit.
//
// No assertion here states a vector's contents, the case list's length, or its
// names. `feedBuilderSpec.ts` and the spec files beside it already state the
// expected feeds; the vectors are derived from the code those assertions test.

function parse(text: string): Specification {
    const parser = new SpecificationParser(text);
    parser.skipWhitespace();
    return parser.parseSpecification();
}

describe("feed vectors", () => {
    const vectors = feedVectors();

    it.each(feedCases.map(feedCase => feedCase.name))(
        "describes %s to text that reads back as the same specification", name => {
            const vector = vectors.find(v => v.name === name)!;
            const reparsed = parse(vector.text);

            expect(reparsed).toEqual(vector.specification);
            expect(describeSpecification(reparsed, 0)).toEqual(vector.text);
        });

    it.each(feedCases.map(feedCase => feedCase.name))(
        "describes every feed of %s to text that reads back as the same feed", name => {
            const vector = vectors.find(v => v.name === name)!;
            for (const feed of vector.feeds) {
                const reparsed = parse(feed.text);

                expect(reparsed).toEqual(feed.specification);
                expect(describeSpecification(reparsed, 0)).toEqual(feed.text);
            }
        });

    it("produces the same output on a second run", () => {
        const second = feedVectors();

        expect(second.map(serializeFeedVector)).toEqual(vectors.map(serializeFeedVector));
    });

    it("writes one file per case, byte-identical between runs", () => {
        const directory = mkdtempSync(join(tmpdir(), "jinaga-feed-vectors-"));
        try {
            const first = writeFeedVectors(join(directory, "first"));
            const second = writeFeedVectors(join(directory, "second"));

            expect(first).toHaveLength(feedCases.length);
            expect(readdirSync(join(directory, "first", "feeds"))).toHaveLength(feedCases.length);
            expect(second.map(path => readFileSync(path, "utf8")))
                .toEqual(first.map(path => readFileSync(path, "utf8")));
        }
        finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it("refuses two cases with the same name", () => {
        const twice: FeedCase = { name: "named-twice", specification: simpleSuccessor };

        expect(() => feedVectors([twice, twice])).toThrow(twice.name);
    });

    it("removes the vector of a case that is gone from a reused directory", () => {
        // A consumer that writes into a directory it already used would
        // otherwise read a vector for a case this library no longer has.
        const directory = mkdtempSync(join(tmpdir(), "jinaga-feed-vectors-"));
        try {
            const stays: FeedCase = { name: "stays", specification: simpleSuccessor };
            const goes: FeedCase = { name: "goes", specification: simpleSuccessor };
            writeFeedVectors(directory, [stays, goes]);
            // Something the generator did not write is not its to delete.
            writeFileSync(join(directory, "feeds", "pinned-commit.txt"), "abc123\n", "utf8");

            writeFeedVectors(directory, [stays]);

            expect(readdirSync(join(directory, "feeds")).sort())
                .toEqual(["pinned-commit.txt", "stays.json"]);
        }
        finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
