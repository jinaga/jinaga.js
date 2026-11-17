import { FeedDecision } from "../http/messages";
import { DistributionDiagnostic, isPendingAuthorization, toClearingDiagnostic, toSettledDiagnostic } from "../managers/distributionDiagnostic";
import { FactManager } from "../managers/factManager";
import { Trace } from "../util/trace";

/**
 * What a watch gives this rule so it can act for it (issue #394).
 *
 * One rule, two callers: `ObserverImpl` for `watch` and `RowObserver` for
 * `watchRows`. Both ask the replicator the same question and both act on the
 * same answer, so neither holds a copy of the procedure. What differs between
 * them is only what is behind these four members -- how a branch is fetched,
 * where a diagnostic goes, and whether anything is written when a feed stops
 * being withheld.
 */
export interface PendingFeedHost {
    /** How this watch's specification is described in a diagnostic. */
    readonly specification: string;
    /**
     * Ask the replicator again for every branch of this watch, having dropped
     * the cached `POST /feeds` response first, and return what it decided.
     *
     * The feeds it names are fetched as part of this, so a feed that is
     * authorized now delivers its rows through the inverse listeners before
     * this resolves -- exactly as any fetch does.
     */
    refetch(): Promise<FeedDecision[]>;
    /** Deliver a diagnostic this rule produced. */
    emit(diagnostic: DistributionDiagnostic): void;
    /**
     * A feed this watch was waiting on is no longer withheld: it cleared, or it
     * settled. A watch that records a cache date writes it from here once
     * nothing is left (issue #402, extended by criterion 11 of #394).
     */
    resolved(feed: string): Promise<void>;
}

/** How a flush ended. See {@link PendingFeedResolution.flush}. */
type FlushOutcome = 'ended' | 'retrying';

/**
 * How a watch resolves a feed the replicator answered `reactive` (issue #394).
 *
 * A watch makes one pass over its feeds. When that pass is answered pending
 * because the fact that authorizes the feed has not reached the replicator yet,
 * nothing used to ask again, so the watch stayed empty after the race resolved.
 * The race this exists for is the client's own save: the authorizing fact is in
 * this client's outgoing queue, or on the wire, and the watch's `POST /feeds`
 * overtook it.
 *
 * So the remedy is to send what this client has unsent and ask once more:
 *
 * 1. **Flush, once.** `processQueueNow()`, waiting for the first of the flush
 *    ending, however it ended, or the save path reporting that it is retrying.
 *    A flush that is retrying is one the replicator is not answering, and
 *    waiting out its schedule would hold the watch's load for the whole retry
 *    budget, which is unbounded under `retry: { timeoutMs: 0 }`.
 * 2. **Ask again.** A fresh `POST /feeds`, with the cached response dropped so
 *    the replicator actually decides, and the feeds it names fetched.
 * 3. **Keep listening while anything is pending.** Every later batch that
 *    leaves this client is another chance, so the fork's own progress reports
 *    say when to ask again, and nothing here waits on a clock.
 *
 * **Whether a feed resolves depends on whether this client's facts have left
 * it, which is the axis the race varies on** (Article 8). Nothing about the
 * wait is stored (Article 2): the two sets below are the decisions this watch
 * currently holds, the moment to ask again is read from the fork's progress
 * reports, and the settled diagnostic is derived from the pending one it
 * retires. There is no snapshot of facts, no flag, no per-call option, and no
 * configured duration.
 *
 * It is a watch's rule alone. A subscription holds its feeds open and hears
 * about the race resolving through `registerClearingListeners`, so it makes no
 * flush, no second fetch, and emits no settled diagnostic.
 */
