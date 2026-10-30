import { FeedDecision } from "../http/messages";
import { FactManager } from "../managers/factManager";
import { InverseListener, InverseReadNumbering } from "../observable/observable";
import { MembershipSpecification, exactInverses, membershipSpecification } from "../specification/inverse-candidates";
import { SpecificationRow, rowIdentityLabels, toRow, toRows } from "../specification/row";
import { Specification } from "../specification/specification";
import { FactReference, ProjectedResult, ReferencesByName, computeTupleSubsetHash } from "../storage";
import { Trace } from "../util/trace";
import { givenCandidateInverse, membershipStart } from "./recheck";

/**
 * One row entering or leaving a specification's result set.
 *
 * `result` and `rowHash` are the row itself, identical to what `queryRows`
 * returns. `operation` says which way it went.
 */
export interface SpecificationChange<U> extends SpecificationRow<U> {
    operation: "added" | "removed";
}

export interface RowStreamOptions {
    /**
     * Maximum notifications held for the consumer. Beyond it the oldest is
     * dropped and counted.
     *
     * The queue drops rather than pushing back because back pressure here
     * would block the listener, and a blocked listener blocks the `save()`
     * behind it: precisely the wedge #246 was and #249 bounded. Dropping is
     * safe for the consumer this exists for, whose periodic `queryRows` sweep
     * is the source of truth, and `dropped` is there to be alerted on.
     *
     * The rows a `...Rows` method starts with are NOT subject to this bound.
     * They came from a read, which is the reliable path; only the hint path is
     * bounded.
     */
    capacity?: number;

    /**
     * Milliseconds to wait for the replicator before giving up, failing the
     * start with a `FeedTimeoutError`.
     *
     * It bounds the whole exchange the start waits on, not only its second
     * half: registering the specification's feeds and then receiving the first
     * response on each. A silent replicator hangs at either, and one budget
     * covers both, so the bound is what the caller asked for rather than twice
     * it. Must be a positive, finite number; anything else is refused rather
     * than quietly ignored.
     *
     * Opt-in, and deliberately without a default (issue #280). A cold start on
     * a large candidate set can legitimately take minutes, so a default bound
     * would turn a slow success into a retry loop; that trap has been sprung
     * here before, in a supervisor that timed out first loads. Without this the
     * wait has no bound at all, so a replicator that accepts the connection and
     * never answers leaves the returned promise pending, and a service that
     * awaits `subscribeRows` during boot never reaches its listener.
     *
     * Set it when a caller has somewhere better to be than the replicator: a
     * boot path, a health check, a supervisor that retries. Size it against a
     * cold start rather than a warm one.
     *
     * It bounds the feed, so it applies to `subscribeRows` and
     * `subscribeChanges`. `watchRows` and `watchChanges` hold no feed and
     * ignore it.
     */
    feedTimeoutMs?: number;
}

export const DEFAULT_ROW_STREAM_CAPACITY = 1024;

/**
 * A running observation, delivered by pull.
 *
 * ```ts
 * const rows = await j.subscribeRows(outstanding, tenant);
 * for await (const change of rows) {
 *     if (change.operation === "added") await handle(change.result);
 * }
 * ```
 *
 * One consumer: a second iteration throws. The library owns the listener that
 * feeds this, so it does nothing but enqueue, and the consumer's work happens
 * on its own turn rather than inside the `save()` that produced the change.
 */
export interface RowStream<U> extends AsyncIterable<SpecificationChange<U>> {
    /**
     * Release the listeners and the feed, and end the iteration.
     */
    stop(): void;
    /**
     * Changes discarded to stay within capacity. Alert on it.
     */
    readonly dropped: number;
    /**
     * Changes waiting to be consumed.
     */
    readonly pending: number;
}

/**
 * Where a stream's first changes come from. Not a caller-facing option: the
 * method name says it. `...Rows` starts from the rows that match now,
 * `...Changes` from the next change.
 */
type RowOrigin = "current" | "now";

/**
 * Whether the specification's feed is held open. Not a caller-facing option
 * either: `subscribe...` holds it, `watch...` does not, which is what those
 * two words have meant here since long before rows had names.
 */
type FeedPolicy = "held" | "none";

interface StartOptions {
    from: RowOrigin;
    feed: FeedPolicy;
    capacity?: number;
    feedTimeoutMs?: number;
}

/**
 * What a consumer is handed for one row: the projection and the row identity,
 * and nothing a row carries internally.
 *
 * The rows a stream holds also carry the references a membership read starts
 * from (#359). Spreading one into the change would put them in the consumer's
 * hands, where `SpecificationChange` does not declare them and no consumer
 * asked for them.
 */
function toChange<U>(row: SpecificationRow<U>, operation: "added" | "removed"): SpecificationChange<U> {
    return { result: row.result, rowHash: row.rowHash, operation };
}

/**
 * The queue behind a stream.
 *
 * Two buffers, deliberately. `starting` holds what the read produced and is
 * never dropped, because the read is the reliable path and a consumer that
 * silently lost part of its backlog would have no way to notice. `changes`
 * holds notifications, is bounded, and drops its oldest, because a
 * notification is a hint whose loss costs latency.
 */
