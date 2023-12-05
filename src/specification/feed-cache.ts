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

interface FeedObject {
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
            const skeleton = skeletonOfSpecification(feed);
            const indexedStart = skeleton.inputs.map(input => ({
                factReference: namedStart[feed.given[input.inputIndex].name],
                index: input.inputIndex
            }));
            const feedIdentifier: FeedIdentifier = {
                start: indexedStart,
                skeleton
            };
            const feedObject: FeedObject = {
                namedStart,
                feed
            };
            const hash = computeObjectHash(feedIdentifier);
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
