import {
    AuthenticationNoOp, FactEnvelope, FactManager, FactReference, FeedResponse, FeedsResponse,
    Jinaga, MemoryStore, Network, ObservableSource, PassThroughFork, ProjectedResult,
    Specification, SyncStatusNotifier, User, buildModel
} from "@src";
import { Condition, ExistentialCondition, Match, PathCondition } from "../../src/specification/specification";
import { seededRandom, shuffled } from "../utils/seeded-random";

// Issue #345. `ObserverImpl` registered every inverse `invertSpecification`
// produced and then called `notifyAdded` or `notifyRemoved` according to
// `inverse.operation`, without asking whether the row's membership had
// actually changed. So everything that module got wrong reached `j.watch` and
// `j.subscribe` callers directly: a change that reached a row through a
// negation produced no notification at all (#338), a removal fired for a row
// another witness still kept in the result, a label reused after an
// existential condition was looked up in the wrong scope (#343), and a
// specification whose given is joined only inside an existential condition
// could not be watched at all (#141).
//
// The observer now registers `candidateInverses` through `addInverseListener`
// and decides each candidate by reading the result. The inverses carry no
// operation, so there is no label left to get wrong.
//
// No arbitrary timeouts anywhere (CLAUDE.md). Every assertion below runs after
// `j.fact` has resolved, which awaits the notification the re-check runs
// inside, or after an explicit `observer.processed()`.

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

// Negating the witness itself, which is what lets a child collection's row be
// restored rather than only withdrawn.
class RetirementRevoked {
    static Type = "Test.RetirementRevoked" as const;
    type = RetirementRevoked.Type;
    constructor(public retired: MirrorRetired) { }
}

class Root {
    static Type = "Test.Root" as const;
    type = Root.Type;
    constructor(public owner: User, public identifier: string) { }
}

class Task {
    static Type = "Test.Task" as const;
    type = Task.Type;
    constructor(public root: Root, public name: string) { }
}

class Done {
    static Type = "Test.Done" as const;
    type = Done.Type;
    constructor(public task: Task) { }
}

class Note {
    static Type = "Test.Note" as const;
    type = Note.Type;
    constructor(public root: Root, public text: string) { }
}