class RowQueue<U> {
    private starting: SpecificationChange<U>[] = [];
    private changes: SpecificationChange<U>[] = [];
    /**
     * Consumers parked in `next()`, oldest first.
     *
     * A list rather than a single slot: the async iteration protocol allows
     * `next()` to be called again before the previous call settles, and a
     * single slot would overwrite the earlier resolver, leaving that consumer
     * hung forever with no error. `for await` never does this; a hand-written
     * consumer can.
     */
    private waiting: ((result: IteratorResult<SpecificationChange<U>>) => void)[] = [];
    private closed = false;
    public dropped = 0;

    constructor(private readonly capacity: number) { }

    get pending(): number {
        return this.starting.length + this.changes.length;
    }

    pushStarting(rows: SpecificationRow<U>[]): void {
        for (const row of rows) {
            const change = toChange(row, "added");
            if (!this.handOff(change)) {
                this.starting.push(change);
            }
        }
    }

    pushChanges(operation: "added" | "removed", rows: SpecificationRow<U>[]): void {
        for (const row of rows) {
            const change = toChange(row, operation);
            if (this.handOff(change)) {
                continue;
            }
            if (this.changes.length >= this.capacity) {
                this.changes.shift();
                this.dropped++;
                Trace.counter("row_stream_dropped", 1);
            }
            this.changes.push(change);
        }
    }

    close(): void {
        this.closed = true;
        const waiting = this.waiting;
        this.waiting = [];
        for (const resolve of waiting) {
            resolve({ value: undefined as any, done: true });
        }
    }

    next(): Promise<IteratorResult<SpecificationChange<U>>> {
        const change = this.starting.shift() ?? this.changes.shift();
        if (change !== undefined) {
            return Promise.resolve({ value: change, done: false });
        }
        if (this.closed) {
            return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise(resolve => {
            this.waiting.push(resolve);
        });
    }

    private handOff(change: SpecificationChange<U>): boolean {
        if (this.closed) {
            return true;
        }
        const waiting = this.waiting.shift();
        if (!waiting) {
            return false;
        }
        waiting({ value: change, done: false });
        return true;
    }
}

/**
 * One distribution-rule intersection of the stream's specification.
 *
 * A stream that holds a feed open has one branch per rule that authorizes it,
 * exactly as `ObserverImpl` does, and one passthrough branch carrying the
 * caller's own specification when no intersection occurred.
 */
interface RowBranch {
    specification: Specification;
    listeners: InverseListener[];
    feeds: string[];
    /**
     * This branch's specification rewritten to decide one fully bound tuple
     * (#359), pinning the caller's own match unknowns. Those are the labels
     * every branch carries under the same names, and the ones a candidate row
     * of this stream identifies itself by; a branch's lifted authorization
     * unknowns differ between branches and stay a search.
     */
    membership: MembershipSpecification;
}

/**
 * A candidate row, carrying what a membership read of it starts from.
 *
 * The references are the row identity labels alone, which is the subset a
 * membership read pins and the subset `rowHash` is computed over. The public
 * `SpecificationRow` does not carry them, and a change handed to a consumer
 * still carries only `result` and `rowHash`.
 */
interface CandidateRow<U> extends SpecificationRow<U> {
    references: ReferencesByName;
}

/** The references the row identity labels bind, out of a read's whole tuple. */
function identityReferences(tuple: ReferencesByName, labels: string[]): ReferencesByName {
    const references: ReferencesByName = {};
    for (const label of labels) {
        if (tuple.hasOwnProperty(label)) {
            references[label] = tuple[label];
        }
    }
    return references;
}

/**
 * One read's answer about one row: that it is in the result, or that it is not.
 *
 * jinaga-spec's exact inverses report changes rather than propose candidates:
 * every row an add inverse returns is in the new result and every row a remove
 * inverse returns is absent from it (`adds_sound`, `removes_sound`,
 * `changes_complete`, `exact_stream_correct`, jinaga/jinaga-spec#19). So an add
 * needs no second read to decide it.
 *
 * `read` is the number the read was given before it ran, which is what tells
 * this answer apart from a later read's answer about the same row. A report
 * produced by a membership read carries that read's number rather than the
 * inverse read's, because the membership read is the one it is an answer about.
 */
interface RowReport<U> {
    row: CandidateRow<U>;
    operation: "added" | "removed";
    read: number;
}

/**
 * One whole-result read, which is an answer about every row at once.
 *
 * This is what the arrival of the stream's own given produces. It is expanded
 * into reports when the batch is applied rather than when the read returns,
 * because the rows it did NOT return are reports only against `held`, and
 * `held` is stable only inside the decision chain.
 */
interface RowFullRead<U> {
    read: number;
    present: Map<string, CandidateRow<U>>;
}

/** The reports and whole-result reads waiting to be applied. */
interface RowReportBatch<U> {
    reports: RowReport<U>[];
    fullReads: RowFullRead<U>[];
}

function emptyBatch<U>(): RowReportBatch<U> {
    return { reports: [], fullReads: [] };
}

function isEmpty<U>(batch: RowReportBatch<U>): boolean {
    return batch.reports.length === 0 && batch.fullReads.length === 0;
}

class RowObserver<U> {
    private readonly rowIdentityLabels: string[];
    private readonly membershipPinned: string[];
    private givenHash: string;
    private branches: RowBranch[];
    private stopped = false;

    /**
     * The rows this stream has offered and not withdrawn, by `rowHash`.
     *
     * This is the stream's whole state. Each row is here because the latest
     * read that reported it found it in the result, and `decidedBy` records
     * which read that was. It is initialized from the starting read
     * — for `watchChanges` and `subscribeChanges` too, which do not *deliver*
     * those rows but still have to know them, or a later removal would be a
     * withdrawal of a row the stream never offered.
     *
     * It is bounded by the size of the result set, not by throughput, which is
     * why holding it is affordable where holding every delivered row for the
     * life of the stream was not.
     */
    private held: Map<string, CandidateRow<U>> = new Map();

