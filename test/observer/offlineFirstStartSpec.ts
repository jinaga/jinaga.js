import { DistributionIntersectionBranch } from "../../src/distribution/distribution-engine";
import { Dehydration } from "../../src/fact/hydrate";
import { PassThroughFork } from "../../src/fork/pass-through-fork";
import { FeedResponse, FeedsResponse } from "../../src/http/messages";
import { FactManager } from "../../src/managers/factManager";
import { Network } from "../../src/managers/NetworkManager";
import { MemoryStore } from "../../src/memory/memory-store";
import { ObservableSource } from "../../src/observable/observable";
import { Specification } from "../../src/specification/specification";
import { FactEnvelope, FactReference, ProjectedResult } from "../../src/storage";
import { NoOpTracer, Trace, Tracer } from "../../src/util/trace";
import { User } from "@src";
import { Company, Office, model } from "../companyModel";

const officesInCompany = model.given(Company).match((company, facts) =>
    facts.ofType(Office).join(office => office.company, company)
).specification;

/**
 * A replicator that is unreachable until `online` is set, which is what a
 * device holds when a view is first opened with no connection. Every request
 * rejects while it is offline, exactly as a failing transport does, so the
 * local graph is the only answer there is.
 *
 * Once online, `fetchFeed` answers from `pages` by call index, the way
 * `ScriptedNetwork` in `refreshSpec` does: `pages[0]` answers the first call
 * made while online, and a call past the end answers empty, which is what ends
 * a pass.
 */
class TogglingNetwork implements Network {
    public online = false;
    public feedsCalls = 0;
    private onlineFetchCalls = 0;

    constructor(
        private readonly pages: FactEnvelope[][] = [],
        private readonly graph: FactEnvelope[] = []
    ) { }

    async feeds(): Promise<FeedsResponse> {
        this.feedsCalls++;
        if (!this.online) {
            throw new Error("offline: feeds unreachable");
        }
        return { feeds: ["feed-1"] };
    }

    async fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        if (!this.online) {
            throw new Error("offline: fetchFeed unreachable");
        }
        const index = this.onlineFetchCalls++;
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
        // Hold the feed open without pushing anything, so only a fetch moves
        // rows. A subscription that is offline never reaches here.
        void onResponse([], bookmark);
        return () => { };
    }

    async load(references: FactReference[]): Promise<FactEnvelope[]> {
        if (!this.online) {
            throw new Error("offline: load unreachable");
        }
        return this.graph.filter(e => references.some(r => r.hash === e.fact.hash && r.type === e.fact.type));
    }

    intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
        return Promise.resolve([{ start, specification }]);
    }
}

/**
 * A store whose read can be made to fail, so the path where neither the
 * replicator nor the local graph can answer is reachable. `failRead` is set
 * after the seed has been saved, so only the observer's read fails.
 */
class ReadFailingStore extends MemoryStore {
    public failRead = false;

    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        if (this.failRead) {
            return Promise.reject(new Error("local read unavailable"));
        }
        return super.read(start, specification);
    }
}

/** Collects what the library reports through `Trace.error`. */
class CapturingTracer extends NoOpTracer implements Tracer {
    public readonly errors: string[] = [];

    error(error: any): void {
        this.errors.push(String(error));
    }
}

function envelopes(dehydration: Dehydration): FactEnvelope[] {
    return dehydration.factRecords().map(fact => <FactEnvelope>{ fact, signatures: [] });
}

/** The envelopes for one office, and the reference a feed would report. */
function office(company: Company, identifier: string) {
    const dehydration = new Dehydration();
    dehydration.dehydrate(new Office(company, identifier));
    return envelopes(dehydration);
}

/**
 * A store that already holds a company and the offices named, which is the
 * device's own graph: facts it fetched on an earlier connected run, or wrote
 * itself while offline.
 */
async function seedStore(identifiers: string[], store: MemoryStore = new MemoryStore()) {
    const creator = new User("--- PUBLIC KEY GOES HERE ---");
    const company = new Company(creator, "TestCo");
    const dehydration = new Dehydration();
    const companyReference = dehydration.dehydrate(company);
    await store.save(envelopes(dehydration));
    for (const identifier of identifiers) {
        await store.save(office(company, identifier));
    }
    return { store, company, companyReference };
}

function startObserver(
    network: Network,
    store: MemoryStore,
    companyReference: FactReference,
    identifiers: string[],
    keepAlive = false
) {
    const observableSource = new ObservableSource(store, { listenerTimeoutMs: 30000 });
    const factManager = new FactManager(new PassThroughFork(store), observableSource, store, network, []);
    return factManager.startObserver<Office>([companyReference], officesInCompany, office => {
        identifiers.push(office.identifier);
    }, keepAlive);
}

/**
 * Start the observer and wait for its load to settle either way, reporting the
 * rows that had been delivered at the moment it settled. That snapshot is what
 * separates this fix from the behavior it replaces: the rejection and the rows
 * both exist, and the rows have to come first for a view that renders on a
 * failed load to show them.
 */
async function startAndSettle(
    network: Network,
    store: MemoryStore,
    companyReference: FactReference,
    keepAlive = false
) {
    const identifiers: string[] = [];
    const observer = startObserver(network, store, companyReference, identifiers, keepAlive);
    let rejection: unknown;
    let deliveredAtSettle: string[] | undefined;
    try {
        await observer.loaded();
    }
    catch (e) {
        rejection = e;
    }
    deliveredAtSettle = [...identifiers];
    return { observer, identifiers, rejection, deliveredAtSettle };
}