// One fact that falsifies two sibling conditions at once: it is a successor of
// the task and of the root, so a single save makes both `notExists` false.
class Sweep {
    static Type = "Test.Sweep" as const;
    type = Sweep.Type;
    constructor(public task: Task, public root: Root) { }
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

class Channel {
    static Type = "Test.Channel" as const;
    type = Channel.Type;
    constructor(public owner: User, public name: string) { }
}

class Message {
    static Type = "Test.Message" as const;
    type = Message.Type;
    constructor(public channel: Channel, public text: string) { }
}

class Read {
    static Type = "Test.Read" as const;
    type = Read.Type;
    constructor(public message: Message, public user: User) { }
}

const model = buildModel(b => b
    .type(User)
    .type(Account, x => x.predecessor("owner", User))
    .type(Mirror, x => x.predecessor("account", Account))
    .type(MirrorRetired, x => x.predecessor("mirror", Mirror))
    .type(RetirementRevoked, x => x.predecessor("retired", MirrorRetired))
    .type(Root, x => x.predecessor("owner", User))
    .type(Task, x => x.predecessor("root", Root))
    .type(Done, x => x.predecessor("task", Task))
    .type(Note, x => x.predecessor("root", Root))
    .type(Sweep, x => x
        .predecessor("task", Task)
        .predecessor("root", Root)
    )
    .type(Item, x => x.predecessor("root", Root))
    .type(Block, x => x.predecessor("item", Item))
    .type(Release, x => x.predecessor("block", Block))
    .type(Revoke, x => x.predecessor("release", Release))
    .type(Channel, x => x.predecessor("owner", User))
    .type(Message, x => x.predecessor("channel", Channel))
    .type(Read, x => x
        .predecessor("message", Message)
        .predecessor("user", User)
    )
);

// `exists { notExists }`. An account is in the result while it still has a
// mirror that has not been retired. Retiring the last current mirror takes the
// account out — and that is the change the old inverse could not report,
// because it required a current mirror on the new graph, where there is none.
const accountsWithCurrentMirror = model.given(User).match((user, facts) =>
    facts.ofType(Account)
        .join(account => account.owner, user)
        .exists(account => facts.ofType(Mirror)
            .join(mirror => mirror.account, account)
            .notExists(mirror => facts.ofType(MirrorRetired)
                .join(retired => retired.mirror, mirror)))
);

// Two sibling `notExists` conditions that one `Sweep` falsifies together. Each
// of the old inverses dropped its own condition and kept its sibling, which
// the same fact had just falsified, so neither found the row.
const unsweptTasks = model.given(Root).match((root, facts) =>
    facts.ofType(Task)
        .join(task => task.root, root)
        .notExists(task => facts.ofType(Sweep)
            .join(sweep => sweep.task, task))
        .notExists(task => facts.ofType(Sweep)
            .join(sweep => sweep.root, root))
);

// `notExists { notExists { exists } }`. An item is unblocked while no block of
// it lacks a revoked release. Adding the innermost `Revoke` makes the inner
// `exists` true, which removes the middle solution, which ADDS the row three
// levels up.
const unblockedItems = model.given(Root).match((root, facts) =>
    facts.ofType(Item)
        .join(item => item.root, root)
        .notExists(item => facts.ofType(Block)
            .join(block => block.item, item)
            .notExists(block => facts.ofType(Release)
                .join(release => release.block, block)
                .exists(release => facts.ofType(Revoke)
                    .join(revoke => revoke.release, release))))
);

// Issue #141. `p1` is joined only from inside the existential condition, so
// `invertSpecification` refused the specification outright and `j.watch` threw.
const unreadMessages = model.given(User, Channel).match((user, channel, facts) =>
    facts.ofType(Message)
        .join(message => message.channel, channel)
        .notExists(message => facts.ofType(Read)
            .join(read => read.message, message)
            .join(read => read.user, user))
);

// A child collection whose rows are filtered by `notExists`, with the witness
// itself negatable so the child can be restored as well as withdrawn.
const accountsWithTheirCurrentMirrors = model.given(User).match((user, facts) =>
    facts.ofType(Account)
        .join(account => account.owner, user)
        .select(account => ({
            account,
            mirrors: facts.ofType(Mirror)
                .join(mirror => mirror.account, account)
                .notExists(mirror => facts.ofType(MirrorRetired)
                    .join(retired => retired.mirror, mirror)
                    .notExists(retired => facts.ofType(RetirementRevoked)
                        .join(revoked => revoked.retired, retired)))
        }))
);

// A flat `notExists`, for the startup window. The window is about *when* a
// candidate is decided rather than about which level decides it, so the
// simplest shape that has a transition either way keeps the test on that
// question.
const currentTasks = model.given(Root).match((root, facts) =>
    facts.ofType(Task)
        .join(task => task.root, root)
        .notExists(task => facts.ofType(Done)
            .join(done => done.task, task))
);

// A child collection with no condition on `Task` at all, under a root match on
// `Note`. A purge condition naming `Task` is then invisible to the root
// specification -- `testSpecificationForCompliance` never descends into a
// projection -- and reachable only through the flattening of this collection.
const notesWithAllTasks = model.given(Root).match((root, facts) =>
    facts.ofType(Note)
        .join(note => note.root, root)
        .select(note => ({
            note,
            tasks: facts.ofType(Task)
                .join(task => task.root, root)
        }))
);

// A purge condition on `Task`: compliance then requires every match on `Task`
// to carry this same condition negated, which `notesWithAllTasks` does not.
const taskPurgedWhenDone = model.given(Task).match((task, facts) =>
    facts.ofType(Done)
        .join(done => done.task, task)
);

/** A replicator with nothing to say, so the observer's reads see only what the test saved. */
class QuietNetwork implements Network {
    feeds(start: FactReference[], specification: Specification): Promise<FeedsResponse> {
        return Promise.resolve({ feeds: [] });
    }

    fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
        return Promise.resolve({ references: [], bookmark });
    }

    streamFeed(): () => void {
        return () => { };
    }

    load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
        return Promise.resolve([]);
    }

    async intersectForSubscribe(start: FactReference[], specification: Specification) {
        return [{ start, specification }];
    }
}

/** A replicator that cannot be reached, so the starting fetch rejects. */
class UnreachableNetwork extends QuietNetwork {
    feeds(): Promise<FeedsResponse> {
        return Promise.reject(new Error("the replicator is unreachable"));
    }
}

/**
 * A store that runs one hook after a read of one named specification returns.
 *
 * That is how a test lands a fact in the window between the observer's starting
 * read and the moment that read becomes its held set — the window the startup
 * buffer covers. Keyed on the specification object `j.watch` passes through to
 * the observer, so the hook fires on that read and on no other. Deterministic:
 * the fact arrives at a point in the sequence rather than after a delay.
 */
class StoreWithReadHook extends MemoryStore {
    private hooks = new Map<Specification, () => Promise<void>>();

    public afterReadOf(specification: Specification, hook: () => Promise<void>): void {
        this.hooks.set(specification, hook);
    }

    async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        const results = await super.read(start, specification);
        const hook = this.hooks.get(specification);
        if (hook) {
            this.hooks.delete(specification);
            await hook();
        }
        return results;
    }
}

/**
 * A store that records how many rows its reads returned, so a test can measure
 * the work one save costs rather than timing it.
 */
class StoreCountingRows extends MemoryStore {
    public rowsRead = 0;

    async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        const results = await super.read(start, specification);
        this.rowsRead += results.length;
        return results;
    }
}

interface PeerOptions {
    /** The store, so a test can hook its reads. */
    store?: MemoryStore;
    /** The replicator. */
    network?: Network;
    /** Purge conditions, which `FactManager.read` checks each specification against. */
    purgeConditions?: Specification[];
}

function createPeer(options: PeerOptions = {}) {
    const store = options.store ?? new MemoryStore();
    const observableSource = new ObservableSource(store);
    const factManager = new FactManager(
        new PassThroughFork(store), observableSource, store,
        options.network ?? new QuietNetwork(), options.purgeConditions ?? []);
    const j = new Jinaga(new AuthenticationNoOp(), factManager, new SyncStatusNotifier());
    return { j, factManager, store };
}

/**
 * Collect what the observer currently holds, by hash, through the handler and
 * the removal function it returns. This is the observer's own notion of the
 * set a caller is holding: a row enters on `onAdded` and leaves when its
 * removal runs, which is exactly what the issue's randomized case compares
 * against `j.query`.
 */
function collectHeld<T>(identify: (value: T) => string) {
    const held = new Set<string>();
    const added: string[] = [];
    const removed: string[] = [];
    const handler = (value: T) => {
        const key = identify(value);
        held.add(key);
        added.push(key);
        return () => {
            held.delete(key);
            removed.push(key);
        };
    };
    return { held, added, removed, handler };
}