    /**
     * The number of the latest read that decided each row, present or absent.
     *
     * This is what makes `held` independent of the order reads finish in. A
     * report from a read numbered at or below the entry is an answer about a
     * store state no newer than the one already applied, so it is dropped. An
     * entry is kept for a row that is absent as well as for one that is held —
     * a row withdrawn by read 9 must still outrank an add from read 7 arriving
     * late — and `endRead` forgets the absent ones once no older read is
     * outstanding.
     */
    private decidedBy: Map<string, number> = new Map();

    /** The next read number this stream hands out. */
    private nextRead = 0;
    /**
     * The reads this stream has numbered and that have not finished.
     *
     * A `decidedBy` entry for a row this stream does not hold is kept only to
     * outrank a report from a read that was already in flight. Once no
     * outstanding read is numbered below it, no such report can arrive, so the
     * entry is dropped — the same bound jinaga.net's `ObserverLocal.EndRead`
     * puts on its withdrawals.
     */
    private pendingReads = new Set<number>();
    /**
     * Rows withdrawn, with the read that withdrew each, kept only so
     * `decidedBy` can forget them.
     *
     * Nothing is decided from this list. It is the work list `endRead` drains,
     * and holding it apart from `decidedBy` is what keeps forgetting a withdrawn
     * row from costing a walk of every row the stream holds — the cost issue
     * #359 removed from absorbing a save.
     */
    private withdrawals: { rowHash: string; read: number }[] = [];
    /**
     * The number of the starting read, or `null` while it has not been taken.
     *
     * A report numbered below it is ignored. The starting read is an answer
     * about every row, taken after such a report's own read, so it has already
     * decided every row that report could be about.
     */
    private startupRead: number | null = null;
    /**
     * This stream's read numbering, handed to every inverse listener it
     * registers so the source numbers each read before it runs.
     */
    private readonly readNumbering: InverseReadNumbering = {
        beginRead: () => this.beginRead(),
        endRead: read => this.endRead(read)
    };
    /**
     * Whether a remove must be decided by a membership read rather than
     * applied directly.
     *
     * The remove direction of the exact inverses is proven only where a row
     * determines its solution (`ProjectsUnknowns`). That holds for an
     * unintersected stream: one passthrough branch, whose top-level unknowns
     * are exactly the row identity. `applySubscribeIntersection` breaks it two
     * ways. Within a branch, the lifted authorization matches are top-level
     * unknowns outside the key, so a row authorized by two bindings is two
     * solutions with one key, and a remove inverse that flips one binding's
     * condition reports a row the other binding still supports. Across
     * branches, `held` is the union, so a remove sound for branch A says
     * nothing about branch B.
     *
     * An add is sound either way and needs no hypothesis: a row an add inverse
     * returns is in that branch's result, and the stream's result is the union
     * over branches.
     */
    private removesNeedMembership = false;

    /**
     * Reports waiting to be applied, and the chain that applies them one batch
     * at a time.
     *
     * Applications are serialized per stream, so the order a consumer sees is
     * the order they were decided in. Reports that queue while an application
     * is running are taken by its successor in one go, where the link keeps
     * only the latest read's answer per row and emits the net change against
     * `held`.
     */
    private queuedReports: RowReportBatch<U> = emptyBatch<U>();
    private applyChain: Promise<void> = Promise.resolve();
    /**
     * Reports seen between listener registration and the end of the initial
     * read, held rather than applied.
     *
     * A report during that window cannot be applied yet, because `held` is not
     * yet the result. The window always closes, and the buffer is released into
     * the same link that applies everything else, so a row the window saw added
     * and then removed costs one decision and a report the starting read has
     * already answered is dropped by its number.
     */
    private startupReports: RowReportBatch<U> | null = emptyBatch<U>();

    constructor(
        private readonly factManager: FactManager,
        private readonly specification: Specification,
        private given: FactReference[],
        private readonly queue: RowQueue<U>,
        private readonly onFeedDecisions: (decisions: FeedDecision[]) => void
    ) {
        // Row identity stays pre-intersection. An intersected branch keeps the
        // caller's given labels, match unknowns and projection, and adds only
        // the synthetic auth labels: the `distributionUser` given appended
        // after the caller's givens, and the lifted auth matches prepended
        // before the caller's matches. So this subset identifies the same row
        // on every branch, and matches what `queryRows` produces.
        this.rowIdentityLabels = rowIdentityLabels(specification);

        // The labels a membership read pins: the caller's own match unknowns,
        // which are the row identity labels other than the givens.
        this.membershipPinned = specification.matches.map(m => m.unknown.name);

        // A single passthrough branch until `applySubscribeIntersection`
        // replaces it with one branch per authorizing distribution rule.
        this.branches = [this.toBranch(specification)];

        this.givenHash = this.computeGivenHash(specification);
    }

    /**
     * One branch, with the membership specification an intersected remove
     * reads.
     *
     * Derived when the branch is made rather than per read, so a shape the
     * rewrite cannot pin fails where the caller of `start` sees it rather than
     * inside a listener.
     */
    private toBranch(specification: Specification): RowBranch {
        return {
            specification,
            listeners: [],
            feeds: [],
            membership: membershipSpecification(specification, this.membershipPinned)
        };
    }

