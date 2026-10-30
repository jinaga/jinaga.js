import {
    AuthenticationNoOp, FactManager, FactReference, Jinaga, MemoryStore, Network, ObservableSource,
    PassThroughFork, ProjectedResult, Specification, SyncStatusNotifier, User, buildModel
} from "@src";
import { pinLabel } from "../../src/specification/inverse-candidates";

// Issue #377. The row stream used to decide each inverse candidate with a
// second read: `readMembership` ran a per-row membership specification and
// `recheckCandidates` compared its answer with `held`. jinaga-spec's exact
// inverses (jinaga/jinaga-spec#19) report the direction as well as the row, so
// an unintersected stream applies the rows directly and that second read is
// gone.
//
// That second read was also what made the stream immune to the order its reads
// finish in. Reads run in the save path, and a read whose snapshot was fixed
// first can return last, so applied directly its rows could undo a later
// read's answer. Every read is therefore numbered before it runs, and a row's
// highest number wins.
//
// No arbitrary timeouts anywhere (CLAUDE.md). The gate below is a
// deterministic rendezvous: the test waits for the read to have entered it,
// never for a clock.

class Account {
    static Type = "Stream.Account" as const;
    type = Account.Type;
    constructor(public owner: User, public identifier: string) { }
}

class Mirror {
    static Type = "Stream.Mirror" as const;
    type = Mirror.Type;
    constructor(public account: Account, public url: string) { }
}

class MirrorRetired {
    static Type = "Stream.MirrorRetired" as const;
    type = MirrorRetired.Type;
    constructor(public mirror: Mirror) { }
}

const model = buildModel(b => b
    .type(User)
    .type(Account, x => x.predecessor("owner", User))
    .type(Mirror, x => x.predecessor("account", Account))
    .type(MirrorRetired, x => x.predecessor("mirror", Mirror))
);

// `exists { notExists }`, given the owner. One add inverse waits for a
// `Mirror` and one remove inverse waits for a `MirrorRetired`, so the two
// directions are reported by reads these tests can order against each other.
const accountsWithCurrentMirror = model.given(User).match((user, facts) =>
    facts.ofType(Account)
        .join(account => account.owner, user)
        .exists(account => facts.ofType(Mirror)
            .join(mirror => mirror.account, account)
            .notExists(mirror => facts.ofType(MirrorRetired)
                .join(retired => retired.mirror, mirror)))
);

// The rows themselves rather than a condition on them, given the account.
// Every top-level unknown is in the row identity, so this is the shape the
// remove direction is proven for.
const currentMirrors = model.given(Account).match((account, facts) =>
    facts.ofType(Mirror)
        .join(mirror => mirror.account, account)
        .notExists(mirror => facts.ofType(MirrorRetired)
            .join(retired => retired.mirror, mirror))
);

/** A replicator with nothing to say, so the stream's reads see only what the test saved. */
class QuietNetwork implements Network {
    feeds() {
        return Promise.resolve({ feeds: [] });
    }

    fetchFeed(feed: string, bookmark: string) {
        return Promise.resolve({ references: [], bookmark });
    }

    streamFeed(): () => void {
        return () => { };
    }

    load() {
        return Promise.resolve([]);
    }

    async intersectForSubscribe(start: FactReference[], specification: Specification) {
        return [{ start, specification }];
    }
}

/**
 * A store that parks the first read starting from one chosen fact, AFTER that
 * read has fixed the state it will answer from.
 *
 * `MemoryStore.read` captures the envelopes it reads synchronously, so calling
 * the inner read and then awaiting a gate produces exactly the situation this
 * issue is about: a read that saw an older store than a read numbered after it,
 * and that returns later than that one.
 */
class GatedStore extends MemoryStore {
    private gatedHash: string | null = null;
    private signalEntered: () => void = () => { };
    private release: () => void = () => { };
    /** Resolves once the gated read has fixed its snapshot and parked. */
    public readonly entered: Promise<void>;
    private readonly released: Promise<void>;

    constructor() {
        super();
        this.entered = new Promise<void>(resolve => { this.signalEntered = resolve; });
        this.released = new Promise<void>(resolve => { this.release = resolve; });
    }

    public gateReadsFrom(hash: string): void {
        this.gatedHash = hash;
    }

    public releaseGate(): void {
        this.release();
    }

    async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        // Called, not awaited, before the gate: this is what fixes the snapshot.
        const results = super.read(start, specification);
        if (this.gatedHash !== null && start.some(reference => reference.hash === this.gatedHash)) {
            // One read only. The fact that releases the gate provokes reads of
            // its own, and those must not park behind it.
            this.gatedHash = null;
            this.signalEntered();
            await this.released;
        }
        return results;
    }
}

/**
 * A store that records what each read was given, by label.
 *
 * The shape of a read says which kind it is, and it is read off the
 * specification rather than asserted against a remembered count. An inverse's
 * last given is the pin, so a read whose last given label is `pinLabel` is one
 * of the exact inverses' reads. A membership read's givens are the stream's own
 * plus the labels it pins, and a whole-result read's are the stream's own
 * alone; neither ends in the pin.
 */
