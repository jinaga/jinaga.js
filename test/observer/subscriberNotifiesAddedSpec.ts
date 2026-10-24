import {
    AuthenticationNoOp, FactEnvelope, FactManager, FactReference, FeedResponse, FeedsResponse,
    Jinaga, MemoryStore, Network, ObservableSource, PassThroughFork, Specification,
    SyncStatusNotifier, User, buildModel, dehydrateFact, dehydrateReference
} from "@src";
import { DistributionIntersectionBranch } from "../../src/distribution/distribution-engine";

// Issue #337: a subscription saves the graph `/load` returns and then notifies
// that whole graph. `/load` returns the predecessor closure, so a fact the
// store already holds is notified again. Every inverse is derived on the
// premise that its given was just inserted and has no successors
// (`simplifyMatch` in src/specification/inverse.ts; axiom A3 in
// docs/analysis/specification-invariants.md), so a re-notified fact runs its
// "add" inverse without the successor `notExists` conditions that excluded it.
// A retired mirror is therefore offered as current.

class Account {
    static Type = "Test.Account" as const;
    type = Account.Type;
    constructor(public owner: User, public identifier: string) { }
}

class Mirror {
    static Type = "Test.Mirror" as const;
    type = Mirror.Type;
    constructor(public account: Account, public url: string) { }
}

class Retired {
    static Type = "Test.Retired" as const;
    type = Retired.Type;
    constructor(public mirror: Mirror) { }
}

// A fact that arrives later and names a mirror as its predecessor, so the
// mirror is in the predecessor closure `/load` returns for it.
class SyncRun {
    static Type = "Test.SyncRun" as const;
    type = SyncRun.Type;
    constructor(public mirror: Mirror, public startedAt: string) { }
}

const model = buildModel(b => b
    .type(User)
    .type(Account, x => x
        .predecessor("owner", User)
    )
    .type(Mirror, x => x
        .predecessor("account", Account)
    )
    .type(Retired, x => x
        .predecessor("mirror", Mirror)
    )
    .type(SyncRun, x => x
        .predecessor("mirror", Mirror)
    )
);

const currentMirrors = model.given(Account).match(account =>
    account.successors(Mirror, mirror => mirror.account)
        .notExists(mirror => mirror.successors(Retired, retired => retired.mirror))
);

/**
 * A replicator stand-in. The test hands it the graph `/load` answers with, then
 * delivers a feed response naming the references a real replicator would send.
 */
class ReplayNetwork implements Network {
    public loadCalls: FactReference[][] = [];
    private respond: ((factReferences: FactReference[], nextBookmark: string) => Promise<void>) | undefined;

    constructor(private readonly graph: FactEnvelope[]) { }

    feeds(start: FactReference[], specification: Specification): Promise<FeedsResponse> {
        return Promise.resolve({ feeds: ["feed-one"] });
    }

    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        return Promise.resolve({ references: [], bookmark });
    }

    streamFeed(feed: string, bookmark: string, onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>, onError: (err: Error) => void): () => void {
        this.respond = onResponse;
        // A subscription is not started until its feed has answered once:
        // Subscriber.start awaits the first response. Answer as the real
        // replicator does when it has nothing new, which puts the subscription
        // in the steady state where this defect lives.
        void onResponse([], bookmark);
        return () => { this.respond = undefined; };
    }

    load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
        this.loadCalls.push(factReferences);
        return Promise.resolve(this.graph);
    }

    async intersectForSubscribe(start: FactReference[], specification: Specification): Promise<DistributionIntersectionBranch[]> {
        return [{ start, specification }];
    }

    // Deliver what the replicator pushes next. Awaiting this awaits the
    // subscriber's whole save-and-notify path, because Subscriber awaits the
    // notification inside the stream callback.
    async deliver(references: FactReference[], bookmark: string): Promise<void> {
        if (!this.respond) {
            throw new Error("The feed is not open.");
        }
        await this.respond(references, bookmark);
    }
}

/**
 * A store that hands back its own reference objects rather than the ones it was
 * given, which is what a store that round-trips through a database does. The
 * subscription's own already-known filter compares by identity, so against
 * such a store it loads references it already holds -- the case the second test
 * covers.
 */
class RoundTripStore extends MemoryStore {
    public readonly addedPerSave: number[] = [];

    async whichExist(references: FactReference[]): Promise<FactReference[]> {
        const existing = await super.whichExist(references);
        return existing.map(reference => ({ type: reference.type, hash: reference.hash }));
    }

    async save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        const added = await super.save(envelopes);
        this.addedPerSave.push(added.length);
        return added;
    }
}

function createWithNetwork(network: Network, store: MemoryStore) {
    const observableSource = new ObservableSource(store);
    const factManager = new FactManager(new PassThroughFork(store), observableSource, store, network, []);
    return new Jinaga(new AuthenticationNoOp(), factManager, new SyncStatusNotifier());
}

describe("Subscriber notifies only what the store reports as added (issue #337)", () => {
    it("does not offer a retired mirror that arrives again in a /load closure", async () => {
        const owner = new User("--- OWNER ---");
        const account = new Account(owner, "primary");
        const mirror = new Mirror(account, "https://mirror.example/one");
        const retired = new Retired(mirror);
        const syncRun = new SyncRun(mirror, "2026-10-24T00:00:00Z");

        // What `/load` answers with for the new fact: its predecessor closure,
        // which carries the mirror the store already holds. Retired is not a
        // predecessor of anything here, so it is not in the closure.
        const graph: FactEnvelope[] = dehydrateFact(syncRun)
            .map(fact => ({ fact, signatures: [] }));

        const store = new RoundTripStore();
        const network = new ReplayNetwork(graph);
        const j = createWithNetwork(network, store);

        // The store's own state: the mirror is retired, so it is not current.
        await j.fact(owner);
        const savedAccount = await j.fact(account);
        await j.fact(mirror);
        await j.fact(retired);

        const offered: string[] = [];
        const observer = j.subscribe(currentMirrors, savedAccount, async m => {
            offered.push(m.url);
        });
        await observer.loaded();
        expect(offered).toEqual([]);

        // The replicator pushes the new fact. Its closure re-delivers the
        // retired mirror, which the store already holds.
        await network.deliver([dehydrateReference(syncRun)], "bookmark-2");
        await observer.processed();

        try {
            expect(offered).toEqual([]);
        }
        finally {
            observer.stop();
        }
    });

    it("notifies nothing when every fact in the loaded graph is already held", async () => {
        const owner = new User("--- OWNER ---");
        const account = new Account(owner, "primary");
        const mirror = new Mirror(account, "https://mirror.example/one");
        const retired = new Retired(mirror);

        // The closure of a fact the store already holds, in full.
        const graph: FactEnvelope[] = dehydrateFact(retired)
            .map(fact => ({ fact, signatures: [] }));

        const store = new RoundTripStore();
        const network = new ReplayNetwork(graph);
        const j = createWithNetwork(network, store);

        await j.fact(owner);
        const savedAccount = await j.fact(account);
        await j.fact(mirror);
        await j.fact(retired);

        const offered: string[] = [];
        const observer = j.subscribe(currentMirrors, savedAccount, async m => {
            offered.push(m.url);
        });
        await observer.loaded();
        const savesBeforeDelivery = store.addedPerSave.length;

        await network.deliver([dehydrateReference(retired)], "bookmark-2");
        await observer.processed();

        try {
            // The save reported nothing added, so there was nothing to notify.
            expect(store.addedPerSave.slice(savesBeforeDelivery)).toEqual([0]);
            expect(offered).toEqual([]);
        }
        finally {
            observer.stop();
        }
    });
});