    /**
     * A short, stable name for this observation in the trace.
     *
     * It used to be load-bearing: a notification arrived for every observer of
     * the same inverse and each filtered the results to its own givens by this
     * hash. `addInverseListener` reads with the givens bound, so there is
     * nothing left to filter, and this now only tells one stream's lines apart
     * from another's.
     */
    private computeGivenHash(specification: Specification): string {
        const givenSubset = specification.given.map(g => g.label.name);
        const tuple: ReferencesByName = specification.given.reduce((t, label, index) => ({
            ...t,
            [label.label.name]: this.given[index]
        }), {} as ReferencesByName);
        return computeTupleSubsetHash(tuple, givenSubset);
    }

    /**
     * Install listeners, open the feed if this stream holds one, read the
     * current rows if this stream starts from them, deliver.
     *
     * The order is why this method exists. `ObserverImpl.start` has kept
     * listeners ahead of the read since the T2-T3 window was closed there; a
     * consumer that assembled the steps itself could invert them, lose every
     * row saved in between, and see no symptom until a production backlog
     * produced one. There is no longer an assembly to get wrong.
     */
    public async start(options: StartOptions): Promise<void> {
        // Intersect before the listeners are installed, so they are built from
        // the branch specifications the feed will actually carry. The
        // intersection itself reads nothing and notifies nothing, so it does
        // not reopen the window the listener ordering below closes.
        if (options.feed === "held") {
            await this.applySubscribeIntersection();
            if (this.stopped) {
                return;
            }
        }

        // Whether a remove can be applied as it arrives is a property of the
        // branches, so it is settled here, once the intersection has run and
        // before any listener can fire.
        this.removesNeedMembership = this.decideRemovePath();

        // One inverse per way a fact can change a row, each read with this
        // stream's givens ahead of the new fact, plus one per given of the
        // stream's own. The two directions `exactInverses` produces carry their
        // direction, so an add is applied as it arrives; a remove is too,
        // unless `removesNeedMembership`, which `decideRemovePath` explains.
        const branchInverses = this.branches.map(branch => ({
            branch,
            ...exactInverses(branch.specification),
            givenInverses: branch.specification.given.map((_, index) =>
                givenCandidateInverse(branch.specification, index))
        }));
        const inverseCount = branchInverses.reduce((sum, b) => sum + b.adds.length + b.removes.length + b.givenInverses.length, 0);

        Trace.info(`[RowStream] START - From: ${options.from}, Feed: ${options.feed}, Branches: ${this.branches.length}, Exact inverses: ${inverseCount}, Removes by membership: ${this.removesNeedMembership}, Given hash: ${this.givenHash.substring(0, 8)}...`);

        for (const { branch, adds, removes, givenInverses } of branchInverses) {
            branch.listeners = [
                ...adds.map(inverse => this.factManager.addInverseListener(
                    inverse,
                    this.given,
                    (results, read) => this.onReports(results, "added", read),
                    this.readNumbering
                )),
                ...removes.map(inverse => this.factManager.addInverseListener(
                    inverse,
                    this.given,
                    (results, read) => this.onRemoveReports(results, read),
                    this.readNumbering
                )),
                ...givenInverses.map(inverse => this.factManager.addInverseListener(
                    inverse,
                    this.given,
                    results => this.onGivenArrived(results),
                    this.readNumbering
                ))
            ];
        }

        if (options.feed === "held") {
            await this.openFeeds(options.feedTimeoutMs);
        }
        await this.initializeHeld(options);
        await this.endStartup();
    }

    public stop() {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        for (const branch of this.branches) {
            for (const listener of branch.listeners) {
                this.factManager.removeInverseListener(listener);
            }
            branch.listeners = [];
            if (branch.feeds.length > 0) {
                this.factManager.unsubscribe(branch.feeds);
                branch.feeds = [];
            }
        }
        this.startupReports = null;
        this.queuedReports = emptyBatch<U>();
        this.withdrawals = [];
        this.pendingReads.clear();
        this.decidedBy.clear();
        this.held.clear();
        this.queue.close();
        Trace.info(`[RowStream] STOPPED - Given hash: ${this.givenHash.substring(0, 8)}...`);
    }

    /**
     * Compose the specification with any distribution rule that authorizes it,
     * exactly as `ObserverImpl` does before it subscribes.
     *
     * Without this a specification authorized only through an intersected rule
     * reports `reactive` and delivers nothing (issue #279), or is refused
     * outright by the in-process engine. With it the authorization pattern
     * becomes part of the specification, so the stream starts empty and the
     * inverse engine delivers the backlog if an authorizing fact arrives.
     *
     * Each rule that applies becomes its own branch, and the branches are ORed:
     * a row authorized by any of them is delivered. A row authorized by more
     * than one arrives once per branch; the stream's contract already has the
     * consumer deduplicating on `rowHash`, which is stable across branches.
     */
    private async applySubscribeIntersection(): Promise<void> {
        const branches = await this.factManager.intersectForSubscribe(this.given, this.specification);
        const passthrough = branches.length === 1
            && branches[0].specification === this.specification
            && branches[0].start === this.given;
        if (passthrough) {
            return;
        }
        // Every branch's intersected spec appends the same synthetic
        // `distributionUser` given, bound to the same user, so one
        // observer-level `given` and `givenHash` covers them all.
        this.given = branches[0].start;
        this.givenHash = this.computeGivenHash(branches[0].specification);
        this.branches = branches.map(b => this.toBranch(b.specification));
        Trace.info(`[RowStream] INTERSECTED - Branches: ${this.branches.length}, Given hash: ${this.givenHash.substring(0, 8)}...`);
    }

