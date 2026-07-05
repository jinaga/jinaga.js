import { Network, NetworkManager } from "../../src/managers/NetworkManager";
import { MemoryStore } from "../../src/memory/memory-store";
import { FeedDecision, FeedResponse, FeedsResponse } from "../../src/http/messages";
import { DistributionIntersectionBranch } from "../../src/distribution/distribution-engine";
import { FactEnvelope, FactReference } from "../../src/storage";
import { Specification } from "../../src/specification/specification";
import { model, Company, Office } from "../companyModel";
import { User } from "@src";

class FlakyNetwork implements Network {
    public fetchFeedShouldFail = true;
    public fetchFeedCalls = 0;

    feeds(start: FactReference[], specification: Specification): Promise<FeedsResponse> {
        return Promise.resolve({ feeds: ["feed1"] });
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

    describe("distribution decisions (issue #207 W4)", () => {
        // A network that reports its configured feeds response, so we can
        // assert the NetworkManager threads decisions to callers.
        class DecisionNetwork implements Network {
            public response: FeedsResponse = { feeds: ["feed1"] };
            feeds(): Promise<FeedsResponse> {
                return Promise.resolve(this.response);
            }
            fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
                return Promise.resolve({ references: [], bookmark });
            }
            streamFeed(): () => void {
                return () => {};
            }
            load(): Promise<FactEnvelope[]> {
                return Promise.resolve([]);
            }
            intersectForSubscribe(start: FactReference[], specification: Specification) {
                return Promise.resolve([{ start, specification }]);
            }
        }

        it("returns the per-feed decisions from fetch", async () => {
            const decisionNetwork = new DecisionNetwork();
            const decisions: FeedDecision[] = [
                { feed: "feed1", decision: "authorized", reason: "" },
                { feed: "feed2", decision: "denied", code: "no-matching-rule", reason: "No rules apply to this feed." },
            ];
            decisionNetwork.response = { feeds: ["feed1"], decisions };
            const decisionManager = new NetworkManager(decisionNetwork, store, async () => {});

            const result = await decisionManager.fetch([], spec);

            expect(result).toEqual(decisions);
        });

        it("returns an empty decisions array when the replicator omits them", async () => {
            const decisionNetwork = new DecisionNetwork();
            decisionNetwork.response = { feeds: ["feed1"] };
            const decisionManager = new NetworkManager(decisionNetwork, store, async () => {});

            const result = await decisionManager.fetch([], spec);

            expect(result).toEqual([]);
        });
    });

    describe("transient fetch failure recovery", () => {
        it("should retry the network after a transient failure", async () => {
            // First fetch fails.
            await expect(manager.fetch([], spec)).rejects.toThrow("network down");

            // Network recovers.
            network.fetchFeedShouldFail = false;
            const callsBeforeRetry = network.fetchFeedCalls;

            // Second fetch should succeed and call fetchFeed again.
            await expect(manager.fetch([], spec)).resolves.toEqual([]);
            expect(network.fetchFeedCalls).toBeGreaterThan(callsBeforeRetry);
        });

        it("should not cache a rejected promise in activeFeeds", async () => {
            // First fetch fails.
            await expect(manager.fetch([], spec)).rejects.toThrow("network down");

            // Network recovers.
            network.fetchFeedShouldFail = false;

            // Second fetch must not replay the stale rejected promise.
            await expect(manager.fetch([], spec)).resolves.toEqual([]);
        });
    });
});
