import {
    AuthenticationNoOp, FactEnvelope, FactManager, FactReference, FeedResponse, FeedsResponse,
    Jinaga, MemoryStore, ObservableSource, PassThroughFork, Specification, SyncStatusNotifier,
    User, buildModel
} from "@src";
import { Network } from "@src";

// Issue #336: a row stream's output was the history of inverse firings, not the
// history of the result. An inverse said "add" or "remove" and the stream
// passed that on, so a consumer was offered rows a read of its own store
// excluded, and withdrawals of rows it had never been offered.
//
// Each case below is one of the three ways the two disagreed. They are written
// against the mechanism rather than only end to end, because `JinagaTest`
// passing is not evidence that the inverse machinery is right (CLAUDE.md).
//
// No timeouts anywhere. `pending` is exact once `j.fact` resolves, because the
// re-check runs inside the notification the save awaits.

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

class MirrorRetired {
    static Type = "Test.MirrorRetired" as const;
    type = MirrorRetired.Type;
    constructor(public mirror: Mirror) { }
}

// The depth-three shape, for the randomized check. An item is in the result
// exactly when it has no block, where a block counts only while none of its
// releases has been revoked. Adding a revoke therefore RESTORES a row three
// levels up, which is the gain through a negation that no inverse reported.
class Root {
    static Type = "Test.Root" as const;
    type = Root.Type;
    constructor(public owner: User, public identifier: string) { }
}

class Item {
    static Type = "Test.Item" as const;
    type = Item.Type;
    constructor(public root: Root, public name: string) { }
}

class Block {
    static Type = "Test.Block" as const;
    type = Block.Type;
    constructor(public item: Item, public name: string) { }
}

class Release {
    static Type = "Test.Release" as const;
    type = Release.Type;
    constructor(public block: Block, public name: string) { }
}

class Revoke {
    static Type = "Test.Revoke" as const;
    type = Revoke.Type;
    constructor(public release: Release) { }
}

const model = buildModel(b => b
    .type(User)
    .type(Account, x => x
        .predecessor("owner", User)
    )
    .type(Mirror, x => x
        .predecessor("account", Account)
    )
    .type(MirrorRetired, x => x
        .predecessor("mirror", Mirror)
    )
    .type(Root, x => x
        .predecessor("owner", User)
    )
    .type(Item, x => x
        .predecessor("root", Root)
    )
    .type(Block, x => x
        .predecessor("item", Item)
    )
    .type(Release, x => x
        .predecessor("block", Block)
    )
    .type(Revoke, x => x
        .predecessor("release", Release)
    )
);

// The shape #335's consumer ran: an account's mirrors that are not retired.
const currentMirrors = model.given(Account).match(account =>
    account.successors(Mirror, mirror => mirror.account)
        .notExists(mirror => mirror.successors(MirrorRetired, retired => retired.mirror))
);

// `exists { notExists }`: the accounts of a user that still have a current
// mirror. Retiring one of two leaves the row in place; retiring the last one
// takes it out.
const accountsWithCurrentMirror = model.given(User).match(user =>
    user.successors(Account, account => account.owner)
        .exists(account => account.successors(Mirror, mirror => mirror.account)
            .notExists(mirror => mirror.successors(MirrorRetired, retired => retired.mirror)))
);

const unblockedItems = model.given(Root).match(root =>
    root.successors(Item, item => item.root)
        .notExists(item => item.successors(Block, block => block.item)
            .notExists(block => block.successors(Release, release => release.block)
                .exists(release => release.successors(Revoke, revoke => revoke.release))))
);

/**
 * A replicator with nothing to say, so `fetch` resolves and the stream's reads
 * see only what the test saved.
 */
class QuietNetwork implements Network {
    feeds(start: FactReference[], specification: Specification): Promise<FeedsResponse> {
        return Promise.resolve({ feeds: [] });
    }

    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        return Promise.resolve({ references: [], bookmark });
    }

    streamFeed(feed: string, bookmark: string, onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>, onError: (err: Error) => void): () => void {
        return () => { };
    }

    load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve([]);
    }

    async intersectForSubscribe(start: FactReference[], specification: Specification) {
        return [{ start, specification }];
    }
}