    /**
     * Hold each branch's feed open for the life of the stream, so facts arrive
     * from the replicator rather than only from this client's own writes.
     *
     * `feedTimeoutMs` bounds the wait for the replicator, registration and
     * first response together (issue #280). It is the caller's, and there is
     * no default: see `RowStreamOptions.feedTimeoutMs`. Every branch is given
     * the same bound and they run concurrently, so it bounds the start rather
     * than each branch in turn. On expiry the subscriptions are released before the
     * error propagates, so nothing is left holding a connection: the ones that
     * timed out by the cleanup inside `subscribe`, and any branch that answers
     * afterwards by the `stopped` check below.
     */
    private async openFeeds(feedTimeoutMs?: number): Promise<void> {
        const decisions: FeedDecision[] = [];
        await Promise.all(this.branches.map(async branch => {
            const { feeds, decisions: branchDecisions } = await this.factManager.subscribe(this.given, branch.specification, feedTimeoutMs);
            if (this.stopped) {
                // stop() ran while we were awaiting; do not leak the subscriber.
                if (feeds.length > 0) {
                    this.factManager.unsubscribe(feeds);
                }
                return;
            }
            branch.feeds = feeds;
            decisions.push(...branchDecisions);
        }));
        if (this.stopped) {
            return;
        }
        this.onFeedDecisions(decisions);
    }

    /**
     * Read the rows that match now, make them the held set, and queue them as
     * additions if this stream starts from them.
     *
     * Every stream reads here, `...Changes` included. What the origin decides
     * is whether the rows are *delivered*, not whether they are known: a
     * stream that did not know them would have nothing for a later removal to
     * be a transition from, and would withdraw a row it never offered.
     *
     * The rows it does deliver go through the queue the changes go through, so
     * a consumer has one code path for a row rather than two, and cannot apply
     * its deduplication or its completion to only one of them.
     */
    private async initializeHeld(options: StartOptions): Promise<void> {
        // Traced so the order this method depends on is observable: every
        // listener is registered before this line runs.
        Trace.info(`[RowStream] READING CURRENT ROWS - Given hash: ${this.givenHash.substring(0, 8)}...`);
        if (options.from === "current" && options.feed === "none") {
            // A held feed has already pulled what the replicator has. Without
            // one, this is the fetch that makes the read see more than what
            // this client wrote, exactly as `watch` fetches once. A
            // `...Changes` stream still does not fetch: its read is of the
            // local graph, which is what it reports changes against.
            const decisions = await this.factManager.fetch(this.given, this.specification);
            this.onFeedDecisions(decisions);
        }
        if (this.stopped) {
            return;
        }
        // Numbered before the read, and kept as the floor every later report is
        // measured against. This read is an answer about every row, so a report
        // from a read numbered below it has already been answered here.
        const read = this.beginRead();
        this.startupRead = read;
        let rows: Map<string, CandidateRow<U>> | null = null;
        try {
            const result = await this.readResult();
            if (this.stopped) {
                return;
            }
            rows = result.rows;
            Trace.counter("facts_loaded", result.totalCount);
            // Make the read the held set before anything is delivered from it,
            // so a report that arrives mid-delivery is applied against a set
            // that is already the result rather than one still filling up.
            this.held = rows;
            for (const rowHash of rows.keys()) {
                this.decidedBy.set(rowHash, read);
            }
        }
        finally {
            // The read is over once `held` is it. The delivery below is not
            // part of the read, and a consumer that is slow to drain the queue
            // must not hold this number outstanding.
            this.endRead(read);
        }
        if (rows !== null && options.from === "current") {
            Trace.info(`[RowStream] STARTING ROWS - Rows: ${rows.size}`);
            this.queue.pushStarting([...rows.values()]);
        }
    }

    /**
     * Read the result for this stream's givens, as one row set.
     *
     * One read per branch: each authorizes an independently filtered set, and
     * a row that more than one branch authorizes appears once.
     */
    private async readResult(): Promise<{ rows: Map<string, CandidateRow<U>>, totalCount: number }> {
        const branchResults = await Promise.all(this.branches.map(branch =>
            this.factManager.read(this.given, branch.specification)));
        const rows = new Map<string, CandidateRow<U>>();
        let totalCount = 0;
        for (const projectedResults of branchResults) {
            const branchRows = toRows<U>(projectedResults, this.specification, this.rowIdentityLabels);
            totalCount += branchRows.totalCount;
            // `toRows` returns one row per projected result, in order, so the
            // tuple a row's references come from is at the same index.
            branchRows.rows.forEach((row, index) => {
                if (!rows.has(row.rowHash)) {
                    rows.set(row.rowHash, {
                        ...row,
                        references: identityReferences(projectedResults[index].tuple, this.rowIdentityLabels)
                    });
                }
            });
        }
        return { rows, totalCount };
    }