export class PendingFeedResolution {
    /**
     * The feeds whose latest decision is pending authorization, with that
     * decision. A feed leaves only when a later pass finds it no longer
     * withheld.
     */
    private readonly pending = new Map<string, FeedDecision>();
    /**
     * The feeds already reported settled, so at most one settled diagnostic is
     * emitted per feed until it clears. A settled feed is still pending -- the
     * replicator is still withholding it -- so it stays in `pending` and a
     * later batch from this client can still clear it.
     */
    private readonly settled = new Set<string>();
    private stopped = false;
    private stopListening: (() => void) | undefined;
    /**
     * The count the last progress notification reported, which is what makes
     * the next one readable: a count below it, or a count of zero, means a batch
     * left this client.
     */
    private lastCount: number | undefined;
    /**
     * Which pass is current. `refresh()` starts a new one, and a pass whose
     * generation is no longer current abandons rather than running a second
     * flush and fetch for the same watch.
     */
    private generation = 0;
    /** Whether an "ask again" is in flight, so two never overlap. */
    private asking = false;

    constructor(
        private readonly factManager: FactManager,
        private readonly host: PendingFeedHost
    ) { }

    /**
     * Act on one pass over this watch's feeds.
     *
     * A pass with no pending feed returns at once: a structurally denied feed
     * never self-heals, and an authorized one has already delivered, so neither
     * makes a flush, a second fetch, or a progress listener.
     *
     * The caller awaits this, which is what ties it to the load: the rows a
     * second fetch brought arrive through the callbacks before `loaded()`
     * resolves. A load never rejects because of this -- the first pass
     * succeeded, so a feed that is still pending is a state of the watch rather
     * than a failure of the load.
     */
    public async pass(decisions: FeedDecision[]): Promise<void> {
        if (this.stopped) {
            return;
        }
        this.record(decisions);
        if (this.pending.size === 0) {
            return;
        }
        const generation = ++this.generation;
        const outcome = await this.flush();
        if (this.stopped || generation !== this.generation) {
            return;
        }
        if (outcome === 'retrying') {
            // The replicator is not answering this client's save, so asking it
            // about the feed would answer about a graph that has not received
            // the authorizing fact. The load resolves here and step 3 takes
            // over: the retry may yet succeed, and the batch leaving is what
            // reports that it did.
            this.listenForProgress();
            return;
        }
        await this.askAgain(generation);
        if (this.stopped || generation !== this.generation) {
            return;
        }
        if (this.pending.size > 0) {
            this.listenForProgress();
        }
    }

    /**
     * Drop the progress listener and stop acting. Nothing is fetched and no
     * diagnostic is emitted afterwards, so a notification that arrives after
     * `stop()` costs nothing.
     */
    public stop(): void {
        this.stopped = true;
        this.generation++;
        this.releaseProgress();
        this.pending.clear();
        this.settled.clear();
    }

    private record(decisions: FeedDecision[]): void {
        for (const decision of decisions) {
            if (isPendingAuthorization(decision)) {
                this.pending.set(decision.feed, decision);
            }
        }
    }

    /**
     * Step 1. Send whatever this client has queued, and wait for the first of
     * the flush ending or the save path reporting a retry.
     *
     * The flush sends whatever is queued when it runs, so it ends however much
     * the client writes meanwhile, and nothing here records which facts it was
     * waiting on. A flush that rejects has ended too: what the next fetch
     * reports is the replicator's answer either way, and whether a flushed fact
     * was accepted or refused is not consulted.
     */
    private flush(): Promise<FlushOutcome> {
        return new Promise<FlushOutcome>(resolve => {
            let settled = false;
            const finish = (outcome: FlushOutcome) => {
                if (settled) {
                    return;
                }
                settled = true;
                stopListeningForRetry();
                resolve(outcome);
            };
            const stopListeningForRetry = this.factManager.onRetrying(() => finish('retrying'));
            this.factManager.push().then(
                () => finish('ended'),
                error => {
                    Trace.warn(`[PendingFeed] Flush failed; asking the replicator anyway: ${error}`);
                    finish('ended');
                });
        });
    }

