import { computeObjectHash } from "../fact/hash";
import { FactReference, ReferencesByName } from "../storage";
import { Skeleton, skeletonOfSpecification } from "./skeleton";
import { Specification } from "./specification";

interface FeedIdentifier {
    start: {
        factReference: FactReference;
        index: number;
    }[];
    skeleton: Skeleton;
}

export interface FeedObject {
    namedStart: ReferencesByName;
    feed: Specification;
}

type FeedByHash = {
    [hash: string]: FeedObject;
};

export class FeedCache {
    private feedByHash: FeedByHash = {};

    addFeeds(feeds: Specification[], namedStart: ReferencesByName): string[] {
        const feedsByHash = feeds.reduce((map, feed) => {
            const feedObject: FeedObject = {
                namedStart,
                feed
            };
            const hash = computeFeedHash(feed, namedStart);
            return ({
                ...map,
                [hash]: feedObject
            });
        }, {} as FeedByHash);
        const feedHashes = Object.keys(feedsByHash);
        this.feedByHash = {
            ...this.feedByHash,
            ...feedsByHash
        };
        return feedHashes;
    }

    getFeed(feed: string): FeedObject | undefined {
        return this.feedByHash[feed];
    }
}

/**
 * Compute the URL-safe hash that identifies a feed on the wire. This is the
 * same identifier the client sends to `GET /feeds/{hash}` and the same hash
 * the distribution engine records in its per-feed diagnostics, so the two
 * always agree.
 */
export function computeFeedHash(feed: Specification, namedStart: ReferencesByName): string {
    const skeleton = skeletonOfSpecification(feed);
    const indexedStart = skeleton.inputs.map(input => ({
        factReference: namedStart[feed.given[input.inputIndex].label.name],
        index: input.inputIndex
    }));
    const feedIdentifier: FeedIdentifier = {
        start: indexedStart,
        skeleton
    };
    return urlSafe(computeObjectHash(feedIdentifier));
}

function urlSafe(hash: string): string {
    return hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}