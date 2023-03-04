import { FeedResponse } from "../http/messages";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactReference, Storage } from "../storage";

export interface Network {
    feeds(start: FactReference[], specification: Specification): Promise<string[]>;
    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse>;
    load(factReferences: FactReference[]): Promise<FactEnvelope[]>;

}

export class NetworkNoOp implements Network {
    feeds(start: FactReference[], specification: Specification): Promise<string[]> {
        return Promise.resolve([]);
    }

    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        return Promise.resolve({ references: [], bookmark });
    }

    load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve([]);
    }
}

export class NetworkManager {
    private activeFeeds = new Map<string, Promise<void>>();

    constructor(
        private readonly network: Network,
        private readonly store: Storage
    ) { }

    async fetch(start: FactReference[], specification: Specification) {
        const feeds: string[] = await this.network.feeds(start, specification);

        // Fork to fetch from each feed.
        const promises = feeds.map(feed => {
            if (this.activeFeeds.has(feed)) {
                return this.activeFeeds.get(feed);
            }
            else {
                const promise = this.processFeed(feed);
                this.activeFeeds.set(feed, promise);
                return promise;
            }
        });
        await Promise.all(promises);
    }

    private async processFeed(feed: string) {
        let bookmark: string = await this.store.loadBookmark(feed);

        while (true) {
            const { references: factReferences, bookmark: nextBookmark } = await this.network.fetchFeed(feed, bookmark);

            if (factReferences.length === 0) {
                break;
            }

            const knownFactReferences: FactReference[] = await this.store.whichExist(factReferences);
            const unknownFactReferences: FactReference[] = factReferences.filter(fr => !knownFactReferences.includes(fr));
            if (unknownFactReferences.length > 0) {
                const graph: FactEnvelope[] = await this.network.load(unknownFactReferences);

                const factsAdded = await this.store.save(graph);

                // TODO: Notify observers about the facts added.
            }

            bookmark = nextBookmark;
            await this.store.saveBookmark(feed, bookmark);
        }

        this.activeFeeds.delete(feed);
    }
}
