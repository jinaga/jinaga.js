import { DistributionIntersectionBranch } from "../../src/distribution/distribution-engine";
import { Dehydration } from "../../src/fact/hydrate";
import { PassThroughFork } from "../../src/fork/pass-through-fork";
import { FeedResponse, FeedsResponse } from "../../src/http/messages";
import { FactManager } from "../../src/managers/factManager";
import { Network } from "../../src/managers/NetworkManager";
import { MemoryStore } from "../../src/memory/memory-store";
import { ObservableSource } from "../../src/observable/observable";
import { Specification } from "../../src/specification/specification";
import { FactEnvelope, FactReference } from "../../src/storage";
import { User } from "@src";
import { Company, Office, model } from "../companyModel";
import { waitForCondition } from "../utils/async-test-utils";

const officesInCompany = model.given(Company).match((company, facts) =>
    facts.ofType(Office).join(office => office.company, company)
).specification;

/**
 * A replicator whose feed answers differently on each call, so a fact that did
 * not exist when the observer started becomes reachable later without any local
 * save. `pages` is read by call index: `pages[0]` answers the first `fetchFeed`,
 * `pages[1]` the second, and a call past the end of the script answers empty.
 *
 * `processFeed` keeps calling `fetchFeed` until it answers with no references,
 * so a page carrying facts costs two calls: the page, then the empty answer
 * that ends the pass.
 */
class ScriptedNetwork implements Network {
    public fetchFeedCalls = 0;
    /** Resolved before the first `fetchFeed` answers, when one is supplied. */
    public firstFetchGate: Promise<void> | undefined;

    constructor(
        private readonly pages: FactEnvelope[][],
        private readonly graph: FactEnvelope[]
    ) { }

    feeds(): Promise<FeedsResponse> {
        return Promise.resolve({ feeds: ["feed-1"] });
    }

    async fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        const index = this.fetchFeedCalls++;
        if (index === 0 && this.firstFetchGate) {
            await this.firstFetchGate;
        }
        const page = this.pages[index] ?? [];
        if (page.length === 0) {
            return { references: [], bookmark };
        }
        return {
            references: page.map(e => ({ type: e.fact.type, hash: e.fact.hash })),
            bookmark: `${index + 1}`
        };
    }

    streamFeed(feed: string, bookmark: string, onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>): () => void {
        // Hold the feed open without ever pushing: a subscription that learns
        // nothing on its own is what makes its refresh observable.
        void onResponse([], bookmark);
        return () => { };
    }

    load(references: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve(this.graph.filter(e => references.some(r => r.hash === e.fact.hash && r.type === e.fact.type)));
    }

    intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
        return Promise.resolve([{ start, specification }]);
    }
}

async function seedCompany(store: MemoryStore) {
    const creator = new User("--- PUBLIC KEY GOES HERE ---");
    const company = new Company(creator, "TestCo");
    const dehydration = new Dehydration();
    const companyReference = dehydration.dehydrate(company);
    await store.save(dehydration.factRecords().map(fact => <FactEnvelope>{ fact, signatures: [] }));
    return { company, companyReference };
}

/** The envelopes for one office, and the reference the feed would report. */
function office(company: Company, identifier: string) {
    const dehydration = new Dehydration();
    dehydration.dehydrate(new Office(company, identifier));
    return dehydration.factRecords().map(fact => <FactEnvelope>{ fact, signatures: [] });
}

function startObserver(network: ScriptedNetwork, store: MemoryStore, companyReference: FactReference, identifiers: string[], keepAlive = false) {
    const observableSource = new ObservableSource(store, { listenerTimeoutMs: 30000 });
    const factManager = new FactManager(new PassThroughFork(store), observableSource, store, network, []);
    return factManager.startObserver<Office>([companyReference], officesInCompany, office => {
        identifiers.push(office.identifier);
    }, keepAlive);
}