describe("an observer re-checks its candidates", () => {
    let j: Jinaga;
    let owner: User;

    beforeEach(async () => {
        ({ j } = createPeer());
        owner = await j.fact(new User("--- OWNER ---"));
    });

    it("withdraws the account when its only current mirror is retired", async () => {
        // Case 1 of issue #345, and the `exists { notExists }` shape of #338.
        const account = await j.fact(new Account(owner, "one"));
        const mirror = await j.fact(new Mirror(account, "https://one"));

        const { held, removed, handler } = collectHeld<Account>(a => j.hash(a));
        const observer = j.watch(accountsWithCurrentMirror, owner, handler);
        await observer.loaded();
        expect(held).toEqual(new Set([j.hash(account)]));

        await j.fact(new MirrorRetired(mirror));
        await observer.processed();

        expect(removed).toEqual([j.hash(account)]);
        expect(held.size).toEqual(0);
        expect(await j.query(accountsWithCurrentMirror, owner)).toEqual([]);

        observer.stop();
    });

    it("keeps the account when one of two current mirrors is retired", async () => {
        // The other half of case 1: a removal must not fire for a row that
        // another witness still keeps in the result.
        const account = await j.fact(new Account(owner, "one"));
        const first = await j.fact(new Mirror(account, "https://one"));
        await j.fact(new Mirror(account, "https://two"));

        const { held, removed, handler } = collectHeld<Account>(a => j.hash(a));
        const observer = j.watch(accountsWithCurrentMirror, owner, handler);
        await observer.loaded();
        expect(held).toEqual(new Set([j.hash(account)]));

        await j.fact(new MirrorRetired(first));
        await observer.processed();

        expect(removed).toEqual([]);
        expect(held).toEqual(new Set([j.hash(account)]));
        expect((await j.query(accountsWithCurrentMirror, owner)).map(a => j.hash(a)))
            .toEqual([j.hash(account)]);

        observer.stop();
    });

    it("adds and removes the row once when one fact falsifies two sibling conditions", async () => {
        // Case 2. One `Sweep` is a successor of both the task and the root, so
        // it falsifies both siblings in the same save.
        const root = await j.fact(new Root(owner, "r"));
        const task = await j.fact(new Task(root, "t"));

        const { held, added, removed, handler } = collectHeld<Task>(t => j.hash(t));
        const observer = j.watch(unsweptTasks, root, handler);
        await observer.loaded();
        expect(added).toEqual([j.hash(task)]);

        await j.fact(new Sweep(task, root));
        await observer.processed();

        expect(added).toEqual([j.hash(task)]);
        expect(removed).toEqual([j.hash(task)]);
        expect(held.size).toEqual(0);
        expect(await j.query(unsweptTasks, root)).toEqual([]);

        observer.stop();
    });

    it("delivers the removal for a label reused after an existential condition", async () => {
        // Case 3, issue #343. `x` names the `Done` inside the condition and the
        // `Note` at the top level. `invertExistentialConditions` concatenated
        // the outer and inner matches and found matches by name, so the inverse
        // for the condition was built around the `Note` rather than the `Done`.
        //
        // Written against the raw specification rather than the model DSL,
        // because the defect is in which match a NAME resolves to, and the DSL
        // chooses label names itself.
        const { j: peer, factManager } = createPeer();
        const peerOwner = await peer.fact(new User("--- OWNER ---"));
        const root = await peer.fact(new Root(peerOwner, "r"));
        const task = await peer.fact(new Task(root, "t"));
        await peer.fact(new Note(root, "n"));

        const path = (role: string, predecessorType: string, labelRight: string): PathCondition =>
            ({ type: "path", rolesLeft: [{ name: role, predecessorType }], labelRight, rolesRight: [] });
        const notExists = (matches: Match[]): ExistentialCondition =>
            ({ type: "existential", exists: false, matches });
        const match = (name: string, type: string, conditions: Condition[]): Match =>
            ({ unknown: { name, type }, conditions });

        const reusedLabel: Specification = {
            given: [{ label: { name: "r", type: Root.Type }, conditions: [] }],
            matches: [
                match("t", Task.Type, [
                    path("root", Root.Type, "r"),
                    notExists([match("x", Done.Type, [path("task", Task.Type, "t")])])
                ]),
                match("x", Note.Type, [path("root", Root.Type, "r")])
            ],
            projection: {
                type: "composite",
                components: [
                    { name: "t", type: "hash", label: "t" },
                    { name: "x", type: "hash", label: "x" }
                ]
            }
        };

        const { held, added, removed, handler } =
            collectHeld<{ t: string; x: string }>(row => `${row.t}|${row.x}`);
        const observer = factManager.startObserver(
            [{ type: Root.Type, hash: Jinaga.hash(root) }], reusedLabel, handler, false);
        await observer.loaded();
        expect(added).toHaveLength(1);

        await peer.fact(new Done(task));
        await observer.processed();

        expect(removed).toEqual(added);
        expect(held.size).toEqual(0);
        expect(await factManager.read(
            [{ type: Root.Type, hash: Jinaga.hash(root) }], reusedLabel)).toEqual([]);

        observer.stop();
    });

    it("adds the row when the innermost exists of a depth-three negation becomes true", async () => {
        // Case 4. The new fact makes the innermost `exists` true, which removes
        // the middle solution, which adds the row. The middle level LOST its
        // solution, so its `notExists` is false on the new graph and the old
        // inverse found nothing there.
        const root = await j.fact(new Root(owner, "r"));
        const item = await j.fact(new Item(root, "i"));
        const block = await j.fact(new Block(item, "b"));
        const release = await j.fact(new Release(block, "rel"));

        const { held, added, handler } = collectHeld<Item>(i => j.hash(i));
        const observer = j.watch(unblockedItems, root, handler);
        await observer.loaded();
        expect(held.size).toEqual(0);

        await j.fact(new Revoke(release));
        await observer.processed();

        expect(added).toEqual([j.hash(item)]);
        expect(held).toEqual(new Set([j.hash(item)]));
        expect((await j.query(unblockedItems, root)).map(i => j.hash(i)))
            .toEqual([j.hash(item)]);

        observer.stop();
    });

    it("watches a specification whose given is joined only inside a negation", async () => {
        // Case 5, issue #141. `addSpecificationListener` accepted only
        // one-given inverses, and `shakeTree` refused this shape outright, so
        // `j.watch` threw rather than starting. The candidate inverses bind the
        // subscription's givens in the read (#344), which is what makes it
        // watchable.
        const channel = await j.fact(new Channel(owner, "general"));
        const reader = await j.fact(new User("--- READER ---"));
        const message = await j.fact(new Message(channel, "hello"));

        const { held, added, removed, handler } = collectHeld<Message>(m => j.hash(m));
        const observer = j.watch(unreadMessages, reader, channel, handler);
        await observer.loaded();
        expect(added).toEqual([j.hash(message)]);

        await j.fact(new Read(message, reader));
        await observer.processed();

        expect(removed).toEqual([j.hash(message)]);
        expect(held.size).toEqual(0);
        expect(await j.query(unreadMessages, reader, channel)).toEqual([]);

        observer.stop();
    });

    it("removes and restores a child collection row as its witness arrives and is negated", async () => {
        // Case 6. The change is inside a nested collection, so the parent row's
        // own membership never changes: the root read reports no transition at
        // all, and only the nested level's own re-check can decide it.
        const account = await j.fact(new Account(owner, "one"));
        const mirror = await j.fact(new Mirror(account, "https://one"));

        const mirrorsHeld = new Set<string>();
        const observer = j.watch(accountsWithTheirCurrentMirrors, owner, row => {
            row.mirrors.onAdded(m => {
                const hash = j.hash(m);
                mirrorsHeld.add(hash);
                return () => {
                    mirrorsHeld.delete(hash);
                };
            });
        });
        await observer.loaded();
        await observer.processed();
        expect(mirrorsHeld).toEqual(new Set([j.hash(mirror)]));

        const retired = await j.fact(new MirrorRetired(mirror));
        await observer.processed();
        expect(mirrorsHeld.size).toEqual(0);

        await j.fact(new RetirementRevoked(retired));
        await observer.processed();
        expect(mirrorsHeld).toEqual(new Set([j.hash(mirror)]));

        observer.stop();
    });
});