class PinRecordingStore extends MemoryStore {
    public reads: string[][] = [];

    async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        this.reads.push(specification.given.map(g => g.label.name));
        return super.read(start, specification);
    }

    reset(): void {
        this.reads = [];
    }
}

function isInverseRead(givenLabels: string[]): boolean {
    return givenLabels.length > 0 && givenLabels[givenLabels.length - 1] === pinLabel;
}

function createPeer(store: MemoryStore = new MemoryStore()) {
    const observableSource = new ObservableSource(store);
    const factManager = new FactManager(
        new PassThroughFork(store), observableSource, store, new QuietNetwork(), []);
    const j = new Jinaga(new AuthenticationNoOp(), factManager, new SyncStatusNotifier());
    return { j, store };
}

describe("a row stream applying exact inverses", () => {
    it("reads only its exact inverses when a non-given fact is saved", async () => {
        const store = new PinRecordingStore();
        const { j } = createPeer(store);
        const owner = await j.fact(new User("--- OWNER ---"));
        const account = await j.fact(new Account(owner, "one"));
        const stream = await j.watchRows(currentMirrors, account);

        store.reset();
        const mirror = await j.fact(new Mirror(account, "https://one"));
        expect(store.reads.length).toBeGreaterThan(0);
        // Every read the save provoked is an inverse read. Before this change
        // the membership read followed each of them.
        expect(store.reads.filter(isInverseRead)).toEqual(store.reads);

        store.reset();
        await j.fact(new MirrorRetired(mirror));
        expect(store.reads.length).toBeGreaterThan(0);
        expect(store.reads.filter(isInverseRead)).toEqual(store.reads);

        stream.stop();
    });

    it("drops an add from a read a later read has already answered", async () => {
        const store = new GatedStore();
        const { j } = createPeer(store);
        const owner = await j.fact(new User("--- OWNER ---"));
        const account = await j.fact(new Account(owner, "one"));

        const stream = await j.watchChanges(accountsWithCurrentMirror, owner);
        expect(stream.pending).toEqual(0);

        // The add inverse's read fixes a snapshot that holds the mirror and
        // parks. Its number was taken before it ran.
        const mirror = new Mirror(account, "https://one");
        store.gateReadsFrom(j.hash(mirror));
        const mirrorSaved = j.fact(mirror);
        await store.entered;

        // Saved, read and applied while that add is still parked, so its read
        // is numbered after the add's and its answer is the later one.
        await j.fact(new MirrorRetired(mirror));

        store.releaseGate();
        await mirrorSaved;

        // Nothing is offered: the stale add loses to the newer remove.
        expect(stream.pending).toEqual(0);
        // And that agrees with a read of the specification, which is the
        // standard the stream owes against its own graph.
        expect(await j.queryRows(accountsWithCurrentMirror, owner)).toEqual([]);

        stream.stop();
    });

    it("drops a remove from a read a later read has already answered", async () => {
        const store = new GatedStore();
        const { j } = createPeer(store);
        const owner = await j.fact(new User("--- OWNER ---"));
        const account = await j.fact(new Account(owner, "one"));
        const first = await j.fact(new Mirror(account, "https://one"));

        const stream = await j.watchChanges(accountsWithCurrentMirror, owner);
        expect(stream.pending).toEqual(0);

        // The remove inverse's read fixes a snapshot in which the only mirror
        // is retired, and parks.
        const retired = new MirrorRetired(first);
        store.gateReadsFrom(j.hash(retired));
        const retiredSaved = j.fact(retired);
        await store.entered;

        // A second mirror arrives and is applied while that remove is parked,
        // so its read is numbered later and its answer is the current one.
        await j.fact(new Mirror(account, "https://two"));

        store.releaseGate();
        await retiredSaved;

        // The account is never withdrawn: the stale remove loses to the newer
        // add, and the account does still have a current mirror.
        expect(stream.pending).toEqual(0);
        const rows = await j.queryRows(accountsWithCurrentMirror, owner);
        expect(rows.map(row => j.hash(row.result))).toEqual([j.hash(account)]);

        stream.stop();
    });

    it("offers each row once when the stream's own given arrives", async () => {
        const { j } = createPeer();
        const owner = await j.fact(new User("--- OWNER ---"));
        // Not saved yet, so the starting read returns nothing at all: a read
        // answers nothing while a given fact is absent from the store.
        const account = new Account(owner, "one");

        const stream = await j.watchChanges(currentMirrors, account);
        expect(stream.pending).toEqual(0);

        // One batch carries the given and a row of the result. The given's
        // arrival is answered by a read of the whole result, and the mirror's
        // own add inverse reports the same row, so the row is offered once
        // rather than twice.
        const mirror = await j.fact(new Mirror(account, "https://one"));

        expect(stream.pending).toEqual(1);
        const changes = stream[Symbol.asyncIterator]();
        const added = await changes.next();
        expect(added.value.operation).toEqual("added");
        expect(j.hash(added.value.result)).toEqual(j.hash(mirror));

        stream.stop();
    });
});