/**
 * A replicator that does not answer `feeds` until the test says so, which is
 * what holds a stream's startup window open for exactly as long as a test
 * needs. `watchRows` fetches once before it reads, so blocking there puts the
 * registered listeners and the unfinished read either side of whatever the
 * test saves in between. Racing two saves against an unblocked startup
 * instead would make the case under test a matter of how many microtasks each
 * path happens to take.
 */
class GatedNetwork extends QuietNetwork {
    private release: (() => void) | null = null;
    private readonly gate: Promise<void>;

    constructor() {
        super();
        this.gate = new Promise<void>(resolve => { this.release = resolve; });
    }

    async feeds(start: FactReference[], specification: Specification): Promise<FeedsResponse> {
        await this.gate;
        return { feeds: [] };
    }

    open(): void {
        const release = this.release;
        this.release = null;
        if (release) {
            release();
        }
    }
}

/**
 * The store and the observable source are handed back so a test can drive a
 * notification directly. One of the three cases is a fact the store already
 * holds being notified again, which no local `j.fact` can produce: `save`
 * returns only the envelopes it newly stored, so a second save of the same
 * fact notifies nobody. The `/load` path does deliver them (#337), and
 * `notify` is where it arrives.
 */
function createPeer(network: Network = new QuietNetwork()) {
    const store = new MemoryStore();
    const observableSource = new ObservableSource(store);
    const factManager = new FactManager(new PassThroughFork(store), observableSource, store, network, []);
    const j = new Jinaga(new AuthenticationNoOp(), factManager, new SyncStatusNotifier());
    return { j, store, observableSource };
}

describe("a row stream re-checks its candidates", () => {
    let j: Jinaga;
    let store: MemoryStore;
    let observableSource: ObservableSource;
    let owner: User;
    let account: Account;

    beforeEach(async () => {
        ({ j, store, observableSource } = createPeer());
        owner = await j.fact(new User("--- OWNER ---"));
        account = await j.fact(new Account(owner, "one"));
    });

    it("offers no row for a mirror retired while the stream was starting", async () => {
        // Case 1. Both facts land inside the startup window, so the old shape
        // replayed them as `added` then `removed` even though the starting read
        // had correctly excluded the row. The consumer in #335 acted on that
        // `added` and wrote a permanent fact for a row that was never
        // outstanding.
        const network = new GatedNetwork();
        const gated = createPeer(network);
        const gatedOwner = await gated.j.fact(new User("--- OWNER ---"));
        const gatedAccount = await gated.j.fact(new Account(gatedOwner, "one"));

        const starting = gated.j.watchRows(currentMirrors, gatedAccount);
        const mirror = await gated.j.fact(new Mirror(gatedAccount, "https://one"));
        await gated.j.fact(new MirrorRetired(mirror));
        network.open();
        const stream = await starting;

        expect(stream.pending).toEqual(0);

        stream.stop();
    });

    it("offers no row when a retired mirror is notified again", async () => {
        // Case 2. The mirror is already in the store and already retired. Its
        // own candidate inverse runs again, and the old "add" inverse had had
        // the successor `notExists` simplified out of it, so it offered a row
        // that fails the condition. The re-check reads the specification
        // instead, which excludes it.
        const mirror = await j.fact(new Mirror(account, "https://one"));
        await j.fact(new MirrorRetired(mirror));

        const stream = await j.watchRows(currentMirrors, account);
        expect(stream.pending).toEqual(0);

        const envelopes = await store.load([{ type: Mirror.Type, hash: Jinaga.hash(mirror) }]);
        const mirrorEnvelopes = envelopes.filter(envelope => envelope.fact.type === Mirror.Type);
        expect(mirrorEnvelopes).toHaveLength(1);
        await observableSource.notify(mirrorEnvelopes);

        expect(stream.pending).toEqual(0);

        stream.stop();
    });

    it("withdraws the account only when its last current mirror is retired", async () => {
        // Case 3, and #338's `exists { notExists }`. Retiring one of two
        // mirrors left the row in the result, but the inverse fired and the
        // stream passed its label on. Retiring the last one took the row out,
        // and the inverse required a current mirror on the new graph, so it
        // found nothing to report.
        const first = await j.fact(new Mirror(account, "https://one"));
        const second = await j.fact(new Mirror(account, "https://two"));

        const stream = await j.watchRows(accountsWithCurrentMirror, owner);
        const changes = stream[Symbol.asyncIterator]();
        const added = await changes.next();
        expect(added.value.operation).toEqual("added");
        expect(Jinaga.hash(added.value.result)).toEqual(Jinaga.hash(account));

        await j.fact(new MirrorRetired(first));
        expect(stream.pending).toEqual(0);

        await j.fact(new MirrorRetired(second));
        expect(stream.pending).toEqual(1);
        const removed = await changes.next();
        expect(removed.value.operation).toEqual("removed");
        expect(removed.value.rowHash).toEqual(added.value.rowHash);

        stream.stop();
    });
});

