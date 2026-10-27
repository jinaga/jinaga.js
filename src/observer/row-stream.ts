import { FeedDecision } from "../http/messages";
import { FactManager } from "../managers/factManager";
import { InverseListener } from "../observable/observable";
import { MembershipSpecification, candidateInverses, membershipSpecification } from "../specification/inverse-candidates";
import { SpecificationRow, rowIdentityLabels, toRow, toRows } from "../specification/row";
import { Specification } from "../specification/specification";
import { FactReference, ProjectedResult, ReferencesByName, computeTupleSubsetHash } from "../storage";
import { Trace } from "../util/trace";
import { givenCandidateInverse, membershipStart, recheckCandidates } from "./recheck";

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

class RowObserver<U> {
    private readonly rowIdentityLabels: string[];
    private readonly membershipPinned: string[];
    private givenHash: string;
    private branches: RowBranch[];
    private stopped = false;

    /**
     * The rows this stream has offered and not withdrawn, by `rowHash`.
     *
     * This is the stream's whole state, and `recheckCandidates` keeps it equal
     * to a read of the specification. It is initialized from the starting read
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
     * Candidates seen between listener registration and the end of the initial
     * read, held rather than decided.
     *
     * A notification during that window cannot be re-checked yet, because
     * `held` is not yet the result. So it is kept as a candidate and re-checked
     * once the starting read has landed, which is `maintain_correct`'s own
     * premise: the loop may start from any held set equal to a read. The window
     * always closes, and the buffer is released when it does.
     */
    private startupCandidates: CandidateRow<U>[] | null = [];
    /**
     * Whether the buffered candidates include one from this stream's own
     * given, which is decided by one read of the whole result.
     */
    private startupFullRead = false;

    /**
     * Candidates waiting on the current re-check, and the chain that decides
     * them one at a time.
     *
     * Decisions are serialized per stream, so the order a consumer sees is the
     * order they were decided in. Candidates that queue while a re-check is
     * running are taken by that re-check's successor in one go, so the facts of
     * one batch — notified concurrently — cost one read of the specification
     * between them rather than one each.
     */
    private queuedCandidates: CandidateRow<U>[] = [];
    private queuedFullRead = false;
    private recheckChain: Promise<void> = Promise.resolve();

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
     * One branch, with the membership specification its re-checks read.
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

        // One inverse per way a fact can change a row, each read with this
        // stream's givens ahead of the new fact, plus one per given of the
        // stream's own. None of them says whether the row was added or
        // removed: they propose candidates, and the re-check decides.
        const branchInverses = this.branches.map(branch => ({
            branch,
            inverses: candidateInverses(branch.specification),
            givenInverses: branch.specification.given.map((_, index) =>
                givenCandidateInverse(branch.specification, index))
        }));
        const inverseCount = branchInverses.reduce((sum, b) => sum + b.inverses.length + b.givenInverses.length, 0);

        Trace.info(`[RowStream] START - From: ${options.from}, Feed: ${options.feed}, Branches: ${this.branches.length}, Candidate inverses: ${inverseCount}, Given hash: ${this.givenHash.substring(0, 8)}...`);