describe("observer first start with no connection (issue #403)", () => {
    it("delivers the local graph to a watch before the load rejects", async () => {
        const { store, companyReference } = await seedStore(["Dallas", "Houston"]);
        const network = new TogglingNetwork();

        const { observer, rejection, deliveredAtSettle } = await startAndSettle(network, store, companyReference);
        try {
            // The load still reports the fetch's failure: nothing here claims
            // the view is up to date.
            expect(rejection).toBeInstanceOf(Error);
            expect((rejection as Error).message).toContain("offline");
            // The facts the device holds reached the callback first.
            expect(deliveredAtSettle!.sort()).toEqual(["Dallas", "Houston"]);
        }
        finally {
            observer.stop();
        }
    });

    it("delivers the local graph to a subscription before the load rejects", async () => {
        const { store, companyReference } = await seedStore(["Dallas", "Houston"]);
        const network = new TogglingNetwork();

        const { observer, rejection, deliveredAtSettle } = await startAndSettle(network, store, companyReference, true);
        try {
            expect(rejection).toBeInstanceOf(Error);
            expect((rejection as Error).message).toContain("offline");
            expect(deliveredAtSettle!.sort()).toEqual(["Dallas", "Houston"]);
        }
        finally {
            observer.stop();
        }
    });

    it("leaves cached() false on this start and on the next one", async () => {
        const { store, companyReference } = await seedStore(["Dallas"]);
        const network = new TogglingNetwork();

        const first = await startAndSettle(network, store, companyReference);
        try {
            expect(first.rejection).toBeInstanceOf(Error);
            // No load has completed, so nothing is cached.
            await expect(first.observer.cached()).resolves.toBe(false);
        }
        finally {
            first.observer.stop();
        }

        // No date was written, so the next start takes the uncached path again:
        // it fetches first, and reports the failure rather than a cache hit.
        const second = await startAndSettle(network, store, companyReference);
        try {
            await expect(second.observer.cached()).resolves.toBe(false);
            expect(second.rejection).toBeInstanceOf(Error);
            expect(second.deliveredAtSettle!).toEqual(["Dallas"]);
        }
        finally {
            second.observer.stop();
        }
    });

    it("adds a row once when a later fetch brings it in", async () => {
        const { store, company, companyReference } = await seedStore(["Dallas"]);
        const austin = office(company, "Austin");
        const network = new TogglingNetwork([austin], austin);

        const { observer, identifiers, rejection, deliveredAtSettle } =
            await startAndSettle(network, store, companyReference);
        try {
            expect(rejection).toBeInstanceOf(Error);
            expect(deliveredAtSettle!).toEqual(["Dallas"]);

            // The connection comes back and the replicator reports the office
            // this device never had.
            network.online = true;
            await observer.refresh();
            await observer.processed();

            // Austin arrives through the inverse listeners; Dallas, which the
            // local read already delivered, is not delivered again.
            expect(identifiers).toEqual(["Dallas", "Austin"]);
        }
        finally {
            observer.stop();
        }
    });

    it("rejects with the fetch's error when the local read fails too, and reports the read", async () => {
        const store = new ReadFailingStore();
        const { companyReference } = await seedStore(["Dallas"], store);
        const network = new TogglingNetwork();
        // Only the observer's read fails: the seed above is already saved.
        store.failRead = true;

        const previousTracer = Trace.getTracer();
        const tracer = new CapturingTracer();
        Trace.configure(tracer);
        try {
            const { observer, rejection, deliveredAtSettle } =
                await startAndSettle(network, store, companyReference);
            try {
                // The fetch's error is what the caller asked about, so it is
                // the one the load rejects with -- not the read's.
                expect(rejection).toBeInstanceOf(Error);
                expect((rejection as Error).message).toBe("offline: feeds unreachable");
                // Nothing could be delivered, since neither side answered.
                expect(deliveredAtSettle!).toEqual([]);
                // The read's failure is not swallowed.
                expect(tracer.errors.some(e => e.includes("local read unavailable"))).toBe(true);
            }
            finally {
                observer.stop();
            }
        }
        finally {
            Trace.configure(previousTracer);
        }
    });

    it("is unchanged when the fetch succeeds, and on a start with a cache date", async () => {
        const { store, companyReference } = await seedStore(["Dallas"]);
        const network = new TogglingNetwork();
        network.online = true;

        const firstIdentifiers: string[] = [];
        const first = startObserver(network, store, companyReference, firstIdentifiers);
        try {
            await first.loaded();
            // A successful load resolves, delivers the rows, and writes the
            // date. The first start was still uncached.
            await expect(first.cached()).resolves.toBe(false);
            expect(firstIdentifiers).toEqual(["Dallas"]);
        }
        finally {
            first.stop();
        }

        const secondIdentifiers: string[] = [];
        const second = startObserver(network, store, companyReference, secondIdentifiers);
        try {
            // The date is there now, so this start reads first and reports the
            // cache hit without waiting on the network.
            await expect(second.cached()).resolves.toBe(true);
            await second.loaded();
            expect(secondIdentifiers).toEqual(["Dallas"]);
        }
        finally {
            second.stop();
        }
    });
});
