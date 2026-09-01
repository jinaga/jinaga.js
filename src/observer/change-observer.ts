import { FeedDecision } from "../http/messages";
import { FactManager } from "../managers/factManager";
import { SpecificationListener } from "../observable/observable";
import { SpecificationInverse, invertSpecification } from "../specification/inverse";
import { SpecificationRow, rowIdentityLabels, toRow, toRows } from "../specification/row";
import { Specification } from "../specification/specification";
import { FactReference, ProjectedResult, ReferencesByName, computeTupleSubsetHash } from "../storage";
import { Trace } from "../util/trace";

/**
 * Where a subscription's first rows come from.
 *
 * - `"current"` starts from the rows that match now. The library reads them
 *   after its listeners are installed and delivers them through the same path
 *   as every later change, so no row can fall between the two.
 * - `"now"` starts from the next change. Nothing is delivered for a row that
 *   already matches.
 *
 * There is no default. `"now"` is correct for a consumer that only reacts to
 * change (a cache invalidation, a metric); it is silently wrong for a consumer
 * that has to process every row, and the difference is invisible until a
 * backlog exists. Making it a word the caller types keeps that choice from
 * being made by accident.
 */
export type ChangeOrigin = "current" | "now";

/**
 * One row entering or leaving the set, for the pull interface.
 */
export interface SpecificationChange<U> extends SpecificationRow<U> {
    operation: "added" | "removed";
}

/**
 * Callbacks for the push form. Provide at least one.
 *
 * They are dispatched from inside the `save()` that triggered them and inherit
 * the bound from #249, so they must enqueue and return rather than work. A
 * consumer that cannot promise that should use the pull form, where the
 * library owns the callback and the consumer's work happens on its own turn by
 * construction.
 */
export interface SpecificationChangeHandlers<U> {
    onAdded?: (rows: SpecificationRow<U>[]) => Promise<void>;
    onRemoved?: (rows: SpecificationRow<U>[]) => Promise<void>;
}

export interface ObserveChangesOptions<U> extends SpecificationChangeHandlers<U> {
    from: ChangeOrigin;
    /**
     * Open the specification's feed for the life of the subscription, so facts
     * arrive from the replicator rather than only from this client's own
     * writes. Off by default because a local-only consumer should not open a
     * feed it does not need.
     */
    feed?: boolean;
}

export interface StreamChangesOptions {
    from: ChangeOrigin;
    feed?: boolean;
    /**
     * Maximum undelivered changes held for the consumer. Beyond it the oldest
     * is dropped and counted.
     *
     * The queue drops rather than pushing back because back pressure here
     * would block the listener, and a blocked listener blocks the `save()`
     * behind it: precisely the wedge #246 was and #249 bounded. Dropping is
     * safe for the consumer this exists for, whose periodic `queryRows` sweep
     * is the source of truth, and `dropped` is there to be alerted on.
     */
    capacity?: number;
}

export const DEFAULT_STREAM_CAPACITY = 1024;

/**
 * A running observation. Call `stop` to release its listeners and its feed.
 */
export interface ChangeSubscription {
    stop(): void;
}

/**
 * A running observation delivered by pull.
 */
export interface ChangeStream<U> extends ChangeSubscription {
    /**
     * The changes, oldest first, until `stop()`. Single consumer: a second
     * call throws.
     */
    changes(): AsyncIterableIterator<SpecificationChange<U>>;
    /**
     * How many changes the queue has discarded to stay within capacity.
     */
    readonly dropped: number;
}

interface Delivery<U> {
    deliver(operation: "added" | "removed", rows: SpecificationRow<U>[]): Promise<void>;
    wants(operation: "added" | "removed"): boolean;
    close(): void;
}

class HandlerDelivery<U> implements Delivery<U> {
    constructor(private readonly handlers: SpecificationChangeHandlers<U>) { }

    wants(operation: "added" | "removed"): boolean {
        return typeof this.handlerFor(operation) === "function";
    }

    async deliver(operation: "added" | "removed", rows: SpecificationRow<U>[]): Promise<void> {
        const handler = this.handlerFor(operation);
        if (handler && rows.length > 0) {
            await handler(rows);
        }
    }

    close(): void { }

    private handlerFor(operation: "added" | "removed") {
        return operation === "added" ? this.handlers.onAdded : this.handlers.onRemoved;
    }
}

