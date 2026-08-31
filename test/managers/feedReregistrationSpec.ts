import { HttpError, User } from "@src";
import { DistributionIntersectionBranch } from "../../src/distribution/distribution-engine";
import { FeedResponse, FeedsResponse } from "../../src/http/messages";
import { Network, NetworkManager } from "../../src/managers/NetworkManager";
import { MemoryStore } from "../../src/memory/memory-store";
import { Specification } from "../../src/specification/specification";
import { FactEnvelope, FactReference } from "../../src/storage";
import { Company, model, Office } from "../companyModel";
import { waitForCondition } from "../utils/async-test-utils";

/**
 * A replicator stand-in that records every `POST /feeds` registration and hands
 * back the `onError` callback of the live stream, so a test can deliver the
 * failure a real replicator would send after it restarts and lost the feed.
 */
class RestartableNetwork implements Network {
    public readonly registrations: { start: FactReference[], specification: Specification }[] = [];
    public streamErrors: ((err: Error) => void)[] = [];

    feeds(start: FactReference[], specification: Specification): Promise<FeedsResponse> {
        this.registrations.push({ start, specification });
        return Promise.resolve({ feeds: ["feed1"] });
    }

    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        return Promise.resolve({ references: [], bookmark });
    }

    streamFeed(feed: string, bookmark: string, onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>, onError: (err: Error) => void): () => void {
        this.streamErrors.push(onError);
        // Deliver once so Subscriber.start() resolves, putting the subscription
        // in the steady state where this defect lives: past its first delivery.
        onResponse([], bookmark);
        return () => { };
    }

    load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve([]);
    }

    intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
        return Promise.resolve([{ start, specification }]);
    }

    // The error callback of the most recently opened stream.
    get lastStreamError(): (err: Error) => void {
        return this.streamErrors[this.streamErrors.length - 1];
    }
}

describe("Feed re-registration after a replicator restart (issue #243)", () => {
    let network: RestartableNetwork;
    let store: MemoryStore;
    let manager: NetworkManager;
    let spec: Specification;
    let subscribedFeeds: string[] | undefined;

    beforeEach(() => {
        network = new RestartableNetwork();
        store = new MemoryStore();
        manager = new NetworkManager(network, store, async () => { });
        new User("--- PUBLIC KEY GOES HERE ---");
        spec = model.given(Company).match((company, facts) =>
            facts.ofType(Office).join(office => office.company, company)
        ).specification;
        subscribedFeeds = undefined;
    });

    afterEach(() => {
        // Release the subscription so its refresh interval does not outlive
        // the test.
        if (subscribedFeeds) {
            manager.unsubscribe(subscribedFeeds);
            subscribedFeeds = undefined;
        }
    });

    async function subscribe() {
        const { feeds } = await manager.subscribe([], spec);
        subscribedFeeds = feeds;
    }

    it("re-registers the specification when a live stream reports feed_not_found", async () => {
        await subscribe();
        expect(network.registrations).toHaveLength(1);

        // The replicator restarted: it still routes /feeds/:hash but no longer
        // holds this registration, so it answers 404 feed_not_found.
        network.lastStreamError(new HttpError("feed_not_found", 404, "feed_not_found"));

        await waitForCondition(() => network.registrations.length > 1);
        expect(network.registrations).toHaveLength(2);
    });

    it("re-registers the same start and specification, so the feed hash and its bookmark still apply", async () => {
        await subscribe();
        network.lastStreamError(new HttpError("feed_not_found", 404, "feed_not_found"));
        await waitForCondition(() => network.registrations.length > 1);

        // The feed hash is derived from the feed definition, so re-registering
        // the same specification restores the hash the subscriber is already
        // streaming -- and the bookmark stored against that hash still applies.
        // Recovery resumes where the subscription left off; it does not replay.
        expect(network.registrations[1].specification).toEqual(network.registrations[0].specification);
        expect(network.registrations[1].start).toEqual(network.registrations[0].start);
    });

    it("does not re-register for failures that are not the server forgetting the feed", async () => {
        await subscribe();

        // Neither a server-side fault nor an untyped transport error means the
        // registration is gone; re-registering on those would turn every blip
        // into a POST storm. Only the documented 404 warrants it.
        network.lastStreamError(new HttpError("Internal Server Error", 500, ""));
        network.lastStreamError(new Error("network request failed"));

        // Then a 404, whose re-registration is the deterministic signal that
        // the two errors above have already been processed and ignored.
        network.lastStreamError(new HttpError("feed_not_found", 404, "feed_not_found"));

        await waitForCondition(() => network.registrations.length > 1);
        expect(network.registrations).toHaveLength(2);
    });

    it("collapses a burst of feed_not_found errors into one re-registration", async () => {
        await subscribe();

        // Every retry in the stream's backoff loop reports the same 404. Each
        // must not mint its own POST /feeds.
        network.lastStreamError(new HttpError("feed_not_found", 404, "feed_not_found"));
        network.lastStreamError(new HttpError("feed_not_found", 404, "feed_not_found"));
        network.lastStreamError(new HttpError("feed_not_found", 404, "feed_not_found"));

        await waitForCondition(() => network.registrations.length > 1);
        expect(network.registrations).toHaveLength(2);
    });
});