    /**
     * Step 2. Ask the replicator again, and act on what it decides.
     *
     * A feed the new pass no longer reports pending is no longer withheld,
     * whether it was answered authorized or replaced by the specification's own
     * feeds: its rows arrived with this fetch, so it clears. A feed the new pass
     * still reports pending was withheld although the replicator had received
     * everything this client had sent, so it settles -- once, until it clears.
     *
     * A fetch that cannot reach the replicator decided nothing, so it clears
     * and settles nothing: the feeds stay pending and the load continues.
     *
     * Every fetch this rule makes follows evidence that this client's facts
     * have left it -- step 2's follows a flush that ended, and step 3's follows
     * a batch leaving the queue -- so each one that reaches the replicator can
     * settle. A step 3 fetch after a flush that was still retrying is the case
     * that makes this worth saying: the retry succeeded in the end, which is
     * what the batch leaving reports, so the replicator has the facts and its
     * answer is as final as this client can make it.
     */
    private async askAgain(generation: number): Promise<void> {
        if (this.asking) {
            return;
        }
        this.asking = true;
        try {
            await this.actOnFreshDecisions(generation);
        }
        finally {
            this.asking = false;
        }
    }

    private async actOnFreshDecisions(generation: number): Promise<void> {
        let decisions: FeedDecision[];
        try {
            decisions = await this.host.refetch();
        }
        catch (error) {
            Trace.warn(`[PendingFeed] Could not ask the replicator again; the feeds stay pending: ${error}`);
            return;
        }
        if (this.stopped || generation !== this.generation) {
            return;
        }
        const nowPending = new Map<string, FeedDecision>(
            decisions.filter(isPendingAuthorization).map(d => [d.feed, d] as const));
        const resolvedFeeds: string[] = [];
        for (const [feed, decision] of [...this.pending]) {
            if (!nowPending.has(feed)) {
                this.pending.delete(feed);
                this.settled.delete(feed);
                this.host.emit(toClearingDiagnostic('watch', this.host.specification, decision));
                resolvedFeeds.push(feed);
            }
        }
        for (const [feed, decision] of nowPending) {
            this.pending.set(feed, decision);
            if (!this.settled.has(feed)) {
                this.settled.add(feed);
                this.host.emit(toSettledDiagnostic('watch', this.host.specification, decision));
                resolvedFeeds.push(feed);
            }
        }
        // A cleared feed's facts are in the local graph, and a settled feed is
        // the replicator's answer to everything this client has sent, so for
        // either one this replica's graph is as complete as it can make it.
        for (const feed of resolvedFeeds) {
            try {
                await this.host.resolved(feed);
            }
            catch (error) {
                Trace.error(error);
            }
        }
    }

    /**
     * Step 3. Listen to the fork's progress reports while anything is pending.
     *
     * A notification reporting a lower count than the one before it, or
     * reporting zero, means a batch has left this client. That covers an
     * authorizing fact written after the watch started, a `TransientFork` save
     * that was not awaited, and a queue that drains after reconnecting
     * (issue #400). Each one is another chance for the replicator's answer to
     * have changed, so the watch asks again -- without flushing, because the
     * batch has already gone.
     */
    private listenForProgress(): void {
        if (this.stopped || this.stopListening) {
            return;
        }
        this.stopListening = this.factManager.onProgress(count => {
            const previous = this.lastCount;
            this.lastCount = count;
            if (this.stopped) {
                return;
            }
            if (count === 0 || (previous !== undefined && count < previous)) {
                this.onBatchLeft();
            }
        });
    }

    private releaseProgress(): void {
        if (this.stopListening) {
            this.stopListening();
            this.stopListening = undefined;
        }
        this.lastCount = undefined;
    }

    /**
     * A batch left this client. Ask again, and release the listener once nothing
     * is pending. Nothing awaits this, so its failure is reported here rather
     * than becoming an unhandled rejection.
     */
    private onBatchLeft(): void {
        const generation = this.generation;
        this.askAgain(generation)
            .then(() => {
                if (!this.stopped && this.pending.size === 0) {
                    this.releaseProgress();
                }
            })
            .catch(error => Trace.error(error));
    }
}
