import {
    AuthenticationNoOp, FactManager, FactReference, Jinaga, MemoryStore, Network, ObservableSource,
    PassThroughFork, ProjectedResult, Specification, SyncStatusNotifier, User, buildModel
} from "@src";

// Issue #376. The observer used to decide each inverse candidate with a second
// read: `readMembership` ran a per-row membership specification and
// `recheckCandidates` compared its answer with `held`. jinaga-spec's exact
// inverses (jinaga/jinaga-spec#19) report the direction as well as the row, so
// the rows are applied directly and the second read is gone.
//
// That second read was also what made the observer immune to the order its
// reads finish in. Reads run in the save path, and a read whose snapshot was
// fixed first can return last, so applied directly its rows could undo a later
// read's answer. Every read is therefore numbered before it runs, and a row's
// highest number wins. These are the tests of that numbering, and of what the
// directly applied row carries into a projection.
//
// No arbitrary timeouts anywhere (CLAUDE.md). The gate below is a deterministic
// rendezvous: the test waits for the read to have entered it, not for a delay.

class Account {
    static Type = "Exact.Account" as const;
    type = Account.Type;
    constructor(public owner: User, public identifier: string) { }
}

class Mirror {
    static Type = "Exact.Mirror" as const;
    type = Mirror.Type;
    constructor(public account: Account, public url: string) { }
}

class MirrorRetired {
    static Type = "Exact.MirrorRetired" as const;
    type = MirrorRetired.Type;
    constructor(public mirror: Mirror) { }
}

class Root {
    static Type = "Exact.Root" as const;
    type = Root.Type;
    constructor(public owner: User, public identifier: string) { }
}

class Note {
    static Type = "Exact.Note" as const;
    type = Note.Type;
    constructor(public root: Root, public text: string) { }
}

class Task {
    static Type = "Exact.Task" as const;
    type = Task.Type;
    constructor(public root: Root, public name: string) { }
}

class Done {
    static Type = "Exact.Done" as const;
    type = Done.Type;
    constructor(public task: Task) { }
}

const model = buildModel(b => b
    .type(User)
    .type(Account, x => x.predecessor("owner", User))
    .type(Mirror, x => x.predecessor("account", Account))
    .type(MirrorRetired, x => x.predecessor("mirror", Mirror))
    .type(Root, x => x.predecessor("owner", User))
    .type(Note, x => x.predecessor("root", Root))
    .type(Task, x => x.predecessor("root", Root))
    .type(Done, x => x.predecessor("task", Task))
);

// `exists { notExists }`. An account is in the result while it still has a
// mirror that has not been retired. One add inverse waits for a `Mirror` and
// one remove inverse waits for a `MirrorRetired`, so the two directions are
// reported by reads this test can order against each other.
const accountsWithCurrentMirror = model.given(User).match((user, facts) =>
    facts.ofType(Account)
        .join(account => account.owner, user)
        .exists(account => facts.ofType(Mirror)
            .join(mirror => mirror.account, account)
            .notExists(mirror => facts.ofType(MirrorRetired)
                .join(retired => retired.mirror, mirror)))
);

// A nested collection whose projection reads the child's own field, the child
// as a fact, and the PARENT's field. An add inverse's tuple also names the
// pinned fact as `__f`, the labels its reordering lifted out of the existential
// condition, and the `given` match `reduceGivenConditions` adds; none of those
// may reach the projection.
const notesWithCurrentTasks = model.given(Root).match((root, facts) =>
    facts.ofType(Note)
        .join(note => note.root, root)
        .select(note => ({
            text: note.text,
            tasks: facts.ofType(Task)
                .join(task => task.root, root)
                .notExists(task => facts.ofType(Done)
                    .join(done => done.task, task))
                .select(task => ({
                    name: task.name,
                    task: task,
                    note: note.text
                }))
        }))
);

/** A replicator with nothing to say, so the observer's reads see only what the test saved. */
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
 * and that returns later than that one. The rendezvous is deterministic --
 * `entered` resolves when the read is parked, so the test never waits on a
 * clock.
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

function createPeer(store: MemoryStore = new MemoryStore()) {
    const observableSource = new ObservableSource(store);
    const factManager = new FactManager(
        new PassThroughFork(store), observableSource, store, new QuietNetwork(), []);
    const j = new Jinaga(new AuthenticationNoOp(), factManager, new SyncStatusNotifier());
    return { j, store };
}

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

describe("an observer applying exact inverses", () => {
    it("drops an add from a read a later read has already answered", async () => {
        const store = new GatedStore();
        const { j } = createPeer(store);
        const owner = await j.fact(new User("--- OWNER ---"));
        const account = await j.fact(new Account(owner, "one"));

        const { held, added, removed, handler } = collectHeld<Account>(a => j.hash(a));
        const observer = j.watch(accountsWithCurrentMirror, owner, handler);
        await observer.loaded();
        expect(added).toEqual([]);

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
        await observer.processed();

        expect(added).toEqual([]);
        expect(removed).toEqual([]);
        expect(held.size).toEqual(0);
        expect(await j.query(accountsWithCurrentMirror, owner)).toEqual([]);

        observer.stop();
    });

    it("drops a remove from a read a later read has already answered", async () => {
        const store = new GatedStore();
        const { j } = createPeer(store);
        const owner = await j.fact(new User("--- OWNER ---"));
        const account = await j.fact(new Account(owner, "one"));
        const first = await j.fact(new Mirror(account, "https://one"));

        const { held, added, removed, handler } = collectHeld<Account>(a => j.hash(a));
        const observer = j.watch(accountsWithCurrentMirror, owner, handler);
        await observer.loaded();
        expect(added).toEqual([j.hash(account)]);

        // The remove inverse's read sees the account's only mirror retired and
        // parks, holding a withdrawal that is about to be overtaken.
        const retired = new MirrorRetired(first);
        store.gateReadsFrom(j.hash(retired));
        const retiredSaved = j.fact(retired);
        await store.entered;

        await j.fact(new Mirror(account, "https://two"));

        store.releaseGate();
        await retiredSaved;
        await observer.processed();

        expect(removed).toEqual([]);
        expect(held).toEqual(new Set([j.hash(account)]));
        expect((await j.query(accountsWithCurrentMirror, owner)).map(a => j.hash(a)))
            .toEqual([j.hash(account)]);

        observer.stop();
    });

    it("delivers a child row from an add inverse exactly as a query projects it", async () => {
        const { j } = createPeer();
        const owner = await j.fact(new User("--- OWNER ---"));
        const root = await j.fact(new Root(owner, "r"));
        await j.fact(new Note(root, "the note"));

        const delivered: { name: string; task: Task; note: string }[] = [];
        const observer = j.watch(notesWithCurrentTasks, root, note => {
            note.tasks.onAdded(task => {
                delivered.push(task);
            });
        });
        await observer.loaded();
        await observer.processed();
        expect(delivered).toEqual([]);

        await j.fact(new Task(root, "arriving"));
        await observer.processed();

        const queried = await j.query(notesWithCurrentTasks, root);
        expect(queried.length).toEqual(1);
        expect(delivered).toEqual(queried[0].tasks);

        observer.stop();
    });
});