describe("an observer over notExists nested to depth three", () => {
    /**
     * Every fact of one population, in no particular order. A `j.fact` of any
     * of them saves its unsaved ancestors in the same batch, so a random
     * permutation gives both a random topological order and random batch
     * sizes.
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

    it("holds exactly the rows a query returns, after every batch", async () => {
        // Case 7. The property the re-check is for, measured rather than
        // argued: what the observer holds equals `j.query` of the same
        // specification, whatever order the facts arrived in and whichever
        // batches they came in.
        const random = seededRandom(20261024);

        for (let attempt = 0; attempt < 8; attempt++) {
            const { j } = createPeer();
            const owner = await j.fact(new User("--- OWNER ---"));
            const { root, facts } = population(owner);

            const { held, handler } = collectHeld<Item>(i => j.hash(i));
            const observer = j.watch(unblockedItems, root, handler);
            await observer.loaded();

            for (const fact of shuffled(facts, random)) {
                await j.fact(fact as any);
                await observer.processed();

                const rows = await j.query(unblockedItems, root);
                expect([...held].sort()).toEqual(rows.map(i => j.hash(i)).sort());
            }

            observer.stop();
        }
    });
});

// Issue #345's startup clause, added when the issue was amended on 2026-10-24.
// Listeners are installed before the starting read, deliberately, so a fact
// that arrives during it is not missed. It cannot be decided yet, because
// `held` is not the result until the read finishes, so it is buffered. The
// question these tests settle is when that buffer is released: delivery calls
// the caller's own handler, which may park for as long as it likes, so a buffer
// released after the initial delivery is a buffer a suspended handler can hold
// open indefinitely. A decision must never wait on a delivery.
describe("an observer's startup window", () => {
    it("delivers and withdraws a row while the initial delivery waits on a handler", async () => {
        // Case 8. The first row's handler never returns, so the initial
        // delivery stays suspended for the whole of this test. Everything that
        // follows is decided and delivered anyway.
        const { j } = createPeer();
        const owner = await j.fact(new User("--- OWNER ---"));
        const root = await j.fact(new Root(owner, "r"));
        const first = await j.fact(new Task(root, "first"));

        let releaseFirst: () => void = () => { };
        const firstReleased = new Promise<void>(resolve => { releaseFirst = resolve; });
        let firstEntered: () => void = () => { };
        const firstHandlerEntered = new Promise<void>(resolve => { firstEntered = resolve; });

        const held = new Set<string>();
        const added: string[] = [];
        const removed: string[] = [];
        const observer = j.watch(currentTasks, root, async (task: Task) => {
            const hash = j.hash(task);
            held.add(hash);
            added.push(hash);
            if (hash === j.hash(first)) {
                firstEntered();
                await firstReleased;
            }
            return async () => {
                held.delete(hash);
                removed.push(hash);
            };
        });

        // Not `loaded()`: the initial delivery is what suspends, so `loaded()`
        // does not resolve until this test releases it at the end.
        await firstHandlerEntered;

        const second = await j.fact(new Task(root, "second"));
        expect(added).toEqual([j.hash(first), j.hash(second)]);

        await j.fact(new Done(second));
        expect(removed).toEqual([j.hash(second)]);
        expect(held).toEqual(new Set([j.hash(first)]));

        releaseFirst();
        await observer.loaded();
        await observer.processed();
        expect(await j.query(currentTasks, root)).toEqual([first]);

        observer.stop();
    });

    it("completes a handler that waits on another row of the same watch", async () => {
        // Case 9. The first row's handler waits for the second row to be
        // delivered, and the fact that adds the second row arrives inside the
        // startup window. Releasing that window only after the initial delivery
        // has finished every handler makes this a deadlock: the delivery waits
        // on the handler, the handler waits on the decision, and the decision
        // waits on the window.
        const store = new StoreWithReadHook();
        const { j } = createPeer({ store });
        const owner = await j.fact(new User("--- OWNER ---"));
        const root = await j.fact(new Root(owner, "r"));
        const first = await j.fact(new Task(root, "first"));
        const second = new Task(root, "second");

        store.afterReadOf(currentTasks.specification, async () => {
            await j.fact(second);
        });

        let secondDelivered: () => void = () => { };
        const secondIsDelivered = new Promise<void>(resolve => { secondDelivered = resolve; });

        const added: string[] = [];
        const completed: string[] = [];
        const observer = j.watch(currentTasks, root, async (task: Task) => {
            const hash = j.hash(task);
            added.push(hash);
            if (hash === j.hash(first)) {
                await secondIsDelivered;
            }
            else {
                secondDelivered();
            }
            completed.push(hash);
        });

        await observer.loaded();
        await observer.processed();

        const both = [j.hash(first), j.hash(second)].sort();
        expect([...added].sort()).toEqual(both);
        expect([...completed].sort()).toEqual(both);

        observer.stop();
    });

    it("decides candidates that arrive after the starting fetch fails", async () => {
        // Reported against this layer from the review pass on #355. The
        // starting read runs only after the fetch on the uncached path, so a
        // rejected fetch leaves the window open with nothing left to close it,
        // and every later candidate joins a buffer nothing releases. The
        // observer stays subscribed and never notifies again.
        const { j } = createPeer({ network: new UnreachableNetwork() });
        const owner = await j.fact(new User("--- OWNER ---"));
        const root = await j.fact(new Root(owner, "r"));

        const { held, added, handler } = collectHeld<Task>(t => j.hash(t));
        const observer = j.watch(currentTasks, root, handler);
        await expect(observer.loaded()).rejects.toThrow("the replicator is unreachable");

        const task = await j.fact(new Task(root, "first"));
        await observer.processed();
        expect(added).toEqual([j.hash(task)]);
        expect(held).toEqual(new Set([j.hash(task)]));

        await j.fact(new Done(task));
        await observer.processed();
        expect(held.size).toEqual(0);

        observer.stop();
    });
});

describe("an observer reading a nested level", () => {
    it("keeps a child collection current when a purge condition names a type only it reaches", async () => {
        // Reported against this layer from the review pass on #355.
        // `testSpecificationForCompliance` examines a specification's own
        // matches and never descends into its projection, so the root
        // specification here is never checked against a purge condition on
        // `Task`. The nested level's specification is the parent's matches
        // followed by the collection's own, which does present that match, so
        // checking the flattened form again fails where the root passed. The
        // throw is contained by listener containment, leaving the collection
        // silently out of date.
        const { j } = createPeer({ purgeConditions: [taskPurgedWhenDone.specification] });
        const owner = await j.fact(new User("--- OWNER ---"));
        const root = await j.fact(new Root(owner, "r"));
        await j.fact(new Note(root, "n"));
        const first = await j.fact(new Task(root, "first"));

        const tasksHeld = new Set<string>();
        const observer = j.watch(notesWithAllTasks, root, row => {
            row.tasks.onAdded(task => {
                const hash = j.hash(task);
                tasksHeld.add(hash);
                return () => {
                    tasksHeld.delete(hash);
                };
            });
        });
        await observer.loaded();
        await observer.processed();
        expect(tasksHeld).toEqual(new Set([j.hash(first)]));

        const second = await j.fact(new Task(root, "second"));
        await observer.processed();
        expect(tasksHeld).toEqual(new Set([j.hash(first), j.hash(second)]));

        observer.stop();
    });
});

describe("an observer hearing a fact of its given's type", () => {
    it("reads no rows when the fact is not its own given", async () => {
        // Reported by the review on 56eb045. `candidateInverses` pins unknowns,
        // and a given is not an unknown, so a given inverse is what tells a
        // subscription its given has arrived. Its pin is bound through an
        // unknown equal to both the new fact and the given, so an unrelated
        // fact of that type yields no solution — but `onCandidates` unioned
        // `held` in anyway on the strength of `ofGiven`, which made every
        // saved fact of a common given type re-read every level that holds
        // rows. The row stream, the proven sibling, returns early on an empty
        // result whichever inverse fired.
        const store = new StoreCountingRows();
        const { j } = createPeer({ store });
        const owner = await j.fact(new User("--- OWNER ---"));
        const root = await j.fact(new Root(owner, "r"));
        const tasks = [];
        for (let i = 0; i < 5; i++) {
            tasks.push(await j.fact(new Task(root, `task${i}`)));
        }

        const { held, handler } = collectHeld<Task>(t => j.hash(t));
        const observer = j.watch(currentTasks, root, handler);
        await observer.loaded();
        expect(held.size).toEqual(5);

        store.rowsRead = 0;
        await j.fact(new Root(owner, "unrelated"));
        await observer.processed();

        expect(store.rowsRead).toEqual(0);
        expect(held.size).toEqual(5);

        // The observer still hears about its own given's successors, so the
        // early return has not silenced it.
        await j.fact(new Done(tasks[0]));
        await observer.processed();
        expect(held.size).toEqual(4);

        observer.stop();
    });
});