    /**
     * Decide each candidate by reading its own membership.
     *
     * Reached only from the intersected remove path, which is the one place a
     * row still needs a hypothesis tested rather than a direction trusted:
     * `decideRemovePath` says why. Every other report carries its own
     * direction.
     *
     * One read per distinct candidate, each costing what the specification's
     * paths and conditions cost for that one tuple, rather than one read of the
     * whole result for the batch. A candidate authorized by more than one
     * branch is present as soon as a branch says so, which is the same union a
     * read of every branch's result produces — and is what answers both ways
     * the remove direction's hypothesis fails under intersection.
     *
     * `null` when a candidate does not bind every pinned label, so the caller
     * reads the whole result instead. That is the answer for any candidate, and
     * `membershipStart` says when it cannot be reached one tuple at a time.
     */
    private async readMembership(candidates: CandidateRow<U>[]): Promise<Map<string, CandidateRow<U>> | null> {
        const distinct = new Map<string, CandidateRow<U>>();
        for (const candidate of candidates) {
            if (!distinct.has(candidate.rowHash)) {
                distinct.set(candidate.rowHash, candidate);
            }
        }
        const present = new Map<string, CandidateRow<U>>();
        for (const [rowHash, candidate] of distinct) {
            for (const branch of this.branches) {
                const start = membershipStart(this.given, branch.membership.pinned, candidate.references);
                if (start === null) {
                    return null;
                }
                const results = await this.factManager.readDerived(start, branch.membership.specification);
                if (this.stopped) {
                    return present;
                }
                if (results.length > 0) {
                    present.set(rowHash, {
                        ...toRow<U>(results[0], this.specification, this.rowIdentityLabels),
                        references: candidate.references
                    });
                    break;
                }
            }
        }
        return present;
    }

    /**
     * Release the startup window: apply what arrived during it against the
     * result the starting read has now established, then drop the buffer.
     *
     * The oldest shape replayed the window's notifications as changes,
     * filtering out only additions the read had already returned. That made a
     * stream's output the history of inverse firings rather than the history of
     * the result, and a row added and removed inside the window reached the
     * consumer as an `added` the read had correctly excluded (issue #336).
     *
     * The window's reports are coalesced with everything else in the link that
     * applies them, so that row costs one decision and nets to no change, and
     * a report from a read the starting read already answered is dropped by its
     * number rather than by a second read.
     */
    private async endStartup(): Promise<void> {
        const buffered = this.startupReports;
        this.startupReports = null;
        if (!buffered || isEmpty(buffered) || this.stopped) {
            return;
        }
        this.queuedReports.reports.push(...buffered.reports);
        this.queuedReports.fullReads.push(...buffered.fullReads);
        await this.enqueueApply();
    }

    /**
     * Whether this stream's removes must be decided by a membership read.
     *
     * See `removesNeedMembership` for why. The two states that break the remove
     * direction's hypothesis are more than one branch, and a branch carrying a
     * top-level unknown the row identity does not cover — which is what a
     * lifted authorization match is. The row identity stays pre-intersection,
     * so this test reads the branches against it rather than against
     * themselves.
     */
    private decideRemovePath(): boolean {
        if (this.branches.length > 1) {
            return true;
        }
        const identity = new Set(this.rowIdentityLabels);
        return this.branches.some(branch =>
            branch.specification.matches.some(match => !identity.has(match.unknown.name)));
    }

    /**
     * One exact inverse's rows, as reports.
     *
     * The direction is the listener's: every row an add inverse returns is in
     * the result its read saw, and every row a remove inverse returns is absent
     * from it. `read` is the number that read was given before it ran, which is
     * how a row's latest answer is recognized when two reads about it finish
     * out of order.
     *
     * No filtering by a given-subset hash: `addInverseListener` reads with this
     * stream's given references bound, so every row it returns already belongs
     * to this stream.
     */
    private async onReports(results: ProjectedResult[], operation: "added" | "removed", read: number): Promise<void> {
        if (this.stopped) {
            return;
        }
        const rows = this.toRows(results);
        if (rows.length === 0) {
            return;
        }
        await this.queueReports(rows.map(row => ({ row, operation, read })), []);
    }

    /**
     * A remove inverse's rows, applied directly or tested first.
     *
     * Where the remove direction is proven for this stream the rows are reports
     * like any other. Where it is not — an intersected stream, per
     * `decideRemovePath` — each row is a candidate rather than an answer, and
     * the membership read across every branch decides it. That read, not the
     * inverse read, is what the resulting reports are answers about, so they
     * carry its number: it ran later, and it is the one whose snapshot they
     * describe.
     *
     * A candidate the read finds still present is reported as an add. That is
     * not a second guess at the remove: the read says the row is in some
     * branch's result, which is the stream's result, so the report is sound in
     * its own right and nets to no change for a row already held.
     */
    private async onRemoveReports(results: ProjectedResult[], read: number): Promise<void> {
        if (this.stopped) {
            return;
        }
        const rows = this.toRows(results);
        if (rows.length === 0) {
            return;
        }
        if (!this.removesNeedMembership) {
            await this.queueReports(rows.map(row => ({ row, operation: "removed" as const, read })), []);
            return;
        }
        const decided = this.beginRead();
        try {
            // A candidate that cannot be read one tuple at a time falls back to
            // the whole result, exactly as the re-check did. It is used to
            // answer these candidates alone rather than as a whole-result
            // report, so this path decides no row the remove inverse did not
            // name.
            const membership = await this.readMembership(rows);
            const present = membership ?? (await this.readResult()).rows;
            if (this.stopped) {
                return;
            }
            await this.queueReports(rows.map(row => {
                const found = present.get(row.rowHash);
                return found !== undefined
                    ? { row: found, operation: "added" as const, read: decided }
                    : { row, operation: "removed" as const, read: decided };
            }), []);
        }
        finally {
            this.endRead(decided);
        }
    }