/**
 * A bounded queue with one consumer. Full means the oldest change goes, not
 * that the producer waits: see the note on `capacity`.
 */
class ChangeQueue<U> implements Delivery<U> {
    private readonly buffer: SpecificationChange<U>[] = [];
    private waiting: ((result: IteratorResult<SpecificationChange<U>>) => void) | null = null;
    private closed = false;
    public dropped = 0;

    constructor(private readonly capacity: number) { }

    wants(): boolean {
        return true;
    }

    async deliver(operation: "added" | "removed", rows: SpecificationRow<U>[]): Promise<void> {
        for (const row of rows) {
            this.push({ ...row, operation });
        }
    }

    close(): void {
        this.closed = true;
        const waiting = this.waiting;
        this.waiting = null;
        if (waiting) {
            waiting({ value: undefined as any, done: true });
        }
    }

    next(): Promise<IteratorResult<SpecificationChange<U>>> {
        const change = this.buffer.shift();
        if (change !== undefined) {
            return Promise.resolve({ value: change, done: false });
        }
        if (this.closed) {
            return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise(resolve => {
            this.waiting = resolve;
        });
    }

    private push(change: SpecificationChange<U>): void {
        if (this.closed) {
            return;
        }
        const waiting = this.waiting;
        if (waiting) {
            this.waiting = null;
            waiting({ value: change, done: false });
            return;
        }
        if (this.buffer.length >= this.capacity) {
            this.buffer.shift();
            this.dropped++;
            Trace.counter("change_stream_dropped", 1);
        }
        this.buffer.push(change);
    }
}

class ChangeObserver<U> implements ChangeSubscription {
    private readonly rowIdentityLabels: string[];
    private readonly givenHash: string;
    private listeners: SpecificationListener[] = [];
    private feeds: string[] = [];
    private stopped = false;

    /**
     * Changes seen between listener registration and the end of the initial
     * delivery, held rather than delivered.
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
        private readonly given: FactReference[],
        private readonly delivery: Delivery<U>,
        private readonly onFetchDecisions: (decisions: FeedDecision[]) => void
    ) {
        this.rowIdentityLabels = rowIdentityLabels(specification);

        const givenSubset = specification.given.map(g => g.label.name);
        const tuple: ReferencesByName = specification.given.reduce((t, label, index) => ({
            ...t,
            [label.label.name]: given[index]
        }), {} as ReferencesByName);
        this.givenHash = computeTupleSubsetHash(tuple, givenSubset);
    }

    /**
     * Install listeners, open the feed, read the current rows, deliver.
     *
     * The order is the whole point of this method existing. `ObserverImpl.start`
     * has kept listeners ahead of the read since the T2-T3 window was closed
     * there; a consumer that assembled the two calls itself could invert them,
     * lose every row saved in between, and never see a symptom until a
     * production backlog produced one.
     */
    public async start(from: ChangeOrigin): Promise<void> {
        const inverses = invertSpecification(this.specification)
            .filter(inverse => inverse.path === "");

        Trace.info(`[ChangeObserver] START - From: ${from}, Root inverses: ${inverses.length}, Given hash: ${this.givenHash.substring(0, 8)}...`);

        this.listeners = inverses.map(inverse => this.factManager.addSpecificationListener(
            inverse.inverseSpecification,
            results => this.onResult(inverse, results)
        ));

        if (from === "current") {
            await this.deliverStartingRows();
        }
        await this.endStartup();
    }

    public async openFeed(): Promise<void> {
        const { feeds, decisions } = await this.factManager.subscribe(this.given, this.specification);
        if (this.stopped) {
            // stop() ran while we were awaiting; do not leak the subscriber.
            if (feeds.length > 0) {
                this.factManager.unsubscribe(feeds);
            }
            return;
        }
        this.feeds = feeds;
        this.onFetchDecisions(decisions);
    }

    public stop() {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        for (const listener of this.listeners) {
            this.factManager.removeSpecificationListener(listener);
        }
        this.listeners = [];
        if (this.feeds.length > 0) {
            this.factManager.unsubscribe(this.feeds);
            this.feeds = [];
        }
        this.startupBuffer = null;
        this.startingRowHashes = null;
        this.delivery.close();
        Trace.info(`[ChangeObserver] STOPPED - Given hash: ${this.givenHash.substring(0, 8)}...`);
    }

