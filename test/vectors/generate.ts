import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { describeSpecification } from "../../src/specification/description";
import { buildFeeds } from "../../src/specification/feed-builder";
import { Skeleton, skeletonOfSpecification } from "../../src/specification/skeleton";
import { Specification } from "../../src/specification/specification";
import { FeedCase, feedCases } from "./feed-cases";

/**
 * Emit what this library's `buildFeeds` and `skeletonOfSpecification` produce
 * for each case in `feed-cases.ts`, as JSON a port can read (#387).
 *
 * The replicator compares the skeletons of the feeds *this* implementation
 * builds, so a port has to match this output exactly. Deriving it here means a
 * change to the feed builder reaches every consumer at its next pin, instead of
 * waiting for someone to re-copy a string literal by hand.
 *
 * A specification is written as the `Specification` object serialized to JSON,
 * the shape jinaga-spec's own vectors use and jinaga.net already reads. The
 * text is carried beside it for a reader and for the round-trip check.
 */

export interface FeedVectorFeed {
    text: string;
    specification: Specification;
    skeleton: Skeleton;
}

export interface FeedVector {
    name: string;
    text: string;
    specification: Specification;
    /** In the order `buildFeeds` returns them. */
    feeds: FeedVectorFeed[];
}

export function feedVector(feedCase: FeedCase): FeedVector {
    const { name, specification } = feedCase;
    return {
        name,
        text: describeSpecification(specification, 0),
        specification,
        feeds: buildFeeds(specification).map(feed => ({
            text: describeSpecification(feed, 0),
            specification: feed,
            skeleton: skeletonOfSpecification(feed)
        }))
    };
}

export function feedVectors(cases: FeedCase[] = feedCases): FeedVector[] {
    // A repeated name would have one case's file overwrite another's, and the
    // consumer would never see that a case was lost.
    const seen = new Set<string>();
    for (const feedCase of cases) {
        if (seen.has(feedCase.name)) {
            throw new Error(`Two feed cases are named '${feedCase.name}'. A case name is the name of its vector file, so it has to be unique.`);
        }
        seen.add(feedCase.name);
    }
    return cases.map(feedVector);
}

export function serializeFeedVector(vector: FeedVector): string {
    return `${JSON.stringify(vector, null, 2)}\n`;
}

/**
 * Write one file per case to `<outDirectory>/feeds/<name>.json`, and return the
 * paths written. Two runs at one commit write byte-identical files.
 */
export function writeFeedVectors(outDirectory: string, cases: FeedCase[] = feedCases): string[] {
    const feedDirectory = join(outDirectory, "feeds");
    mkdirSync(feedDirectory, { recursive: true });
    return feedVectors(cases).map(vector => {
        const path = join(feedDirectory, `${vector.name}.json`);
        writeFileSync(path, serializeFeedVector(vector), "utf8");
        return path;
    });
}