    /**
     * This stream's own given has arrived, so read the whole result.
     *
     * No inverse of an unknown waits for a given's type, and
     * `SpecificationRunner.read` returns nothing at all while a given fact is
     * absent, so the moment the given arrives every row appears at once. That
     * is the theorem's given case — nothing was read before, so every row read
     * now is an add — and the read is numbered before it runs like any other,
     * so it orders against the inverse reads instead of overriding them.
     *
     * The rows it does not return are reports too, against `held`, which is why
     * it is queued whole and expanded inside the chain.
     *
     * An empty result returns early. The given inverse's pin is bound through an
     * unknown equal to both the new fact and the given, so a fact of the given's
     * type that is *not* this stream's given yields no solution at all, and
     * reading the whole result for it would cost the whole result on every
     * unrelated fact of a common given type — a user, a tenant.
     */
    private async onGivenArrived(results: ProjectedResult[]): Promise<void> {
        if (this.stopped || results.length === 0) {
            return;
        }
        // Numbered before the read it is an answer about — this one — not
        // before the inverse read that brought us here.
        const read = this.beginRead();
        try {
            const { rows } = await this.readResult();
            if (this.stopped) {
                return;
            }
            await this.queueReports([], [{ read, present: rows }]);
        }
        finally {
            this.endRead(read);
        }
    }

    /**
     * Buffer reports, and apply them unless the startup window is still open.
     */
    private async queueReports(reports: RowReport<U>[], fullReads: RowFullRead<U>[]): Promise<void> {
        const buffer = this.startupReports ?? this.queuedReports;
        buffer.reports.push(...reports);
        buffer.fullReads.push(...fullReads);
        if (this.startupReports) {
            return;
        }
        await this.enqueueApply();
    }

    /** The next read number, recorded as outstanding until `endRead`. */
    private beginRead(): number {
        const read = this.nextRead++;
        this.pendingReads.add(read);
        return read;
    }

    /**
     * Report a read finished, and forget what was kept only to outrank it.
     *
     * A `decidedBy` entry for a row this stream does not hold exists only to
     * drop a report from a read that was already in flight when the row was
     * withdrawn. Once no outstanding read is numbered below the entry, no such
     * report can arrive, so the entry goes. A row that is held keeps its entry:
     * that is the number a later report about it is measured against.
     */
    private endRead(read: number): void {
        this.pendingReads.delete(read);
        if (this.withdrawals.length === 0) {
            return;
        }
        let floor = Number.POSITIVE_INFINITY;
        for (const pending of this.pendingReads) {
            if (pending < floor) {
                floor = pending;
            }
        }
        this.withdrawals = this.withdrawals.filter(withdrawal => {
            if (withdrawal.read >= floor) {
                return true;
            }
            if (!this.held.has(withdrawal.rowHash)
                && this.decidedBy.get(withdrawal.rowHash) === withdrawal.read) {
                this.decidedBy.delete(withdrawal.rowHash);
            }
            return false;
        });
    }

    /**
     * Apply the queued reports, after every application already in flight.
     *
     * The chain is what makes the emitted order the order of decisions. It
     * also coalesces: reports that arrive while an application is running are
     * taken by the next link in one batch, where the link keeps only the latest
     * read's answer per row and emits the net change against `held`. A link
     * that finds the queue already drained does nothing, which is what the
     * siblings of such a batch resolve to.
     *
     * Only the application is serialized. It updates `held`, so two batches
     * applying at once could interleave their updates; the chain is what keeps
     * each batch's coalescing and its `held` update together.
     */
    private enqueueApply(): Promise<void> {
        const decided = this.applyChain.then(() => this.applyQueuedReports());
        // A failed read must not poison the chain. A rejected link would make
        // every later application reject without running, so one failed read
        // would silently end the stream's updates for good. The caller still
        // sees the failure, through the promise returned here, and that is
        // where `notifyListener` reports it.
        this.applyChain = decided.catch(() => { });
        return decided;
    }

    private async applyQueuedReports(): Promise<void> {
        const batch = this.queuedReports;
        this.queuedReports = emptyBatch<U>();
        if (isEmpty(batch) || this.stopped) {
            return;
        }
        const reports = this.latestPerRow(batch);
        const changes: { operation: "added" | "removed", row: CandidateRow<U> }[] = [];
        for (const report of reports) {
            const change = this.applyReport(report);
            if (change !== null) {
                changes.push(change);
            }
        }
        if (changes.length === 0) {
            Trace.info(`[RowStream] UNCHANGED - Reports: ${reports.length}`);
            return;
        }
        Trace.info(`[RowStream] DECIDED - Reports: ${reports.length}, Added: ${changes.filter(c => c.operation === "added").length}, Removed: ${changes.filter(c => c.operation === "removed").length}`);
        for (const change of changes) {
            this.queue.pushChanges(change.operation, [change.row]);
        }
    }