/**
 * A deterministic generator, so a failure is reproducible from the seed rather
 * than from the run. xorshift32.
 */
function seededRandom(seed: number): () => number {
    let state = seed >>> 0 || 1;
    return () => {
        state ^= state << 13; state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5; state >>>= 0;
        return state / 0x100000000;
    };
}

function shuffled<T>(items: T[], random: () => number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

describe("a row stream over notExists nested to depth three", () => {
    /**
     * Every fact of one population, in no particular order. A `j.fact` of any
     * of them saves its unsaved ancestors in the same batch, so a random
     * permutation gives both a random topological order and random batch
     * sizes, which is what the proof's "any sequence of fresh batches" means
     * in this library.
     */
    function population(owner: User) {
        const root = new Root(owner, "r");
        const items = [0, 1, 2].map(i => new Item(root, `item${i}`));
        const blocks = [
            new Block(items[0], "b0"),
            new Block(items[1], "b1"),
            new Block(items[1], "b2")
        ];
        const releases = [
            new Release(blocks[0], "r0"),
            new Release(blocks[1], "r1"),
            new Release(blocks[2], "r2")
        ];
        const revokes = [
            new Revoke(releases[0]),
            new Revoke(releases[2])
        ];
        return {
            root,
            facts: [root, ...items, ...blocks, ...releases, ...revokes] as object[]
        };
    }

    it("offers exactly the rows a read returns, after every batch", async () => {
        // The property the re-check is for, measured rather than argued: the
        // rows the stream has offered and not withdrawn equal a full read of
        // the store, no matter what order the facts arrived in, which batches
        // they came in, or whether some were delivered twice.
        const random = seededRandom(20261024);

        for (let attempt = 0; attempt < 12; attempt++) {
            const { j, store, observableSource } = createPeer();
            const owner = await j.fact(new User("--- OWNER ---"));
            const { root, facts } = population(owner);

            const stream = await j.watchRows(unblockedItems, root);
            const changes = stream[Symbol.asyncIterator]();
            const offered = new Set<string>();
            const saved: FactReference[] = [];

            const drain = async () => {
                while (stream.pending > 0) {
                    const change = await changes.next();
                    if (change.value.operation === "added") {
                        offered.add(change.value.rowHash);
                    }
                    else {
                        offered.delete(change.value.rowHash);
                    }
                }
            };

            const check = async () => {
                await drain();
                const rows = await j.queryRows(unblockedItems, root);
                expect([...offered].sort()).toEqual(rows.map(row => row.rowHash).sort());
                expect(stream.dropped).toEqual(0);
            };

            for (const fact of shuffled(facts, random)) {
                const stored = await j.fact(fact as any);
                saved.push({ type: (stored as any).type, hash: Jinaga.hash(stored) });
                await check();

                // Re-deliver a fact the store already holds, which is what a
                // load does today (#337). It must change nothing.
                if (saved.length > 0 && random() < 0.4) {
                    const reference = saved[Math.floor(random() * saved.length)];
                    const envelopes = await store.load([reference]);
                    const exact = envelopes.filter(envelope =>
                        envelope.fact.type === reference.type && envelope.fact.hash === reference.hash);
                    await observableSource.notify(exact);
                    await check();
                }
            }

            stream.stop();
        }
    });
});