describe("observer.refresh (issue #303)", () => {
    it("delivers a row that the replicator only reports on a later fetch", async () => {
        const store = new MemoryStore();
        const { company, companyReference } = await seedCompany(store);
        const dallas = office(company, "Dallas");
        // Nothing on the first pass; Dallas on the second, which only a refresh
        // asks for.
        const network = new ScriptedNetwork([[], dallas], dallas);

        const identifiers: string[] = [];
        const observer = startObserver(network, store, companyReference, identifiers);
        try {
            await observer.loaded();
            expect(identifiers).toEqual([]);

            await observer.refresh();
            await observer.processed();

            expect(identifiers).toEqual(["Dallas"]);
        }
        finally {
            observer.stop();
        }
    });

    it("delivers no row the handler has already received", async () => {
        const store = new MemoryStore();
        const { company, companyReference } = await seedCompany(store);
        const dallas = office(company, "Dallas");
        const houston = office(company, "Houston");
        // The second refresh reports Dallas again alongside Houston, the way a
        // replicator replaying from an earlier bookmark would.
        const network = new ScriptedNetwork([[], dallas, [], [...dallas, ...houston]], [...dallas, ...houston]);

        const identifiers: string[] = [];
        const observer = startObserver(network, store, companyReference, identifiers);
        try {
            await observer.loaded();

            await observer.refresh();
            await observer.processed();
            expect(identifiers).toEqual(["Dallas"]);

            await observer.refresh();
            await observer.processed();

            expect(identifiers).toEqual(["Dallas", "Houston"]);
        }
        finally {
            observer.stop();
        }
    });

    it("issues no second fetch while the initial load is still running", async () => {
        const store = new MemoryStore();
        const { company, companyReference } = await seedCompany(store);
        const dallas = office(company, "Dallas");
        const network = new ScriptedNetwork([[], dallas], dallas);
        let releaseFirstFetch: () => void = () => { };
        network.firstFetchGate = new Promise<void>(resolve => { releaseFirstFetch = resolve; });

        const identifiers: string[] = [];
        const observer = startObserver(network, store, companyReference, identifiers);
        try {
            // The load is inside its first fetch, and stays there until released.
            await waitForCondition(() => network.fetchFeedCalls === 1);

            let refreshed = false;
            const refreshing = observer.refresh().then(() => { refreshed = true; });
            await Promise.resolve();
            expect(refreshed).toBe(false);
            expect(network.fetchFeedCalls).toBe(1);

            releaseFirstFetch();
            await refreshing;
            await observer.loaded();

            // The refresh resolved on the load's own fetch rather than adding
            // one, so the scripted second page is still unread.
            expect(network.fetchFeedCalls).toBe(1);
            expect(identifiers).toEqual([]);
        }
        finally {
            observer.stop();
        }
    });

    it("issues no fetch after the observer is stopped", async () => {
        const store = new MemoryStore();
        const { company, companyReference } = await seedCompany(store);
        const dallas = office(company, "Dallas");
        const network = new ScriptedNetwork([[], dallas], dallas);

        const identifiers: string[] = [];
        const observer = startObserver(network, store, companyReference, identifiers);
        await observer.loaded();
        observer.stop();
        const fetchesBeforeRefresh = network.fetchFeedCalls;

        await observer.refresh();

        expect(network.fetchFeedCalls).toBe(fetchesBeforeRefresh);
        expect(identifiers).toEqual([]);
    });

    it("fetches for a subscription too, whose feed is already held open", async () => {
        const store = new MemoryStore();
        const { company, companyReference } = await seedCompany(store);
        const dallas = office(company, "Dallas");
        // A subscription registers its feed through streamFeed, so the first
        // fetchFeed of this script is the refresh.
        const network = new ScriptedNetwork([dallas], dallas);

        const identifiers: string[] = [];
        const observer = startObserver(network, store, companyReference, identifiers, true);
        try {
            await observer.loaded();
            expect(identifiers).toEqual([]);

            await observer.refresh();
            await observer.processed();

            expect(identifiers).toEqual(["Dallas"]);
        }
        finally {
            observer.stop();
        }
    });
});
