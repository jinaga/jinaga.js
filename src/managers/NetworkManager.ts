import { FeedResponse } from "../http/messages";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactReference, factReferenceEquals, Storage } from "../storage";

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
    private loadBatch: FactReference[] = [];
    private loadCompleted: Promise<void> | null = null;

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
                await this.loadInBatch(unknownFactReferences);
            }

            bookmark = nextBookmark;
            await this.store.saveBookmark(feed, bookmark);
        }

        this.activeFeeds.delete(feed);
    }

    private loadInBatch(factReferences: FactReference[]) {
        // Add the fact references that are not already in the batch.
        for (const fr of factReferences) {
            if (!this.loadBatch.some(factReferenceEquals(fr))) {
                this.loadBatch.push(fr);
            }
        }

        // Start a new batch if one is not already waiting.
        if (this.loadCompleted === null) {
            this.loadCompleted = new Promise<void>((resolve, reject) => {
                setTimeout(() => {
                    // Prepare to start a new batch.
                    const loadBatch = this.loadBatch;
                    this.loadBatch = [];
                    this.loadCompleted = null;
                    this.loadAndSave(loadBatch)
                        .then(() => resolve())
                        .catch(e => reject(e));
                    resolve();
                }, 100);
            });
        }
        return this.loadCompleted;
    }

    private async loadAndSave(factReferences: FactReference[]) {
        const graph: FactEnvelope[] = await this.network.load(factReferences);

        const factsAdded = await this.store.save(graph);

        // TODO: Notify observers about the facts added.
    }
}