    /**
     * One report per row: the one from the latest read.
     *
     * The reports reaching one link come from several reads, which finished in
     * whatever order they finished in. Keeping the greatest read number per row
     * and applying only that is what makes the link emit the net change against
     * `held` rather than replaying each read's answer in turn: a row an older
     * read added and a newer read removed is one removal, or no transition at
     * all if the stream never held it. That is the #336 startup case, now
     * settled by the numbers rather than by a second read.
     *
     * This is NOT `recheckCandidates`' dedupe, which kept the FIRST candidate
     * for a row because a fresh read, not the candidate, was going to decide
     * it. Keeping the first report here would keep the stalest answer.
     *
     * A whole-result read is expanded here, inside the chain, because the rows
     * it did not return are an answer only against `held`.
     */
    private latestPerRow(batch: RowReportBatch<U>): RowReport<U>[] {
        const latest = new Map<string, RowReport<U>>();
        const consider = (report: RowReport<U>) => {
            const existing = latest.get(report.row.rowHash);
            if (existing === undefined || existing.read < report.read) {
                latest.set(report.row.rowHash, report);
            }
        };
        for (const report of batch.reports) {
            consider(report);
        }
        for (const { read, present } of batch.fullReads) {
            for (const row of present.values()) {
                consider({ row, operation: "added", read });
            }
            for (const row of this.held.values()) {
                if (!present.has(row.rowHash)) {
                    consider({ row, operation: "removed", read });
                }
            }
        }
        return [...latest.values()];
    }

    /**
     * Apply one report, and return the transition it makes.
     *
     * A report from a read numbered at or below the latest that decided this
     * row is an answer about a store state no newer than the one already
     * applied, so it is dropped. Otherwise the number is recorded — whether or
     * not the row moved, because a remove that changes nothing must still
     * outrank an older add arriving after it — and the row is added or removed
     * where `held` disagrees with the report.
     *
     * A removal is delivered from `held`, not from the remove inverse's own
     * row: that tuple carries the fact whose arrival retracted the row, while
     * the consumer is being told about the result it was offered.
     */
    private applyReport(report: RowReport<U>): { operation: "added" | "removed", row: CandidateRow<U> } | null {
        const rowHash = report.row.rowHash;
        if (this.startupRead !== null && report.read < this.startupRead) {
            return null;
        }
        const decided = this.decidedBy.get(rowHash);
        if (decided !== undefined && decided >= report.read) {
            return null;
        }
        this.decidedBy.set(rowHash, report.read);
        if (report.operation === "added") {
            if (this.held.has(rowHash)) {
                return null;
            }
            this.held.set(rowHash, report.row);
            return { operation: "added", row: report.row };
        }
        this.withdrawals.push({ rowHash, read: report.read });
        const heldRow = this.held.get(rowHash);
        if (heldRow === undefined) {
            return null;
        }
        this.held.delete(rowHash);
        return { operation: "removed", row: heldRow };
    }

    /**
     * Identify each result by the row identity labels and project it exactly
     * as `query` would.
     *
     * The identity is narrowed rather than taken from the whole tuple: an
     * inverse's tuple also names the new fact, as `__f`, the labels its
     * reordering lifted out of an existential condition, and the `given…` match
     * `reduceGivenConditions` adds, and none of those appear in a read of the
     * specification. Hashing the whole tuple would therefore give one row a
     * different hash on every path that found it.
     *
     * Repeats within one batch of results are collapsed here. Repeats across
     * batches cost nothing to allow: a report that an already-held row is in
     * the result is no transition, so `applyReport` emits nothing for it.
     *
     * The identity labels' own references are kept, narrowed the same way, so
     * an intersected remove can read this one row's membership rather than the
     * whole result (#359). The tuple itself is not kept: the labels it also
     * names are the ones a membership read must not pin.
     */
    private toRows(results: ProjectedResult[]): CandidateRow<U>[] {
        const rows: CandidateRow<U>[] = [];
        const seen = new Set<string>();
        for (const pr of results) {
            const row = toRow<U>(pr, this.specification, this.rowIdentityLabels);
            if (seen.has(row.rowHash)) {
                continue;
            }
            seen.add(row.rowHash);
            rows.push({
                ...row,
                references: identityReferences(pr.tuple, this.rowIdentityLabels)
            });
        }
        return rows;
    }
}

class RowStreamImpl<U> implements RowStream<U> {
    private consumed = false;

    constructor(
        private readonly observer: RowObserver<U>,
        private readonly queue: RowQueue<U>
    ) { }

    get dropped(): number {
        return this.queue.dropped;
    }

    get pending(): number {
        return this.queue.pending;
    }

    [Symbol.asyncIterator](): AsyncIterator<SpecificationChange<U>> {
        if (this.consumed) {
            throw new Error("A row stream has one consumer. Iterate it once, or open a second stream.");
        }
        this.consumed = true;
        const queue = this.queue;
        const stop = () => this.stop();
        return {
            next: () => queue.next(),
            return: async () => {
                stop();
                return { value: undefined as any, done: true };
            }
        };
    }

    stop(): void {
        this.observer.stop();
    }
}

export async function startRowStream<U>(
    factManager: FactManager,
    specification: Specification,
    given: FactReference[],
    options: StartOptions,
    onFeedDecisions: (decisions: FeedDecision[]) => void
): Promise<RowStream<U>> {
    const queue = new RowQueue<U>(options.capacity ?? DEFAULT_ROW_STREAM_CAPACITY);
    const observer = new RowObserver<U>(factManager, specification, given, queue, onFeedDecisions);
    try {
        await observer.start(options);
    }
    catch (error) {
        // A failed start leaves nothing registered: the listeners installed a
        // moment ago would otherwise deliver to a caller who never received a
        // stream to stop.
        observer.stop();
        throw error;
    }
    return new RowStreamImpl<U>(observer, queue);
}
