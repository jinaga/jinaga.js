import { Network, NetworkManager } from "../../src/managers/NetworkManager";
import { MemoryStore } from "../../src/memory/memory-store";
import { FeedResponse } from "../../src/http/messages";
import { DistributionIntersectionBranch } from "../../src/distribution/distribution-engine";
import { FactEnvelope, FactReference } from "../../src/storage";
import { Specification } from "../../src/specification/specification";
import { model, Company, Office } from "../companyModel";
import { User } from "@src";

class FlakyNetwork implements Network {
    public fetchFeedShouldFail = true;
    public fetchFeedCalls = 0;

    feeds(start: FactReference[], specification: Specification): Promise<string[]> {
        return Promise.resolve(["feed1"]);
    }

    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        this.fetchFeedCalls++;
        if (this.fetchFeedShouldFail) {
            return Promise.reject(new Error("network down"));
        }
        return Promise.resolve({ references: [], bookmark });
    }

    streamFeed(feed: string, bookmark: string, onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>, onError: (err: Error) => void, feedRefreshIntervalSeconds: number): () => void {
        return () => {};
    }

    load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve([]);
    }

    intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
        return Promise.resolve([{ start, specification }]);
    }
}

describe("NetworkManager", () => {
    let network: FlakyNetwork;
    let store: MemoryStore;
    let manager: NetworkManager;
    let creator: User;
    let company: Company;
    let spec: Specification;

    beforeEach(() => {
        network = new FlakyNetwork();
        store = new MemoryStore();
        manager = new NetworkManager(network, store, async () => {});
        creator = new User("--- PUBLIC KEY GOES HERE ---");
        company = new Company(creator, "TestCo");
        spec = model.given(Company).match((company, facts) =>
            facts.ofType(Office).join(office => office.company, company)
        ).specification;
    });

    describe("transient fetch failure recovery", () => {
        it("should retry the network after a transient failure", async () => {
            // First fetch fails.
            await expect(manager.fetch([], spec)).rejects.toThrow("network down");

            // Network recovers.
            network.fetchFeedShouldFail = false;
            const callsBeforeRetry = network.fetchFeedCalls;

            // Second fetch should succeed and call fetchFeed again.
            await expect(manager.fetch([], spec)).resolves.toBeUndefined();
            expect(network.fetchFeedCalls).toBeGreaterThan(callsBeforeRetry);
        });

        it("should not cache a rejected promise in activeFeeds", async () => {
            // First fetch fails.
            await expect(manager.fetch([], spec)).rejects.toThrow("network down");

            // Network recovers.
            network.fetchFeedShouldFail = false;

            // Second fetch must not replay the stale rejected promise.
            await expect(manager.fetch([], spec)).resolves.toBeUndefined();
        });
    });
});