        for (const { branch, inverses, givenInverses } of branchInverses) {
            branch.listeners = [
                ...inverses.map(inverse => this.factManager.addInverseListener(
                    inverse,
                    this.given,
                    results => this.onCandidates(results, false)
                )),
                ...givenInverses.map(inverse => this.factManager.addInverseListener(
                    inverse,
                    this.given,
                    results => this.onCandidates(results, true)
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
        this.startupCandidates = null;
        this.startupFullRead = false;
        this.queuedCandidates = [];
        this.queuedFullRead = false;
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
        const { rows, totalCount } = await this.readResult();
        if (this.stopped) {
            return;
        }
        Trace.counter("facts_loaded", totalCount);
        this.held = rows;
        if (options.from === "current") {
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
     * One read per distinct candidate, each costing what the specification's
     * paths and conditions cost for that one tuple, rather than one read of the
     * whole result for the batch. A candidate authorized by more than one
     * branch is present as soon as a branch says so, which is the same union a
     * read of every branch's result produces.
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
     * Release the startup window: re-check what arrived during it against the
     * result, then drop the buffer.
     *
     * The old shape replayed the window's notifications as changes, filtering
     * out only additions the read had already returned. That made a stream's
     * output the history of inverse firings rather than the history of the
     * result, and a row added and removed inside the window reached the
     * consumer as an `added` the read had correctly excluded (issue #336).
     * Re-checking them instead decides each one against what the store holds.
     */
    private async endStartup(): Promise<void> {
        const buffered = this.startupCandidates;
        const fullRead = this.startupFullRead;
        this.startupCandidates = null;
        this.startupFullRead = false;
        if (!buffered || buffered.length === 0 || this.stopped) {
            return;
        }
        await this.enqueueRecheck(buffered, fullRead);
    }

    /**
     * One inverse's results, as candidates.
     *
     * `ofGiven` marks the inverse that fires when one of this stream's own
     * givens is saved. Every row of the result is then a candidate, and so is
     * every row the stream already holds, because that fact can change the
     * answer for rows no inverse of an unknown would propose.
     *
     * No filtering by a given-subset hash: `addInverseListener` reads with this
     * stream's given references bound, so every row it returns already belongs
     * to this stream.
     */
    private async onCandidates(results: ProjectedResult[], ofGiven: boolean): Promise<void> {
        if (this.stopped) {
            return;
        }

        const rows = this.toRows(results);
        if (rows.length === 0) {
            return;
        }

        const candidates = ofGiven ? [...rows, ...this.held.values()] : rows;

        if (this.startupCandidates) {
            this.startupCandidates.push(...candidates);
            this.startupFullRead = this.startupFullRead || ofGiven;
            return;
        }

        await this.enqueueRecheck(candidates, ofGiven);
    }

    /**
     * Decide a set of candidates, after every decision already in flight.
     *
     * The chain is what makes the emitted order the order of decisions. It
     * also coalesces: candidates that arrive while a re-check is running are
     * taken by the next link in one batch, so a batch of facts notified
     * concurrently costs one read of the specification rather than one each.
     * A link that finds the queue already drained does nothing, which is what
     * the siblings of such a batch resolve to.
     */
    private enqueueRecheck(candidates: CandidateRow<U>[], fullRead: boolean): Promise<void> {
        this.queuedCandidates.push(...candidates);
        this.queuedFullRead = this.queuedFullRead || fullRead;
        const decided = this.recheckChain.then(() => this.decideQueuedCandidates());
        // A failed read must not poison the chain. A rejected link would make
        // every later re-check reject without running, so one failed read
        // would silently end the stream's updates for good. The caller still
        // sees the failure, through the promise returned here, and that is
        // where `notifyListener` reports it.
        this.recheckChain = decided.catch(() => { });
        return decided;
    }

    private async decideQueuedCandidates(): Promise<void> {
        const candidates = this.queuedCandidates;
        const fullRead = this.queuedFullRead;
        this.queuedCandidates = [];
        this.queuedFullRead = false;
        if (candidates.length === 0 || this.stopped) {
            return;
        }
        // One read per candidate, except for a batch that holds a candidate of
        // this stream's own given. That inverse fires when the given is first
        // saved, while nothing is held yet, so the whole result then costs what
        // the save changed (#359).
        const membership = fullRead ? null : await this.readMembership(candidates);
        const present = membership ?? (await this.readResult()).rows;
        if (this.stopped) {
            return;
        }
        const decisions = recheckCandidates(this.held, candidates, present);
        if (decisions.length === 0) {
            Trace.info(`[RowStream] UNCHANGED - Candidates: ${candidates.length}`);
            return;
        }
        Trace.info(`[RowStream] DECIDED - Candidates: ${candidates.length}, Added: ${decisions.filter(d => d.operation === "added").length}, Removed: ${decisions.filter(d => d.operation === "removed").length}`);
        for (const decision of decisions) {
            this.queue.pushChanges(decision.operation, [decision.row]);
        }
    }

    /**
     * Identify each result by the row identity labels and project it exactly
     * as `query` would.
     *
     * The identity is narrowed rather than taken from the whole tuple: a
     * candidate inverse's tuple also names the new fact, as `__f`, and the
     * labels its reordering lifted out of an existential condition, and none
     * of those appear in a read of the specification. Hashing the whole tuple
     * would therefore give one row a different hash on every path that found
     * it.
     *
     * Repeats within one batch of results are collapsed here. Repeats across
     * batches cost nothing to allow: a candidate already held and still in the
     * result is no transition, so the re-check drops it.
     *
     * The identity labels' own references are kept, narrowed the same way, so
     * the re-check can read this one row's membership rather than the whole
     * result (#359). The tuple itself is not kept: the labels it also names are
     * the ones a membership read must not pin.
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
