import { FeedDecision } from "../http/messages";
import { FactManager } from "../managers/factManager";
import { SpecificationListener } from "../observable/observable";
import { SpecificationInverse, invertSpecification } from "../specification/inverse";
import { SpecificationRow, rowIdentityLabels, toRow, toRows } from "../specification/row";
import { Specification } from "../specification/specification";
import { FactReference, ProjectedResult, ReferencesByName, computeTupleSubsetHash } from "../storage";
import { Trace } from "../util/trace";

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
     * Milliseconds to wait for the feed's first response before giving up,
     * failing the start with a `FeedTimeoutError`.
     *
     * Opt-in, and deliberately without a default (issue #280). A cold start on
     * a large candidate set can legitimately take minutes, so a default bound
     * would turn a slow success into a retry loop; that trap has been sprung
     * here before, in a supervisor that timed out first loads. Without this the
     * wait has no bound at all, so a replicator that accepts the connection and
     * never answers leaves the returned promise pending, and a service that
     * awaits `subscribeRows` during boot never reaches its listener.
     *
     * Set it when a caller has somewhere better to be than the replicator's
     * first response: a boot path, a health check, a supervisor that retries.
     * Size it against a cold start rather than a warm one.
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
            const change: SpecificationChange<U> = { ...row, operation: "added" };
            if (!this.handOff(change)) {
                this.starting.push(change);
            }
        }
    }

    pushChanges(operation: "added" | "removed", rows: SpecificationRow<U>[]): void {
        for (const row of rows) {
            const change: SpecificationChange<U> = { ...row, operation };
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
    listeners: SpecificationListener[];
    feeds: string[];
}

class RowObserver<U> {
    private readonly rowIdentityLabels: string[];
    private givenHash: string;
    private branches: RowBranch[];
    private stopped = false;

    /**
     * Changes seen between listener registration and the end of the initial
     * delivery, held rather than queued.
     *
     * This is not `pendingAddsByKey` returning. It covers one window that
     * always closes, and both it and `startingRowHashes` are released when it
     * does, so neither grows with throughput.
     */
    private startupBuffer: { operation: "added" | "removed", rows: SpecificationRow<U>[] }[] | null = [];
    private startingRowHashes: Set<string> | null = null;

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

        // A single passthrough branch until `applySubscribeIntersection`
        // replaces it with one branch per authorizing distribution rule.
        this.branches = [{ specification, listeners: [], feeds: [] }];

        this.givenHash = this.computeGivenHash(specification);
    }

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

        const rootInverses = this.branches.map(branch => ({
            branch,
            inverses: invertSpecification(branch.specification)
                .filter(inverse => inverse.path === "")
        }));
        const inverseCount = rootInverses.reduce((sum, b) => sum + b.inverses.length, 0);

        Trace.info(`[RowStream] START - From: ${options.from}, Feed: ${options.feed}, Branches: ${this.branches.length}, Root inverses: ${inverseCount}, Given hash: ${this.givenHash.substring(0, 8)}...`);

        for (const { branch, inverses } of rootInverses) {
            branch.listeners = inverses.map(inverse => this.factManager.addSpecificationListener(
                inverse.inverseSpecification,
                results => this.onResult(inverse, results)
            ));
        }

        if (options.feed === "held") {
            await this.openFeeds(options.feedTimeoutMs);
        }
        if (options.from === "current") {
            await this.deliverStartingRows(options.feed);
        }
        await this.endStartup();
    }

    public stop() {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        for (const branch of this.branches) {
            for (const listener of branch.listeners) {
                this.factManager.removeSpecificationListener(listener);
            }
            branch.listeners = [];
            if (branch.feeds.length > 0) {
                this.factManager.unsubscribe(branch.feeds);
                branch.feeds = [];
            }
        }
        this.startupBuffer = null;
        this.startingRowHashes = null;
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
     * inverse engine delivers the backlog when the authorizing fact arrives.
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
        this.branches = branches.map(b => ({
            specification: b.specification,
            listeners: [],
            feeds: []
        }));
        Trace.info(`[RowStream] INTERSECTED - Branches: ${this.branches.length}, Given hash: ${this.givenHash.substring(0, 8)}...`);
    }

    /**
     * Hold each branch's feed open for the life of the stream, so facts arrive
     * from the replicator rather than only from this client's own writes.
     *
     * `feedTimeoutMs` bounds the wait for the replicator's first response
     * (issue #280). It is the caller's, and there is no default: see
     * `RowStreamOptions.feedTimeoutMs`. Every branch is given the same bound
     * and they run concurrently, so it bounds the start rather than each
     * branch in turn. On expiry the subscriptions are released before the
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
     * Read the rows that match now and queue them as additions.
     *
     * They go through the queue the changes go through, so a consumer has one
     * code path for a row rather than two, and cannot apply its deduplication
     * or its completion to only one of them.
     */
    private async deliverStartingRows(feed: FeedPolicy): Promise<void> {
        // Traced so the order this method depends on is observable: every
        // listener is registered before this line runs.
        Trace.info(`[RowStream] READING CURRENT ROWS - Given hash: ${this.givenHash.substring(0, 8)}...`);
        if (feed === "none") {
            // A held feed has already pulled what the replicator has. Without
            // one, this is the fetch that makes the read see more than what
            // this client wrote, exactly as `watch` fetches once.
            const decisions = await this.factManager.fetch(this.given, this.specification);
            this.onFeedDecisions(decisions);
        }
        if (this.stopped) {
            return;
        }
        // One read per branch: each authorizes an independently filtered set,
        // and a row that more than one branch authorizes is delivered once.
        const branchResults = await Promise.all(this.branches.map(branch =>
            this.factManager.read(this.given, branch.specification)));
        if (this.stopped) {
            return;
        }
        const rows: SpecificationRow<U>[] = [];
        const rowHashes = new Set<string>();
        for (const projectedResults of branchResults) {
            const branchRows = toRows<U>(projectedResults, this.specification, this.rowIdentityLabels);
            Trace.counter("facts_loaded", branchRows.totalCount);
            for (const row of branchRows.rows) {
                if (rowHashes.has(row.rowHash)) {
                    continue;
                }
                rowHashes.add(row.rowHash);
                rows.push(row);
            }
        }
        this.startingRowHashes = rowHashes;
        Trace.info(`[RowStream] STARTING ROWS - Rows: ${rows.length}`);
        this.queue.pushStarting(rows);
    }

    /**
     * Release the startup window: queue what arrived during it, minus the
     * additions the read already covered, then drop both sets.
     *
     * A duplicate can still reach a consumer whose row was saved before the
     * read and notified after this flush. That direction is safe by design,
     * and the consumer deduplicates on `rowHash`. The direction this method
     * exists to make impossible is the other one.
     */
    private async endStartup(): Promise<void> {
        const buffered = this.startupBuffer;
        this.startupBuffer = null;
        const startingRowHashes = this.startingRowHashes;
        this.startingRowHashes = null;
        if (!buffered || this.stopped) {
            return;
        }
        for (const batch of buffered) {
            const rows = batch.operation === "added" && startingRowHashes
                ? batch.rows.filter(row => !startingRowHashes.has(row.rowHash))
                : batch.rows;
            if (rows.length > 0) {
                this.queue.pushChanges(batch.operation, rows);
            }
        }
    }

    private async onResult(inverse: SpecificationInverse, results: ProjectedResult[]): Promise<void> {
        if (this.stopped) {
            return;
        }

        const operation = inverse.operation === "add" ? "added" : "removed";

        // Keep only the rows that descend from this observation's given. One
        // inverse specification is shared by every observer of the same shape,
        // so a notification arrives for all of them and each filters to its own.
        const matching = results.filter(pr =>
            this.givenHash === computeTupleSubsetHash(pr.tuple, inverse.givenSubset));
        if (matching.length === 0) {
            return;
        }

        const rows = this.toRows(matching);
        if (rows.length === 0) {
            return;
        }

        if (this.startupBuffer) {
            this.startupBuffer.push({ operation, rows });
            return;
        }

        Trace.info(`[RowStream] ${operation.toUpperCase()} - Rows: ${rows.length}`);
        this.queue.pushChanges(operation, rows);
    }

    /**
     * Identify each result by the row identity labels and project it exactly
     * as `query` would.
     *
     * The identity is narrowed rather than taken from the whole tuple: a
     * remove inverse's tuple names the fact whose arrival retracted the row,
     * that label is absent from the add side, and hashing the whole tuple
     * would therefore give one row two different hashes.
     *
     * Repeats within one batch are collapsed. Repeats ACROSS batches are not,
     * outside the startup window: holding a delivered-row set for the life of
     * the stream would reintroduce exactly the unbounded growth this avoids.
     */
    private toRows(results: ProjectedResult[]): SpecificationRow<U>[] {
        const rows: SpecificationRow<U>[] = [];
        const seen = new Set<string>();
        for (const pr of results) {
            const row = toRow<U>(pr, this.specification, this.rowIdentityLabels);
            if (seen.has(row.rowHash)) {
                continue;
            }
            seen.add(row.rowHash);
            rows.push(row);
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