    /**
     * Read the rows that match now and deliver them as additions.
     *
     * They go through the delivery the changes go through, so a consumer has
     * one code path for a row rather than two, and cannot apply its
     * deduplication or its completion to only one of them.
     */
    private async deliverStartingRows(): Promise<void> {
        // Traced so the order this method depends on is observable: every
        // listener is registered before this line runs.
        Trace.info(`[ChangeObserver] READING CURRENT ROWS - Given hash: ${this.givenHash.substring(0, 8)}...`);
        const decisions = await this.factManager.fetch(this.given, this.specification);
        this.onFetchDecisions(decisions);
        if (this.stopped) {
            return;
        }
        const projectedResults = await this.factManager.read(this.given, this.specification);
        if (this.stopped) {
            return;
        }
        const { rows, totalCount } = toRows<U>(projectedResults, this.specification, this.rowIdentityLabels);
        Trace.counter("facts_loaded", totalCount);
        this.startingRowHashes = new Set(rows.map(row => row.rowHash));
        Trace.info(`[ChangeObserver] STARTING ROWS - Rows: ${rows.length}`);
        if (this.delivery.wants("added")) {
            await this.delivery.deliver("added", rows);
        }
    }

    /**
     * Release the startup window: deliver what arrived during it, minus the
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
                await this.delivery.deliver(batch.operation, rows);
            }
        }
    }

    private async onResult(inverse: SpecificationInverse, results: ProjectedResult[]): Promise<void> {
        if (this.stopped) {
            return;
        }

        const operation = inverse.operation === "add" ? "added" : "removed";
        if (!this.delivery.wants(operation)) {
            return;
        }

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

        Trace.info(`[ChangeObserver] ${operation.toUpperCase()} - Rows: ${rows.length}`);
        await this.delivery.deliver(operation, rows);
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
     * the subscription would reintroduce exactly the unbounded growth this
     * seam exists to avoid.
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

class ChangeStreamImpl<U> implements ChangeStream<U> {
    private consumed = false;

    constructor(
        private readonly observer: ChangeObserver<U>,
        private readonly queue: ChangeQueue<U>
    ) { }

    get dropped(): number {
        return this.queue.dropped;
    }

    changes(): AsyncIterableIterator<SpecificationChange<U>> {
        if (this.consumed) {
            throw new Error("A change stream has one consumer. Call changes() once, or open a second stream.");
        }
        this.consumed = true;
        const queue = this.queue;
        const stop = () => this.stop();
        return {
            [Symbol.asyncIterator]() { return this; },
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

async function startObserver<U>(
    factManager: FactManager,
    specification: Specification,
    given: FactReference[],
    delivery: Delivery<U>,
    options: { from: ChangeOrigin, feed?: boolean },
    onFetchDecisions: (decisions: FeedDecision[]) => void
): Promise<ChangeObserver<U>> {
    const observer = new ChangeObserver<U>(factManager, specification, given, delivery, onFetchDecisions);
    try {
        if (options.feed) {
            await observer.openFeed();
        }
        await observer.start(options.from);
    }
    catch (error) {
        // A failed start leaves nothing registered: the listeners installed a
        // moment ago would otherwise deliver to a caller who never received a
        // subscription to stop.
        observer.stop();
        throw error;
    }
    return observer;
}

export async function startChangeObserver<U>(
    factManager: FactManager,
    specification: Specification,
    given: FactReference[],
    options: ObserveChangesOptions<U>,
    onFetchDecisions: (decisions: FeedDecision[]) => void
): Promise<ChangeSubscription> {
    return await startObserver(factManager, specification, given,
        new HandlerDelivery<U>(options), options, onFetchDecisions);
}

export async function startChangeStream<U>(
    factManager: FactManager,
    specification: Specification,
    given: FactReference[],
    options: StreamChangesOptions,
    onFetchDecisions: (decisions: FeedDecision[]) => void
): Promise<ChangeStream<U>> {
    const queue = new ChangeQueue<U>(options.capacity ?? DEFAULT_STREAM_CAPACITY);
    const observer = await startObserver(factManager, specification, given, queue, options, onFetchDecisions);
    return new ChangeStreamImpl<U>(observer, queue);
}
