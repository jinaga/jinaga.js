import { computeObjectHash } from "../fact/hash";
import { FeedDecision } from "../http/messages";
import { DistributionDiagnostic, toClearingDiagnostic, toDistributionDiagnostics } from "../managers/distributionDiagnostic";
import { FactManager } from "../managers/factManager";
import { InverseListener, InverseReadNumbering } from "../observable/observable";
import { describeDeclaration, describeSpecification } from "../specification/description";
import { exactInverses } from "../specification/inverse-candidates";
import { SpecificationRow } from "../specification/row";
import { Match, Projection, Specification } from "../specification/specification";
import { FactReference, ProjectedResult, ReferencesByName, computeTupleSubsetHash } from "../storage";
import { givenCandidateInverse } from "./recheck";
import { computeStringHash } from "../util/encoding";
import { Trace } from "../util/trace";

export type ResultAddedFunc<U> = (value: U) =>
    Promise<() => Promise<void>> |  // Asynchronous with removal function
    Promise<void> |                 // Asynchronous without removal function
    (() => void) |                  // Synchronous with removal function
    void;                           // Synchronous without removal function

export interface ObservableCollection<T> {
    onAdded(handler: ResultAddedFunc<T>): void;

}

export interface Observer<T> {
    cached(): Promise<boolean>;
    loaded(): Promise<void>;
    /**
     * Returns a promise that resolves when all pending notifications have been processed.
     * This includes all observer callbacks triggered by facts that have been added.
     * Useful in tests to wait for async operations to complete.
     *
     * Not guaranteed to settle. A handler that never settles is abandoned by
     * the listener timeout (issue #246) so that `fact()` can complete, but its
     * notification stays pending here forever. Await this only where a handler
     * is known to terminate, and never as a liveness guarantee in production
     * code.
     */
    processed(): Promise<void>;
    stop(): void;
    /**
     * Fetch this observer's feeds once more, from the bookmarks they have
     * already reached, and resolve when that fetch completes (issue #303).
     * Facts that arrive reach the handlers through the same inverse path a
     * local save takes, so a row the handler already holds is not delivered
     * again.
     *
     * This is what a pull-to-refresh gesture, a window regaining focus, or a
     * push notification that says "something changed" calls. A `watch` fetches
     * only at start, so without this the only way to pick facts up on demand
     * is to `stop()` the observer and create another one, which re-delivers
     * every current row to a handler that has already seen it.
     *
     * A refresh during the initial load *is* the initial load: it issues no
     * second fetch and resolves when `loaded()` does, rejecting with it if the
     * load fails. A refresh after `stop()` resolves and fetches nothing.
     *
     * A `subscribe` observer already holds its feeds open, and refreshes all
     * the same: the fetch is harmless there, and one method covers both.
     */
    refresh(): Promise<void>;
    /**
     * The distribution diagnostics (issue #207 W6) captured for this observer's
     * feeds while loading. This is where a developer holding the observer handle
     * looks to learn that a feed is `denied` or `reactive`.
     *
     * Non-fatal by contract: a denied/reactive feed never rejects `loaded()` and
     * never puts the observer into an error state — that is what keeps `watch`
     * and `subscribe` correct through the subscription race.
     */
    diagnostics(): DistributionDiagnostic[];
    /**
     * Register a callback for distribution diagnostics. Any diagnostics already
     * captured are replayed to the handler immediately, and future ones are
     * delivered as they are captured. A throwing handler is isolated and never
     * disturbs the observer.
     */
    onDiagnostic(handler: (diagnostic: DistributionDiagnostic) => void): void;
}

/**
 * One path within a branch's projection, as a specification that can be read
 * and inverted on its own.
 *
 * A nested collection is flattened exactly the way `invertProjection` flattens
 * it (`inverse.ts`): the parent's matches, then the component's own, carrying
 * the component's projection. That makes every path -- the root and each child
 * collection -- a specification this level reads for itself, which is what lets
 * a change deep inside a collection be decided even though the root row's own
 * membership never changes. This flattening is outside the proof in
 * jinaga/jinaga-spec#12; the observer tests exercise it.
 */
interface ObserverLevel {
    path: string;
    specification: Specification;
    projection: Projection;
    parentSubset: string[];
    resultSubset: string[];
    /**
     * The labels that key `held`.
     *
     * At the root this is the branch's `voteLabels`, not the row identity, so
     * that two authorizing paths for one row are held -- and therefore
     * withdrawn -- independently. That is the granularity `votesByRow` counts,
     * so keying any coarser would let one path's withdrawal retract a row the
     * other still supports. At a nested path a row has exactly one possible
     * authorizing path, so the two coincide.
     */
    keyLabels: string[];
    /**
     * The rows this branch holds at this path, keyed over `keyLabels`.
     *
     * A row is here because the latest read that reported it found it in the
     * result, and each entry carries the projected result the delivery path
     * needs. `decidedBy` records which read that was.
     */
    held: Map<string, SpecificationRow<ProjectedResult>>;
    listeners: InverseListener[];
    /**
     * The number of the latest read that decided each row, present or absent.
     *
     * This is what makes `held` independent of the order reads finish in. A
     * report from a read numbered at or below the entry is an answer about a
     * store state no newer than the one already applied, so it is dropped. An
     * entry is kept for a row that is absent as well as for one that is held --
     * a row withdrawn by read 9 must still outrank an add from read 7 arriving
     * late -- and `endRead` forgets the absent ones once no older read is
     * outstanding.
     */
    decidedBy: Map<string, number>;
}

/**
 * One read's answer about one row: that it is in the result, or that it is not.
 *
 * jinaga-spec's exact inverses report changes rather than propose candidates --
 * every row an add inverse returns is in the new result and every row a remove
 * inverse returns is absent from it (`adds_sound`, `removes_sound`,
 * `changes_complete`, `exact_correct`, jinaga/jinaga-spec#19) -- so a row needs
 * no second read to decide it. What it needs instead is `read`: the number the
 * read was given before it ran, which is what tells this answer apart from a
 * later read's answer about the same row.
 */
interface Report {
    row: SpecificationRow<ProjectedResult>;
    operation: "added" | "removed";
    read: number;
}

/**
 * One whole-level read, which is an answer about every row at once.
 *
 * This is what the arrival of the observer's own given produces. It is expanded
 * into reports when the batch is applied rather than when the read returns,
 * because the rows it did NOT return are reports only against `held`, and
 * `held` is stable only inside the decision chain.
 */
interface FullRead {
    read: number;
    present: Map<string, SpecificationRow<ProjectedResult>>;
}

/**
 * The reports one level has waiting, and the whole-level reads it has waiting.
 */
interface ReportBatch {
    branch: ObserverBranch;
    reports: Report[];
    fullReads: FullRead[];
}

/**
 * One decided transition, waiting to be delivered to the caller's handler.
 */
interface PendingDelivery {
    level: ObserverLevel;
    branch: ObserverBranch;
    operation: "added" | "removed";
    result: ProjectedResult;
}

interface ObserverBranch {
    specification: Specification;
    feeds: string[];
    /** The root path, then every nested collection, parents before children. */
    levels: ObserverLevel[];
    /**
     * Labels of this branch's spec (givens + match unknowns). Used to
     * compute a stable "vote id" for per-row ref counting: the same
     * (row, auth path) tuple reached through any of this branch's inverses
     * hashes to the same id, because they all bind the same set of labels (the
     * inverse's "from" fact differs but the resolved spec labels match in shape
     * and value).
     */
    voteLabels: string[];
}

/**
 * Flatten a branch into one level per path, parents before children.
 */
function buildLevels(specification: Specification, voteLabels: string[]): ObserverLevel[] {
    const givenSubset = specification.given.map(g => g.label.name);
    const rootResultSubset = [...givenSubset, ...specification.matches.map(m => m.unknown.name)];
    const levels: ObserverLevel[] = [];

    const descend = (
        path: string,
        matches: Match[],
        projection: Projection,
        parentSubset: string[],
        resultSubset: string[],
        keyLabels: string[]
    ) => {
        const levelSpecification: Specification = { given: specification.given, matches, projection };
        levels.push({
            path,
            specification: levelSpecification,
            projection,
            parentSubset,
            resultSubset,
            keyLabels,
            held: new Map(),
            listeners: [],
            decidedBy: new Map()
        });
        if (projection.type === "composite") {
            for (const component of projection.components) {
                if (component.type === "specification") {
                    const childResultSubset = [
                        ...resultSubset,
                        ...component.matches.map(m => m.unknown.name)
                    ];
                    descend(
                        path + "." + component.name,
                        [...matches, ...component.matches],
                        component.projection,
                        resultSubset,
                        childResultSubset,
                        childResultSubset
                    );
                }
            }
        }
    };

    descend("", specification.matches, specification.projection, givenSubset, rootResultSubset, voteLabels);
    return levels;
}

export class ObserverImpl<T> implements Observer<T> {
    private givenHash: string;
    private cachedPromise: Promise<boolean> | undefined;
    private loadedPromise: Promise<void> | undefined;
    /**
     * Per-row ref counting. At every path each row carries a set of
     * "votes" — distinct authorizing paths that currently support it.
     * The row is delivered to the handler on the *first* vote in and
     * its removal callback fires on the *last* vote out.
     *
     * At the root path, the OR over distribution rules makes multi-vote
     * rows possible: branch A authorizes via Administrator while branch B
     * authorizes via President, both producing the same user-visible row.
     * At nested paths each row has exactly one possible authorizing
     * path (its parent's branch), so `voteId === rowHash` and the set
     * degenerates to a single element — add → deliver, remove → tear
     * down, identical to the pre-OR behavior. One mechanism with a
     * degenerate case, not two parallel mechanisms.
     */
    private votesByRow = new Map<string, Set<string>>();
    /**
     * Removal callbacks registered when each row was first delivered,
     * keyed by the same row identity hash as `votesByRow`.
     */
    private removalsByRow = new Map<string, () => Promise<void>>();
    /**
     * Rows whose add handler is currently awaiting its asynchronous result,
     * keyed by row identity hash. Consulted by `notifyRemoved` to tell a
     * genuine in-flight race (removal function not registered *yet*) apart
     * from a row whose add handler already finished without registering one
     * (nothing to await, nothing to clean up).
     */
    private addsInFlight = new Set<string>();
    /**
     * Rows where a remove notification arrived while the add handler was
     * still awaiting its asynchronous result — i.e. the removal function
     * had not been registered yet (row present in `addsInFlight`). When the
     * add handler completes and would normally store the removal function,
     * it checks this set and immediately invokes (and discards) the
     * function instead, ensuring the removal is never permanently lost
     * across concurrent saves.
     */
    private pendingRemovals = new Set<string>();
    private addedHandlers: {
        tupleHash: string;
        path: string;
        handler: ResultAddedFunc<any>;
        /**
         * The rows whose projections this handler lives inside, root first,
         * each as a `path|tupleHash` row key. The last entry is the row whose
         * projection registered the handler, so a handler's lifetime is that
         * row's lifetime and the entries before it are that row's ancestors.
         *
         * A handler is reachable only through the projection object the caller
         * was handed, so when any row on this chain is removed the caller has
         * torn that object down and the handler is dead. `notifyRemoved`
         * withdraws it by testing this chain for membership, which reaches a
         * descendant at any depth in one pass and needs no row identity
         * beyond the `path|tupleHash` key the delivery path already computes.
         *
         * Empty for the root handler, which the observer itself owns and which
         * therefore outlives every row.
         */
        ownerChain: string[];
    }[] = [];
    private specificationHash: string;
    /**
     * One branch per distribution-rule intersection that authorizes the
     * subscription. Length 1 when no intersection occurred (no rule, or the
     * user is already authorized). Length >=1 with multiple entries when
     * two or more rules independently authorize the same target shape;
     * each branch is subscribed and its results deduplicated at the
     * observer for OR semantics.
     */
    private branches: ObserverBranch[];
    private stopped: boolean = false;
    private listenersAdded: boolean = false;
    private loadResolve: (() => void) | undefined;
    /**
     * Whether `loadedPromise` has settled. `refresh()` reads it to tell a
     * refresh that arrived during the initial load -- which is the initial
     * load, and issues no fetch of its own -- from one that arrived after it.
     */
    private loadSettled: boolean = false;
    /**
     * The `keepAlive` this observer was started with. `refresh()` fetches
     * either way; this only names the operation its diagnostics are reported
     * under, so a `subscribe` observer's refresh does not report as a watch.
     */
    private keepAlive: boolean = false;
    /**
     * Tracks all pending notification promises to enable waiting for processing completion.
     */
    private pendingNotifications: Set<Promise<void>> = new Set();
    /**
     * Reports that arrived before the starting read established `held`.
     *
     * Listeners are installed before the read, deliberately, to close the
     * window in which a fact could arrive unseen. A report from that window
     * cannot be applied yet, because `held` is not the result until the read
     * finishes. So it is buffered and applied once the read has. `null` once
     * the window is closed.
     */
    private startupReports: Map<ObserverLevel, ReportBatch> | null = new Map();
    /**
     * Reports awaiting application, grouped by the level they are about.
     */
    private queuedReports: Map<ObserverLevel, ReportBatch> = new Map();
    /** The next read number this observer hands out. */
    private nextRead = 0;
    /**
     * The reads this observer has numbered and that have not finished.
     *
     * A `decidedBy` entry for a row this observer does not hold is kept only to
     * outrank a report from a read that was already in flight. Once no
     * outstanding read is numbered below it, no such report can arrive, so the
     * entry is dropped -- the same bound jinaga.net's `ObserverLocal.EndRead`
     * puts on its withdrawals.
     */
    private pendingReads = new Set<number>();
    /**
     * Rows withdrawn, with the read that withdrew each, kept only so
     * `decidedBy` can forget them.
     *
     * Nothing is decided from this list. It is the work list `endRead` drains,
     * and holding it apart from `decidedBy` is what keeps forgetting a withdrawn
     * row from costing a walk of every row the observer holds -- the cost
     * issue #359 removed from absorbing a save.
     */
    private withdrawals: { level: ObserverLevel; rowHash: string; read: number }[] = [];
    /**
     * The number of the starting read, or `null` while it has not been taken.
     *
     * A report numbered below it is ignored. The starting read is an answer
     * about every row, taken after such a report's own read, so it has already
     * decided every row that report could be about.
     */
    private startupRead: number | null = null;
    /**
     * This observer's read numbering, handed to every inverse listener it
     * registers so the source numbers each read before it runs.
     */
    private readonly readNumbering: InverseReadNumbering = {
        beginRead: () => this.beginRead(),
        endRead: read => this.endRead(read)
    };
    /**
     * Serializes the application of reports, so the order rows reach the
     * handlers is the order they were decided in.
     */
    private applyChain: Promise<void> = Promise.resolve();
    /**
     * Buffers results that are pending delivery to result handlers.
     * 
     * The key is a string in the format `path|tupleHash`, where:
     *   - `path` is a string representing the traversal path in the specification.
     *   - `tupleHash` is the hash of the tuple of fact references for the current context.
     * 
     * The value is an object containing:
     *   - `projection`: The projection associated with the results.
     *   - `parentSubset`: The parent subset of fact references.
     *   - `resultSubset`: The labels identifying each row at this path (used for the row-identity hash on replay).
     *   - `results`: The buffered results (of type `ProjectedResult[]`) to be replayed to handlers when they are registered.
     * 
     * This map is used to buffer results that are produced before any handlers are registered,
     * enabling replay of results to late-registered handlers.
     */
    private pendingAddsByKey: Map<string, { projection: Projection; parentSubset: string[]; resultSubset: string[]; results: ProjectedResult[]; branch: ObserverBranch }>
        = new Map();
    /**
     * Labels (givens + match unknowns) drawn from the pre-intersection
     * specification. With multi-branch OR intersection each branch adds
     * different alpha-renamed auth-path unknowns to the tuple, so a hash
     * over the full tuple would differ across branches for the same row.
     * Hashing only over these labels yields a stable row identity that
     * collapses identical rows across branches for `votesByRow`.
     */
    private rowIdentityLabels: string[];
    /**
     * Distribution diagnostics captured for this observer's feeds (issue #207
     * W6), plus the handlers registered via `onDiagnostic`. `specificationString`
     * is the developer's pre-intersection spec, so diagnostics name the query
     * they wrote rather than an internally rewritten branch.
     */
    private readonly _diagnostics: DistributionDiagnostic[] = [];
    private readonly diagnosticHandlers: ((diagnostic: DistributionDiagnostic) => void)[] = [];
    private readonly specificationString: string;
    /**
     * Unregister callbacks for the per-feed "began delivering data" listeners
     * (issue #207 W9) that clear a reactive diagnostic when the subscription
     * race resolves. Torn down in `stop()`.
     */
    private readonly clearingUnsubscribes: (() => void)[] = [];

    constructor(
        private factManager: FactManager,
        private given: FactReference[],
        specification: Specification,
        resultAdded: ResultAddedFunc<T>,
        // Instance-level sink (issue #207 W5): forwards this observer's
        // diagnostics to `j.onDistributionDiagnostic`. Optional so the observer
        // works standalone (e.g. in tests) without the client hook.
        private readonly onDiagnostics?: (diagnostics: DistributionDiagnostic[]) => void
    ) {
        // Capture the original spec's labels. These are stable across any
        // future branch fan-out from `applySubscribeIntersection`.
        this.rowIdentityLabels = [
            ...specification.given.map(g => g.label.name),
            ...specification.matches.map(m => m.unknown.name)
        ];

        // Start with a single passthrough branch. `applySubscribeIntersection`
        // may replace this with one branch per matching distribution rule.
        // For an unintersected branch the vote labels equal the row identity
        // labels, so each row carries exactly one vote and ref counting
        // reduces to the pre-fix behavior.
        const rootVoteLabels = [...this.rowIdentityLabels];
        this.branches = [{
            specification,
            feeds: [],
            levels: buildLevels(specification, rootVoteLabels),
            voteLabels: rootVoteLabels
        }];

        // Map the given facts to a tuple.
        const tuple = specification.given.reduce((tuple, label, index) => ({
            ...tuple,
            [label.label.name]: given[index]
        }), {} as ReferencesByName);
        this.givenHash = computeObjectHash(tuple);

        // Add the initial handler.
        this.addedHandlers.push({
            path: "",
            tupleHash: this.givenHash,
            handler: resultAdded,
            ownerChain: []
        });

        // Identify the specification by its hash.
        const declarationString = describeDeclaration(given, specification.given.map(g => g.label));
        const specificationString = describeSpecification(specification, 0);
        const request = `${declarationString}\n${specificationString}`;
        this.specificationHash = computeStringHash(request);
        // Retain the pre-intersection spec description for diagnostics.
        this.specificationString = specificationString;
    }

    public start(keepAlive: boolean) {
        this.keepAlive = keepAlive;
        const givenTypes = this.given.map(g => g.type).join(', ');
        Trace.info(`[Observer] START - Spec hash: ${this.specificationHash.substring(0, 8)}..., Given hash: ${this.givenHash.substring(0, 8)}..., Given types: [${givenTypes}], KeepAlive: ${keepAlive}`);

        this.cachedPromise = new Promise((cacheResolve, _) => {
            this.loadedPromise = new Promise(async (loadResolve, loadReject) => {
                // Resolve through one function so every path that settles the
                // load -- both branches below and `stop()` -- also records that
                // it settled, which is what `refresh()` reads.
                const settleLoad = () => {
                    this.loadSettled = true;
                    loadResolve();
                };
                this.loadResolve = settleLoad;
                try {
                    // Phase 3 of j.subscribe trust release: intersect with any
                    // applicable distribution rule before installing listeners
                    // and reading. This way the spec returns empty until the
                    // authorizing fact arrives, at which point the existing
                    // inverse engine surfaces results via the auth-fact
                    // inverses that intersection added.
                    if (keepAlive) {
                        await this.applySubscribeIntersection();
                    }
                    // Ensure listeners are added BEFORE any read/fetch to close T2–T3 window.
                    if (!this.listenersAdded) {
                        this.addSpecificationListeners();
                    }
                    const mruDate: Date | null = await this.factManager.getMruDate(this.specificationHash);
                    if (mruDate === null) {
                        Trace.info(`[Observer] Not cached - Spec hash: ${this.specificationHash.substring(0, 8)}..., will fetch then read`);
                        // The data is not yet cached.
                        cacheResolve(false);
                        // Fetch from the server and then read from local storage.
                        await this.fetch(keepAlive);
                        if (this.stopped) return;
                        await this.read();
                        settleLoad();
                    }
                    else {
                        Trace.info(`[Observer] Cached (MRU: ${mruDate.toISOString()}) - Spec hash: ${this.specificationHash.substring(0, 8)}..., will read then fetch`);
                        // Read from local storage into the cache.
                        await this.read();
                        cacheResolve(true);
                        // Then fetch from the server to update the cache.
                        await this.fetch(keepAlive);
                        if (this.stopped) return;
                        settleLoad();
                    }
                    await this.factManager.setMruDate(this.specificationHash, new Date());
                    Trace.info(`[Observer] COMPLETE - Spec hash: ${this.specificationHash.substring(0, 8)}...`);
                    this.loadResolve = undefined;
                }
                catch (e) {
                    Trace.error(`[Observer] ERROR - Spec hash: ${this.specificationHash.substring(0, 8)}..., Error: ${e}`);
                    // The starting read never ran, so nothing has closed the
                    // startup window. Close it here. `queueReports` buffers
                    // without applying while the window is open, so a rejected
                    // fetch -- a failing network, a distribution refusal, an
                    // intersection error -- would otherwise leave this observer
                    // subscribed and permanently silent, adding every later
                    // report to a buffer nothing releases. `held` is empty,
                    // which is exactly what has been delivered, so the reports
                    // apply against it as any later batch's do; the starting
                    // read never answered, so no number floors them. Idempotent on
                    // the cached path, where `read()` has already closed it.
                    this.endStartup().catch(error =>
                        Trace.error(`[Observer] STARTUP RELEASE ERROR - Spec hash: ${this.specificationHash.substring(0, 8)}..., Error: ${error}`));
                    this.loadSettled = true;
                    this.loadResolve = undefined;
                    cacheResolve(false);
                    loadReject(e);
                }
            });
        });
    }

    /**
     * Install one listener per way a fact can change a row, at every path.
     *
     * The inverses come from `exactInverses`, which is proven to report every
     * row a fresh batch changes, and to report it with its direction
     * (`adds_sound`, `removes_sound`, `changes_complete`, `exact_correct`,
     * jinaga/jinaga-spec#19). So a row is applied as it arrives, and nothing is
     * read a second time to decide it.
     *
     * That is not the same as trusting the label `invertSpecification` carried,
     * which is what issue #338 got wrong: an inverse built for one level still
     * required the other levels' existential conditions on the new graph, so a
     * level that had just *lost* its solution found nothing and no handler ran.
     * The exact inverses re-attach every original top-level condition in the
     * add direction, and flip exactly one of them in the remove direction,
     * which is what makes each direction sound rather than merely a proposal.
     *
     * What direct application needs and a re-check did not is to know which of
     * two answers about one row is the later one. Reads run in the save path and
     * rows arrive in the order the reads *finish*, which is not the order of the
     * store states they saw, so every read is numbered before it runs and a
     * row's highest number wins. See `ObserverLevel.decidedBy`.
     *
     * Each is read with this observer's given references bound ahead of the new
     * fact, which is also how a specification whose given is joined only from
     * inside an existential condition becomes watchable at all (issue #141):
     * `addSpecificationListener` would refuse it for having more than one
     * given.
     */
    private addSpecificationListeners() {
        if (this.listenersAdded) {
            return;
        }
        const levelCount = this.branches.reduce((sum, b) => sum + b.levels.length, 0);
        Trace.info(`[Observer] ADDING LISTENERS - Spec hash: ${this.specificationHash.substring(0, 8)}..., Given hash: ${this.givenHash.substring(0, 8)}..., Branches: ${this.branches.length}, Levels: ${levelCount}`);

        for (let branchIndex = 0; branchIndex < this.branches.length; branchIndex++) {
            const branch = this.branches[branchIndex];
            for (const level of branch.levels) {
                const { adds, removes } = exactInverses(level.specification);
                // One per given as well: no inverse of an unknown waits for a
                // given's type, and a read returns nothing at all while a given
                // is absent from the store, so without these a subscription
                // started before its given arrived would never hear that every
                // row had just become available.
                const givenInverses = level.specification.given.map((_, index) =>
                    givenCandidateInverse(level.specification, index));
                const displayPath = level.path || "(root)";
                Trace.info(`[Observer] Branch ${branchIndex} path ${displayPath} - Add inverses: ${adds.length}, Remove inverses: ${removes.length}, Given inverses: ${givenInverses.length}`);

                level.listeners = [
                    ...adds.map(inverse => this.factManager.addInverseListener(
                        inverse,
                        this.given,
                        (results, read) => this.onReports(level, branch, results, "added", read),
                        this.readNumbering
                    )),
                    ...removes.map(inverse => this.factManager.addInverseListener(
                        inverse,
                        this.given,
                        (results, read) => this.onReports(level, branch, results, "removed", read),
                        this.readNumbering
                    )),
                    ...givenInverses.map(inverse => this.factManager.addInverseListener(
                        inverse,
                        this.given,
                        results => this.onGivenArrived(level, branch, results),
                        this.readNumbering
                    ))
                ];
            }
        }
        const totalListeners = this.branches.reduce(
            (sum, b) => sum + b.levels.reduce((levelSum, l) => levelSum + l.listeners.length, 0), 0);
        Trace.info(`[Observer] LISTENERS REGISTERED - Total: ${totalListeners}, Spec hash: ${this.specificationHash.substring(0, 8)}...`);
        this.listenersAdded = true;
    }

    public cached(): Promise<boolean> {
        if (this.cachedPromise === undefined) {
            throw new Error("The observer has not been started.");
        }
        return this.cachedPromise;
    }

    public loaded(): Promise<void> {
        if (this.loadedPromise === undefined) {
            throw new Error("The observer has not been started.");
        }
        return this.loadedPromise;
    }

    public async processed(): Promise<void> {
        // Keep waiting until no new notifications are created
        // This handles nested observers that register handlers which trigger more notifications
        while (this.pendingNotifications.size > 0) {
            // Create a snapshot of current pending notifications
            const currentNotifications = Array.from(this.pendingNotifications);
            await Promise.all(currentNotifications);
            
            // Check if new notifications were added while we were waiting
            // If so, loop again to wait for those too
        }
    }

    /**
     * See `Observer.refresh`. Three cases, in the order they are tested:
     * stopped (nothing to fetch into), still loading (the fetch it would
     * issue is already in flight), and loaded (fetch once more).
     */
    public async refresh(): Promise<void> {
        if (this.loadedPromise === undefined) {
            throw new Error("The observer has not been started.");
        }
        if (this.stopped) {
            return;
        }
        if (!this.loadSettled) {
            await this.loadedPromise;
            return;
        }
        await this.fetchOnce();
    }

    public stop() {
        this.stopped = true;
        // Drop any diagnostic-clearing listeners (issue #207 W9) so a feed that
        // delivers after stop() does not emit through a torn-down observer.
        for (const unsubscribe of this.clearingUnsubscribes) {
            unsubscribe();
        }
        this.clearingUnsubscribes.length = 0;
        for (const branch of this.branches) {
            for (const level of branch.levels) {
                for (const listener of level.listeners) {
                    this.factManager.removeInverseListener(listener);
                }
                level.listeners = [];
                level.held.clear();
                level.decidedBy.clear();
            }
            if (branch.feeds.length > 0) {
                this.factManager.unsubscribe(branch.feeds);
                branch.feeds = [];
            }
        }
        // Drop the reports that will now never be applied, along with the
        // levels they name. `held` is cleared above; leaving these holding the
        // same rows would retain every projected result a stopped observer had
        // queued.
        this.queuedReports.clear();
        this.startupReports = null;
        this.withdrawals = [];
        this.pendingReads.clear();
        // Settle loadedPromise if it is still pending, so callers that await
        // loaded() are not permanently suspended after stop().
        if (this.loadResolve) {
            this.loadResolve();
            this.loadResolve = undefined;
        }
    }

    private async applySubscribeIntersection() {
        const originalSpec = this.branches[0].specification;
        const branches = await this.factManager.intersectForSubscribe(this.given, originalSpec);
        // Passthrough: a single branch carrying the original (start, spec).
        // Keep the constructor-set state intact.
        const passthrough = branches.length === 1
            && branches[0].specification === originalSpec
            && branches[0].start === this.given;
        if (passthrough) {
            return;
        }
        const previousGivenHash = this.givenHash;
        // Every branch's intersected spec shares the same augmented given
        // shape — the synthetic `distributionUser` given is appended with
        // a fixed label and type, bound to the same userRef in every
        // branch. So a single observer-level `given` and `givenHash`
        // suffices; per-branch state covers only the spec / feeds /
        // listeners that actually differ.
        this.given = branches[0].start;
        const augmentedSpec = branches[0].specification;
        const tuple = augmentedSpec.given.reduce((tuple, label, index) => ({
            ...tuple,
            [label.label.name]: this.given[index]
        }), {} as ReferencesByName);
        this.givenHash = computeObjectHash(tuple);
        // Keep `specificationHash` as the pre-intersection identity (set
        // in the constructor). That hash is the MRU cache key and the
        // user-facing subscription identity; intersection is an internal
        // rewrite that should not change it.
        this.branches = branches.map(b => {
            // Vote labels are the branch's spec labels — broader than the
            // shared row-identity labels because each branch's auth path
            // contributes alpha-renamed unknowns (dist_admin, dist_user,
            // distributionUser, ...). Two distinct auth paths through the
            // same branch produce different vote ids; identical paths
            // collide and ref-count as one.
            const voteLabels = [
                ...b.specification.given.map(g => g.label.name),
                ...b.specification.matches.map(m => m.unknown.name)
            ];
            return {
                specification: b.specification,
                feeds: [],
                levels: buildLevels(b.specification, voteLabels),
                voteLabels
            };
        });
        // Re-key any handlers that were registered with the pre-intersection
        // givenHash. Notification routing matches handlers by tupleHash, so a
        // stale value here would silently drop every result.
        for (const handler of this.addedHandlers) {
            if (handler.tupleHash === previousGivenHash) {
                handler.tupleHash = this.givenHash;
            }
        }
        Trace.info(`[Observer] INTERSECTED - Spec hash: ${this.specificationHash.substring(0, 8)}..., Given hash: ${this.givenHash.substring(0, 8)}..., Branches: ${this.branches.length}`);
    }

    private async fetch(keepAlive: boolean) {
        if (!keepAlive) {
            await this.fetchOnce();
            return;
        }
        // Collect the per-feed decisions across all branches so they can be
        // surfaced as diagnostics (issue #207 W5/W6). Array.push from the
        // concurrent branch callbacks is safe on JS's single thread.
        const decisions: FeedDecision[] = [];
        await Promise.all(this.branches.map(async branch => {
            const { feeds, decisions: branchDecisions } = await this.factManager.subscribe(this.given, branch.specification);
            if (this.stopped) {
                // If stop() was called while we were awaiting subscribe(),
                // clean up the feeds that were just registered so the
                // subscriber is not leaked.
                if (feeds.length > 0) {
                    this.factManager.unsubscribe(feeds);
                }
                return;
            }
            branch.feeds = feeds;
            decisions.push(...branchDecisions);
            this.registerClearingListeners(feeds, branchDecisions);
        }));
        this.captureDiagnostics('subscribe', decisions);
    }

    /**
     * One pass over every branch's feeds, from wherever their bookmarks stand,
     * without holding them open. The initial load of a `watch` takes this path,
     * and so does every `refresh()` -- of a watch or of a subscription. Facts it
     * brings in are delivered by the inverse listeners, exactly as a local save
     * is, so a row already delivered is not delivered twice.
     */
    private async fetchOnce() {
        const decisions: FeedDecision[] = [];
        await Promise.all(this.branches.map(async branch => {
            const branchDecisions = await this.factManager.fetch(this.given, branch.specification);
            decisions.push(...branchDecisions);
        }));
        this.captureDiagnostics(this.keepAlive ? 'subscribe' : 'watch', decisions);
    }

    /**
     * Map the fetch/subscribe decisions to diagnostics and deliver them to the
     * observer-level handlers (W6) and the instance-level sink (W5). This must
     * never throw into the load flow — a distribution diagnostic is not fatal —
     * so the whole body is guarded and a throwing handler is isolated.
     */
    private captureDiagnostics(operation: 'watch' | 'subscribe', decisions: FeedDecision[]) {
        try {
            const diagnostics = toDistributionDiagnostics(operation, this.specificationString, decisions);
            if (diagnostics.length === 0) {
                return;
            }
            this._diagnostics.push(...diagnostics);
            for (const diagnostic of diagnostics) {
                for (const handler of this.diagnosticHandlers) {
                    this.safelyInvokeDiagnostic(handler, diagnostic);
                }
            }
            if (this.onDiagnostics) {
                try {
                    this.onDiagnostics(diagnostics);
                }
                catch (e) {
                    Trace.error(e);
                }
            }
        }
        catch (e) {
            Trace.error(e);
        }
    }

    private safelyInvokeDiagnostic(handler: (diagnostic: DistributionDiagnostic) => void, diagnostic: DistributionDiagnostic) {
        try {
            handler(diagnostic);
        }
        catch (e) {
            Trace.error(e);
        }
    }

    /**
     * For each kept-alive `reactive` feed, register a one-shot listener that
     * emits a clearing diagnostic once the feed begins delivering data (issue
     * #207 W9). A structural denial never delivers, so it never clears; only
     * reactive feeds — the subscription race — resolve this way. Fires once per
     * feed (NetworkManager dedupes the transition).
     */
    private registerClearingListeners(feeds: string[], decisions: FeedDecision[]) {
        if (this.stopped) {
            return;
        }
        const keptAlive = new Set(feeds);
        for (const decision of decisions) {
            if (decision.decision === 'reactive' && decision.feed && keptAlive.has(decision.feed)) {
                const unsubscribe = this.factManager.onFeedData(decision.feed, () => this.emitFeedCleared(decision));
                this.clearingUnsubscribes.push(unsubscribe);
            }
        }
    }

    /**
     * Emit the clearing diagnostic for a resolved reactive feed to the observer
     * handlers (W6) and the instance sink (W5). Guarded like `captureDiagnostics`
     * so it never disturbs the observer.
     */
    private emitFeedCleared(decision: FeedDecision) {
        if (this.stopped) {
            return;
        }
        try {
            const cleared = toClearingDiagnostic('subscribe', this.specificationString, decision);
            this._diagnostics.push(cleared);
            for (const handler of this.diagnosticHandlers) {
                this.safelyInvokeDiagnostic(handler, cleared);
            }
            if (this.onDiagnostics) {
                try {
                    this.onDiagnostics([cleared]);
                }
                catch (e) {
                    Trace.error(e);
                }
            }
        }
        catch (e) {
            Trace.error(e);
        }
    }

    public diagnostics(): DistributionDiagnostic[] {
        return [...this._diagnostics];
    }

    public onDiagnostic(handler: (diagnostic: DistributionDiagnostic) => void): void {
        this.diagnosticHandlers.push(handler);
        // Replay diagnostics already captured before this handler registered —
        // the observer starts as soon as it is created, so a caller wiring up
        // `onDiagnostic` right after `watch`/`subscribe` returns would otherwise
        // miss any diagnostic captured during that same tick.
        for (const diagnostic of this._diagnostics) {
            this.safelyInvokeDiagnostic(handler, diagnostic);
        }
    }

    private async read() {
        // Numbered before the read, and kept as the floor every later report is
        // measured against. This read is an answer about every row, so a report
        // from a read numbered below it has already been answered here. The
        // floor stands only once the read has answered: a read that rejects
        // answered nothing, and a floor left behind by it would drop every
        // report buffered while the fetch ran.
        const read = this.beginRead();
        let branchResults: { branch: ObserverBranch; projected: ProjectedResult[] }[];
        try {
            // Read every branch's spec. Each branch produces an independently
            // filtered result set (different intersected auth conditions); the
            // dedup at `notifyAdded` ensures each row surfaces only once.
            branchResults = await Promise.all(this.branches.map(async branch => ({
                branch,
                projected: await this.factManager.read(this.given, branch.specification)
            })));
            if (this.stopped) {
                // The observer was stopped before the read completed.
                return;
            }
            this.startupRead = read;
            // Make the read the held set before anything is delivered from it,
            // so a report that arrives mid-delivery is applied against a set
            // that is already the result rather than one still filling up.
            for (const { branch, projected } of branchResults) {
                this.initializeHeld(branch, projected, read);
            }
        }
        finally {
            // The read is over once `held` is it. The delivery below is not
            // part of the read, and a handler that parks -- which one may do
            // for as long as it likes -- must not hold this number outstanding.
            this.endRead(read);
        }
        // Release the startup window here, as soon as `held` is the result --
        // not after the deliveries below. A decision must never wait on a
        // delivery: `notifyAdded` calls the caller's own add handler, which may
        // park for as long as it likes, and while the window is open
        // `queueReports` buffers a report without applying it. Ending the
        // window afterwards therefore left every fact that arrived during the
        // initial delivery undecided for as long as one handler stayed
        // suspended, which for a handler that waits on a later row of this same
        // watch is forever.
        //
        // The buffered reports apply against `held`, which the loop above has
        // just made the result, and deliver on their own promise. That promise
        // is awaited after the deliveries below rather than before them, so
        // neither side waits on the other's handler.
        let startupFailure: unknown;
        const startupDecided = this.endStartup().catch((e: unknown) => { startupFailure = e; });
        try {
            for (const { branch, projected } of branchResults) {
                const givenSubset = branch.specification.given.map(g => g.label.name);
                const resultSubset = [...givenSubset, ...branch.specification.matches.map(m => m.unknown.name)];
                await this.notifyAdded(projected, branch.specification.projection, "", givenSubset, resultSubset, branch);
            }
        }
        finally {
            await startupDecided;
        }
        if (startupFailure !== undefined) {
            throw startupFailure;
        }
    }

    /**
     * One exact inverse's rows, as reports at `level`.
     *
     * The direction is the listener's: every row an add inverse returns is in
     * the result its read saw, and every row a remove inverse returns is absent
     * from it. `read` is the number that read was given before it ran, which is
     * how a row's latest answer is recognized when two reads about it finish out
     * of order.
     *
     * An empty result returns early, exactly as the row stream's
     * `onCandidates` does: there is no row to report.
     *
     * Nothing is filtered by a given-subset hash here. `addInverseListener`
     * reads with this observer's given references bound, so every row it
     * returns already belongs to this observer — which is what lets the
     * subscription's givens be bound in the read rather than reconstructed by
     * hashing each result (issue #344).
     */
    private async onReports(level: ObserverLevel, branch: ObserverBranch, results: ProjectedResult[], operation: "added" | "removed", read: number): Promise<void> {
        if (this.stopped) {
            return;
        }
        const rows = this.toRows(results, level);
        if (rows.length === 0) {
            return;
        }
        await this.queueReports(level, branch, rows.map(row => ({ row, operation, read })), []);
    }

    /**
     * This observer's own given has arrived, so read the whole level.
     *
     * No inverse of an unknown waits for a given's type, and
     * `SpecificationRunner.read` returns nothing at all while a given fact is
     * absent, so the moment the given arrives every row of the level appears at
     * once. That is the theorem's given case -- nothing was read before, so
     * every row read now is an add -- and the read is numbered before it runs
     * like any other, so it orders against the inverse reads instead of
     * overriding them.
     *
     * An empty result returns early whichever inverse fired. The given
     * inverse's pin is bound through an unknown equal to both the new fact and
     * the given, so a fact of the given's type that is *not* this observer's
     * given yields no solution at all, and reading the whole level for it would
     * cost the whole result on every unrelated fact of a common given type --
     * a user, a tenant.
     */
    private async onGivenArrived(level: ObserverLevel, branch: ObserverBranch, results: ProjectedResult[]): Promise<void> {
        if (this.stopped || results.length === 0) {
            return;
        }
        // Numbered before the read it is an answer about -- this one -- not
        // before the inverse read that brought us here.
        const read = this.beginRead();
        try {
            const present = this.toRowMap(await this.readLevel(level), level);
            if (this.stopped) {
                return;
            }
            await this.queueReports(level, branch, [], [{ read, present }]);
        }
        finally {
            this.endRead(read);
        }
    }

    /**
     * Buffer reports for a level, and apply them unless the startup window is
     * still open.
     */
    private async queueReports(level: ObserverLevel, branch: ObserverBranch, reports: Report[], fullReads: FullRead[]): Promise<void> {
        const buffer = this.startupReports ?? this.queuedReports;
        const entry = buffer.get(level);
        if (entry) {
            entry.reports.push(...reports);
            entry.fullReads.push(...fullReads);
        }
        else {
            buffer.set(level, { branch, reports: [...reports], fullReads: [...fullReads] });
        }
        if (this.startupReports) {
            return;
        }

        const notificationPromise = this.enqueueApply().finally(() => {
            this.pendingNotifications.delete(notificationPromise);
        });
        this.pendingNotifications.add(notificationPromise);
        await notificationPromise;
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
     * A `decidedBy` entry for a row this observer does not hold exists only to
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
            if (!withdrawal.level.held.has(withdrawal.rowHash)
                && withdrawal.level.decidedBy.get(withdrawal.rowHash) === withdrawal.read) {
                withdrawal.level.decidedBy.delete(withdrawal.rowHash);
            }
            return false;
        });
    }

    /**
     * Apply the queued reports, after every application already in flight.
     *
     * The chain is what makes the delivered order the order of decisions. It
     * also coalesces: reports that arrive while an application is running are
     * taken by the next link in one batch, where the link keeps only the latest
     * read's answer per row and emits the net change against `held`.
     */
    private enqueueApply(): Promise<void> {
        const decided = this.applyChain.then(() => this.applyQueuedReports());
        // Only the application is serialized. It updates `held`, so two batches
        // applying at once could interleave their updates; the chain is what
        // keeps each batch's coalescing and its `held` update together.
        //
        // Delivery is deliberately NOT on the chain. It calls the caller's own
        // add handler, which may park for as long as it likes -- a `watch`
        // handler that awaits a save of its own is ordinary -- and holding the
        // chain across it would stall every later decision behind it, and with
        // it the `fact()` call whose notification produced the next batch. It
        // would also defeat the observer's own add/remove race handling
        // (`addsInFlight` and `pendingRemovals`), which exists precisely so
        // that a removal can be recorded while an add handler is still
        // suspended.
        //
        // A failure must not poison the chain either. A rejected link would
        // make every later application reject without running, so one failure
        // would silently end this observer's updates for good. The caller still
        // sees it, through the promise returned here.
        this.applyChain = decided.then(() => { }, () => { });
        return decided.then(decisions => this.deliverDecisions(decisions));
    }

    /**
     * Deliver decided transitions, in the order they were decided.
     *
     * Ordering holds within a batch. Across batches saved concurrently it does
     * not, which is the case issue #345 does not claim and
     * jinaga/jinaga-spec#13 leaves open: the observer's vote set and its
     * in-flight race handling are what keep that case from retaining a row, and
     * they are reached from here unchanged.
     */
    private async deliverDecisions(decisions: PendingDelivery[]): Promise<void> {
        for (const { level, branch, operation, result } of decisions) {
            if (this.stopped) {
                return;
            }
            if (operation === "added") {
                await this.notifyAdded([result], level.projection, level.path, level.parentSubset, level.resultSubset, branch);
            }
            else {
                await this.notifyRemoved(level.path, level.resultSubset, [result], branch);
            }
        }
    }

    /**
     * Apply the queued reports, level by level, and return what to deliver.
     *
     * Nothing is read here. The exact inverses have already said which rows
     * changed and in which direction, on a store that held the whole batch,
     * which is the premise jinaga/jinaga-spec#19 proves them exact under
     * (`exact_correct`). What remains is to take, per row, the answer from the
     * latest read, and emit the change it makes to `held`.
     */
    private async applyQueuedReports(): Promise<PendingDelivery[]> {
        const queued = this.queuedReports;
        if (queued.size === 0 || this.stopped) {
            return [];
        }
        this.queuedReports = new Map();

        // Parents before children. A child row's handler is registered by its
        // parent's `onAdded`, so applying the shallower path first spares the
        // child the buffer-and-replay path in `bufferPendingNotification`.
        const entries = [...queued.entries()].sort((a, b) => a[0].path.length - b[0].path.length);

        const deliveries: PendingDelivery[] = [];
        for (const [level, entry] of entries) {
            const reports = this.latestPerRow(level, entry);
            let changes = 0;
            for (const report of reports) {
                const delivery = this.applyReport(level, entry.branch, report);
                if (delivery !== null) {
                    deliveries.push(delivery);
                    changes++;
                }
            }
            if (changes > 0) {
                const displayPath = level.path || "(root)";
                Trace.info(`[Observer] APPLIED - Path: ${displayPath}, Reports: ${reports.length}, Changes: ${changes}`);
            }
        }
        return deliveries;
    }

    /**
     * One report per row: the one from the latest read.
     *
     * The reports reaching one link come from several reads, which finished in
     * whatever order they finished in. Keeping the greatest read number per row
     * and applying only that is what makes the link emit the net change against
     * `held` rather than replaying each read's answer in turn: a row an older
     * read added and a newer read removed is one removal, or no transition at
     * all if the observer never held it.
     *
     * This is NOT `recheckCandidates`' dedupe, which kept the FIRST candidate
     * for a row because a fresh read, not the candidate, was going to decide
     * it. Keeping the first report here would keep the stalest answer.
     *
     * A whole-level read is expanded here, inside the chain, because the rows it
     * did not return are an answer about this level only against `held`.
     */
    private latestPerRow(level: ObserverLevel, entry: ReportBatch): Report[] {
        const latest = new Map<string, Report>();
        const consider = (report: Report) => {
            const existing = latest.get(report.row.rowHash);
            if (existing === undefined || existing.read < report.read) {
                latest.set(report.row.rowHash, report);
            }
        };
        for (const report of entry.reports) {
            consider(report);
        }
        for (const { read, present } of entry.fullReads) {
            for (const row of present.values()) {
                consider({ row, operation: "added", read });
            }
            for (const row of level.held.values()) {
                if (!present.has(row.rowHash)) {
                    consider({ row, operation: "removed", read });
                }
            }
        }
        return [...latest.values()];
    }

    /**
     * Apply one report at one level, and return the transition it makes.
     *
     * A report from a read numbered at or below the latest that decided this
     * row is an answer about a store state no newer than the one already
     * applied, so it is dropped. Otherwise the number is recorded -- whether or
     * not the row moved, because a remove that changes nothing must still
     * outrank an older add arriving after it -- and the row is added or removed
     * where `held` disagrees with the report.
     *
     * A removal is delivered from `held`, not from the remove inverse's own
     * row: that tuple carries the fact whose arrival retracted the row, while
     * the caller is being told about the result it was offered.
     */
    private applyReport(level: ObserverLevel, branch: ObserverBranch, report: Report): PendingDelivery | null {
        const rowHash = report.row.rowHash;
        if (this.startupRead !== null && report.read < this.startupRead) {
            return null;
        }
        const decided = level.decidedBy.get(rowHash);
        if (decided !== undefined && decided >= report.read) {
            return null;
        }
        level.decidedBy.set(rowHash, report.read);
        if (report.operation === "added") {
            if (level.held.has(rowHash)) {
                return null;
            }
            level.held.set(rowHash, report.row);
            return { level, branch, operation: "added", result: report.row.result };
        }
        this.withdrawals.push({ level, rowHash, read: report.read });
        const heldRow = level.held.get(rowHash);
        if (heldRow === undefined) {
            return null;
        }
        level.held.delete(rowHash);
        return { level, branch, operation: "removed", result: heldRow.result };
    }

    /**
     * Read one level's specification.
     *
     * The root's specification is the branch specification, read the way every
     * other caller reads it. A nested level's is derived -- the parent's matches
     * followed by the component's own -- and is read without a second purge
     * compliance check. `testSpecificationForCompliance` looks only at a
     * specification's own matches and never inside a projection, so the
     * flattened form presents matches the root never presented for checking: a
     * purge condition on a type reached only inside a child collection passes
     * for the root and fails for the flattening. The throw is contained by
     * listener containment, which would leave that collection silently out of
     * date rather than reporting anything.
     */
    private readLevel(level: ObserverLevel): Promise<ProjectedResult[]> {
        return level.path === ""
            ? this.factManager.read(this.given, level.specification)
            : this.factManager.readDerived(this.given, level.specification);
    }

    /**
     * Release the startup window: apply what arrived during it against the
     * result that the starting read has now established.
     *
     * The window's reports are coalesced with everything else in the link that
     * applies them, so a row the window saw added and then removed costs one
     * decision, and a report from a read the starting read already answered is
     * dropped by its number.
     */
    private async endStartup(): Promise<void> {
        const buffered = this.startupReports;
        this.startupReports = null;
        if (!buffered || buffered.size === 0 || this.stopped) {
            return;
        }
        for (const [level, entry] of buffered) {
            const existing = this.queuedReports.get(level);
            if (existing) {
                existing.reports.push(...entry.reports);
                existing.fullReads.push(...entry.fullReads);
            }
            else {
                this.queuedReports.set(level, entry);
            }
        }
        const notificationPromise = this.enqueueApply().finally(() => {
            this.pendingNotifications.delete(notificationPromise);
        });
        this.pendingNotifications.add(notificationPromise);
        await notificationPromise;
    }

    /**
     * A level's rows, each carrying the projected result the delivery path
     * needs, keyed over the level's `keyLabels`. The extra labels an inverse's
     * tuple carries — the pinned fact, any label lifted out of an existential
     * condition, and the `given` match `reduceGivenConditions` adds — are not
     * among them, so a row reached through one inverse keys identically to the
     * same row read from the result.
     */
    private toRows(results: ProjectedResult[], level: ObserverLevel): SpecificationRow<ProjectedResult>[] {
        return results.map(pr => ({
            result: pr,
            rowHash: computeTupleSubsetHash(pr.tuple, level.keyLabels)
        }));
    }

    private toRowMap(results: ProjectedResult[], level: ObserverLevel): Map<string, SpecificationRow<ProjectedResult>> {
        const rows = new Map<string, SpecificationRow<ProjectedResult>>();
        for (const row of this.toRows(results, level)) {
            if (!rows.has(row.rowHash)) {
                rows.set(row.rowHash, row);
            }
        }
        return rows;
    }

    /**
     * Make the starting read this branch's held set, at every path.
     *
     * Walking the projection costs no extra reads: a nested collection's rows
     * are already in the result the root read returned, and their tuples carry
     * the parent's labels, which is what the nested level keys on.
     */
    private initializeHeld(branch: ObserverBranch, projected: ProjectedResult[], read: number): void {
        const levelsByPath = new Map(branch.levels.map(level => [level.path, level]));
        const walk = (path: string, results: ProjectedResult[]) => {
            const level = levelsByPath.get(path);
            if (!level) {
                return;
            }
            for (const row of this.toRows(results, level)) {
                if (!level.held.has(row.rowHash)) {
                    level.held.set(row.rowHash, row);
                    level.decidedBy.set(row.rowHash, read);
                }
            }
            if (level.projection.type === "composite") {
                for (const component of level.projection.components) {
                    if (component.type === "specification") {
                        for (const pr of results) {
                            const childResults = pr.result?.[component.name];
                            if (Array.isArray(childResults)) {
                                walk(path + "." + component.name, childResults);
                            }
                        }
                    }
                }
            }
        };
        walk("", projected);
    }

    /**
     * Pick (rowHash, voteId) for `path`. At the root they're distinct so
     * the same row from two branches collides on `rowHash` while their
     * distinct auth paths separate on `voteId` — that's the OR fan-out.
     * At nested paths there's a single possible auth path per row, so
     * the two hashes coincide and the vote set degenerates to one entry.
     */
    private rowAndVoteHashes(tuple: ReferencesByName, path: string, branch: ObserverBranch, resultSubset: string[]): { rowHash: string; voteId: string } {
        if (path === "") {
            return {
                rowHash: computeTupleSubsetHash(tuple, this.rowIdentityLabels),
                voteId: computeTupleSubsetHash(tuple, branch.voteLabels)
            };
        }
        // Identify a nested row by the labels that define it at this path
        // (its `resultSubset`), not by the whole tuple — and identically on
        // both the add and remove sides. A `remove` inverse's tuple carries
        // extra labels — e.g. the superseding fact whose arrival retracts the
        // row — that are absent from the `add` tuple. Hashing the full tuple
        // would give the remove a different row hash than the add, so the
        // removal would never match the delivered row. Restricting both sides
        // to `resultSubset` keeps them in lock-step.
        const h = computeTupleSubsetHash(tuple, resultSubset);
        return { rowHash: h, voteId: h };
    }

    /**
     * The rows a branch holds at its root path, keyed over its `voteLabels` --
     * the same hash `rowAndVoteHashes` returns as a root row's `voteId`.
     */
    private rootHeld(branch: ObserverBranch): Map<string, SpecificationRow<ProjectedResult>> {
        return branch.levels[0].held;
    }

    private async notifyAdded(projectedResults: ProjectedResult[], projection: Projection, path: string, parentSubset: string[], resultSubset: string[], branch: ObserverBranch) {
        const displayPath = path || "(root)";
        Trace.info(`[Observer] NOTIFY_ADDED - Path: ${displayPath}, Results: ${projectedResults.length}, Parent subset: [${parentSubset.join(', ')}]`);

        // Track the first error from a failing row so it can still surface to
        // the caller (e.g. reject `loaded()`), without letting one row's
        // handler failure abort delivery to the rest of this batch.
        let firstError: unknown;
        for (const pr of projectedResults) {
            try {
                await this.notifyAddedRow(pr, projection, path, displayPath, parentSubset, resultSubset, branch);
            } catch (e) {
                Trace.error(`[Observer] ADD HANDLER ERROR - Path: ${displayPath}, Error: ${e}`);
                if (firstError === undefined) {
                    firstError = e;
                }
            }
        }
        if (firstError !== undefined) {
            throw firstError;
        }
    }

    private async notifyAddedRow(pr: ProjectedResult, projection: Projection, path: string, displayPath: string, parentSubset: string[], resultSubset: string[], branch: ObserverBranch) {
        // Identify the parent row by `parentSubset` (its result subset).
        // This must equal the `tupleHash` under which the parent's
        // injectObservers registered this path's handler — both hash the
        // parent row over the same subset — so the lookup below finds it.
        const parentTupleHash = computeTupleSubsetHash(pr.tuple, parentSubset);
        const { rowHash, voteId } = this.rowAndVoteHashes(pr.tuple, path, branch, resultSubset);

        Trace.info(`[Observer] Processing result - Path: ${displayPath}, Row hash: ${rowHash.substring(0, 8)}..., Vote id: ${voteId.substring(0, 8)}..., Parent tuple hash: ${parentTupleHash.substring(0, 8)}...`);

        // The lookup comes before injectObservers because the handler it finds
        // carries the parent row's owner chain, which the handlers this row's
        // own projection registers extend. It is a pure read, so hoisting it
        // above the await only spares the buffering paths below the work of
        // building a projection they discard.
        const addedHandler = this.addedHandlers.find(h => h.tupleHash === parentTupleHash && h.path === path);
        const resultAdded = addedHandler?.handler;

        if (!addedHandler) {
            Trace.warn(`[Observer] NO HANDLER FOUND - Path: ${displayPath}, Parent tuple hash: ${parentTupleHash.substring(0, 8)}..., Available handlers: ${this.addedHandlers.length}`);
            this.addedHandlers.forEach((h, index) => {
                Trace.warn(`[Observer]   Handler ${index + 1}: Path="${h.path}", Tuple hash: ${h.tupleHash.substring(0, 8)}...`);
            });
            // Buffer for replay when the handler registers later.
            this.bufferPendingNotification(path, pr, projection, parentSubset, resultSubset, branch);
            // Skip deeper recursion until handler is registered.
            return;
        } else if (!resultAdded) {
            Trace.warn(`[Observer] Handler found but no callback - Path: ${displayPath}`);
            // Buffer for replay when the callback is attached.
            this.bufferPendingNotification(path, pr, projection, parentSubset, resultSubset, branch);
            return;
        } else {
            Trace.info(`[Observer] Handler found - Path: ${displayPath}`);
        }

        // This row's own key, and the chain a handler registered by its
        // projection belongs to: the parent row's chain with this row appended.
        const rowProjectionHash = computeTupleSubsetHash(pr.tuple, resultSubset);
        const rowChain = [...addedHandler.ownerChain, this.rowProjectionKey(path, rowProjectionHash)];
        const result: any = await this.injectObservers(pr, projection, path, resultSubset, rowChain);

        // Deliver a root row only if its branch still holds it. `held` is the
        // observer's single record of membership, and a delivery can be
        // overtaken by a later decision: the startup window closes before the
        // initial delivery, and no delivery is on the decision chain, so a
        // decision that withdraws this row can run while an earlier row's
        // handler is suspended. That removal finds no vote for a row not yet
        // delivered and is dropped, so delivering it now would leave the
        // caller holding a row the result no longer has, which no later
        // report corrects. Skipping it makes the net transition absent to
        // absent. If the row has been re-added since, that decision delivers
        // it on its own. Checked after the await above, right before the vote
        // and the handler. Nested rows are #358's.
        if (path === "" && !this.rootHeld(branch).has(voteId)) {
            Trace.info(`[Observer] SKIPPING WITHDRAWN ROW - Path: ${displayPath}, Row hash: ${rowHash.substring(0, 8)}...`);
            return;
        }

        // Cast the vote. First vote into an empty set means this is
        // the first time the user sees this row; subsequent votes
        // (other branches authorizing the same row, or another auth
        // path within the same branch) ref-count silently.
        let votes = this.votesByRow.get(rowHash);
        const isFirstDelivery = !votes;
        if (!votes) {
            votes = new Set();
            this.votesByRow.set(rowHash, votes);
        }
        votes.add(voteId);

        if (isFirstDelivery) {
            if (this.stopped) {
                Trace.info(`[Observer] SKIPPING HANDLER - Observer stopped, Path: ${displayPath}, Row hash: ${rowHash.substring(0, 8)}...`);
                return;
            }
            Trace.info(`[Observer] CALLING HANDLER - Path: ${displayPath}, Row hash: ${rowHash.substring(0, 8)}...`);
            // Awaiting this handler before the recursion below is a causal
            // requirement, not a convenience. `injectObservers` captured THIS
            // row's tupleHash in the onAdded closure it put on `result`, so a
            // child handler enters `addedHandlers` only when this callback
            // reaches into `result.<component>.onAdded`. Descending before that
            // returns finds no handler and buffers instead of delivering.
            const promiseMaybe = resultAdded(result);
            if (promiseMaybe instanceof Promise) {
                // Mark this row as having a genuine in-flight async add so
                // `notifyRemoved` can tell this case apart from a row whose
                // add handler already finished without registering a removal.
                this.addsInFlight.add(rowHash);
                try {
                    const functionMaybe = await promiseMaybe;
                    // A remove notification that arrived while we were awaiting
                    // the add handler withdrew this row's last vote. Clear the
                    // marker either way, so it does not linger and incorrectly
                    // affect a future re-add of the same row.
                    const diedWhileInFlight = this.pendingRemovals.delete(rowHash);
                    if (functionMaybe instanceof Function) {
                        if (diedWhileInFlight) {
                            // Invoke the removal immediately rather than storing
                            // it, so the item is not permanently retained in the
                            // observed set.
                            Trace.info(`[Observer] PENDING REMOVAL FOUND - Path: ${displayPath}, Row hash: ${rowHash.substring(0, 8)}..., invoking removal immediately`);
                            await functionMaybe();
                        } else {
                            this.removalsByRow.set(rowHash, functionMaybe);
                        }
                    }
                    if (diedWhileInFlight) {
                        // notifyRemoved could not withdraw this row's handlers
                        // when it fired: the add handler that registers them
                        // had not returned yet. Withdraw them now.
                        this.tearDownRowHandlers(path, rowProjectionHash);
                    }
                } finally {
                    // Whether the await resolved or rejected, this row is no
                    // longer in flight — clear it so a remove arriving after
                    // this point is not mistaken for the in-flight race.
                    this.addsInFlight.delete(rowHash);
                }
            }
            else {
                const functionMaybe = promiseMaybe;
                if (functionMaybe instanceof Function) {
                    this.removalsByRow.set(rowHash, async () => {
                        functionMaybe();
                        return Promise.resolve();
                    });
                }
            }
        } else {
            Trace.info(`[Observer] Skipping already notified row - Path: ${displayPath}, Row hash: ${rowHash.substring(0, 8)}...`);
        }

        // Recursively notify added for specification results. Parent before
        // child is the model's causal edge here — the closure capture in
        // injectObservers is what records it — so this must stay downstream of
        // the awaited handler above and must not become a Promise.all with it.
        // Sibling ROWS carry no such edge (results are a set), which is why
        // notifyAdded's loop is merely conservative rather than required; see
        // ObservableSource's listener fan-out for the same rule stated there.
        if (projection.type === "composite") {
            for (const component of projection.components) {
                if (component.type === "specification") {
                    const childPath = path + "." + component.name;
                    const childResults = pr.result[component.name];
                    // The child row's identity is this row's resultSubset
                    // plus the labels introduced by the nested component's
                    // matches — the same accumulation invertSpecification
                    // performs (see inverse.ts).
                    const childResultSubset = [...resultSubset, ...component.matches.map(m => m.unknown.name)];
                    // The child's parent subset is this row's identity —
                    // its `resultSubset` — matching how invertSpecification
                    // sets `parentSubset: context.resultSubset` (inverse.ts).
                    Trace.info(`[Observer] Processing nested spec - Parent path: ${displayPath}, Child path: ${childPath}, Child results: ${childResults?.length || 0}`);
                    await this.notifyAdded(childResults, component.projection, childPath, resultSubset, childResultSubset, branch);
                }
            }
        }
    }

    async notifyRemoved(path: string, resultSubset: string[], projectedResult: ProjectedResult[], branch: ObserverBranch): Promise<void> {
        for (const pr of projectedResult) {
            const { rowHash, voteId } = this.rowAndVoteHashes(pr.tuple, path, branch, resultSubset);
            const votes = this.votesByRow.get(rowHash);
            if (!votes) continue;
            // `delete` returns false if this vote wasn't recorded, in
            // which case the remove is for a (row, auth path) the
            // observer never delivered — nothing to do.
            if (!votes.delete(voteId)) continue;
            if (votes.size > 0) {
                Trace.info(`[Observer] NOTIFY_REMOVED - Row hash: ${rowHash.substring(0, 8)}..., Remaining votes: ${votes.size} (row retained)`);
                continue;
            }
            // Last vote withdrawn — fire the row's removal callback and
            // forget the row entirely so a future add can re-deliver it.
            const removal = this.removalsByRow.get(rowHash);
            this.votesByRow.delete(rowHash);
            this.removalsByRow.delete(rowHash);
            // Withdraw the row's handlers before the removal callback runs, so
            // that an add arriving while an asynchronous removal is in flight
            // cannot still reach the projection that is being torn down.
            this.tearDownRowHandlers(path, computeTupleSubsetHash(pr.tuple, resultSubset));
            if (removal !== undefined) {
                Trace.info(`[Observer] NOTIFY_REMOVED - Row hash: ${rowHash.substring(0, 8)}..., Last vote withdrawn, firing removal`);
                await removal();
            } else if (this.addsInFlight.has(rowHash)) {
                // The add handler for this row is still awaiting its async
                // result — the removal function has not been registered yet.
                // Record a pending removal so that when the add handler
                // completes, it fires the removal immediately rather than
                // storing it. This prevents the item from being permanently
                // retained in the observed set across concurrent saves.
                Trace.info(`[Observer] NOTIFY_REMOVED - Row hash: ${rowHash.substring(0, 8)}..., Last vote withdrawn, add still in flight — marking pending`);
                this.pendingRemovals.add(rowHash);
            } else {
                // No removal was ever registered, and no add is currently in
                // flight for this row — its add handler already finished
                // with nothing to clean up. Nothing to do.
                Trace.info(`[Observer] NOTIFY_REMOVED - Row hash: ${rowHash.substring(0, 8)}..., Last vote withdrawn, no removal to fire`);
            }
        }
    }

    /**
     * Buffers a pending notification for replay when a handler is registered later.
     * 
     * @param path - The path in the specification
     * @param pr - The projected result to buffer
     * @param projection - The projection associated with the result
     * @param parentSubset - The parent subset of fact references
     */
    private bufferPendingNotification(path: string, pr: ProjectedResult, projection: Projection, parentSubset: string[], resultSubset: string[], branch: ObserverBranch): void {
        const parentTupleHash = computeTupleSubsetHash(pr.tuple, parentSubset);
        const key = `${path}|${parentTupleHash}`;
        const existing = this.pendingAddsByKey.get(key);
        if (existing) {
            existing.results.push(pr);
        }
        else {
            this.pendingAddsByKey.set(key, { projection, parentSubset, resultSubset, results: [pr], branch });
        }
    }

    /**
     * The key identifying one delivered row: the path it sits at, and the hash
     * `injectObservers` computes for it over its `resultSubset`. Used to record
     * which rows a handler's lifetime depends on; it is the same hash the
     * delivery path already computes, not a second identity for a row.
     */
    private rowProjectionKey(path: string, projectionHash: string): string {
        return `${path}|${projectionHash}`;
    }

    /**
     * Withdraw everything registered by the projection of a row that has just
     * been removed, at any depth. The caller has torn that projection down, so
     * a handler it registered has no one to deliver to; leaving it in place
     * makes `notifyAddedRow`'s `find` return it ahead of the handler a later
     * delivery of the same row registers, and the child reaches the discarded
     * projection while the live one never sees it.
     *
     * Descendants come out in the same pass: every handler carries the chain of
     * rows whose projections enclose it, so membership of this row's key in
     * that chain is the whole test.
     */
    private tearDownRowHandlers(path: string, projectionHash: string): void {
        const rowKey = this.rowProjectionKey(path, projectionHash);
        const dead = this.addedHandlers.filter(h => h.ownerChain.includes(rowKey));
        if (dead.length > 0) {
            this.addedHandlers = this.addedHandlers.filter(h => !h.ownerChain.includes(rowKey));
            Trace.info(`[Observer] HANDLERS WITHDRAWN - Row: ${path || "(root)"}, Hash: ${projectionHash.substring(0, 8)}..., Withdrawn: ${dead.length}, Remaining: ${this.addedHandlers.length}`);
        }

        // Adds buffered for a handler that has just been withdrawn would
        // otherwise replay into whatever registers at that key next.
        for (const h of dead) {
            this.pendingAddsByKey.delete(`${h.path}|${h.tupleHash}`);
        }
        // And adds buffered beneath this row whose handler never registered at
        // all, which leave no entry above to find them by.
        const childPrefix = path + ".";
        for (const key of Array.from(this.pendingAddsByKey.keys())) {
            const separator = key.lastIndexOf("|");
            if (key.substring(separator + 1) === projectionHash && key.substring(0, separator).startsWith(childPrefix)) {
                this.pendingAddsByKey.delete(key);
            }
        }
    }

    private async injectObservers(pr: ProjectedResult, projection: Projection, parentPath: string, resultSubset: string[], ownerChain: string[]): Promise<any> {
        const displayPath = parentPath || "(root)";

        if (projection.type === "composite") {
            const composite: any = {};
            // Identify this parent row by its result subset, the same labels
            // the child's `notifyAdded` will use to compute `parentTupleHash`
            // when matching this handler (see notifyAdded). Hashing the full
            // tuple here would only match by the coincidence that the tuple's
            // labels equal `resultSubset`.
            const tupleHash = computeTupleSubsetHash(pr.tuple, resultSubset);
            
            for (const component of projection.components) {
                if (component.type === "specification") {
                    const path = parentPath + "." + component.name;
                    Trace.info(`[Observer] INJECT_OBSERVER - Parent path: ${displayPath}, Component: ${component.name}, Full path: ${path}, Tuple hash: ${tupleHash.substring(0, 8)}...`);
                    
                    const observable: ObservableCollection<any> = {
                        onAdded: async (handler: ResultAddedFunc<any>) => {
                            this.addedHandlers.push({
                                tupleHash: tupleHash,
                                path: path,
                                handler: handler,
                                ownerChain: ownerChain
                            });
                            Trace.info(`[Observer] HANDLER REGISTERED - Path: ${path}, Tuple hash: ${tupleHash.substring(0, 8)}..., Total handlers: ${this.addedHandlers.length}`);

                            // Replay any buffered notifications now that the handler exists.
                            const key = `${path}|${tupleHash}`;
                            const pending = this.pendingAddsByKey.get(key);
                            if (pending) {
                                this.pendingAddsByKey.delete(key);
                                
                                // Track this replay as a pending notification
                                const replayWork = async () => {
                                    try {
                                        await this.notifyAdded(pending.results, pending.projection, path, pending.parentSubset, pending.resultSubset, pending.branch);
                                    } catch (error) {
                                        Trace.error(`[Observer] ERROR in buffered replay - Path: ${path}, Error: ${error}`);
                                    }
                                };
                                
                                const replayPromise = replayWork().finally(() => {
                                    this.pendingNotifications.delete(replayPromise);
                                });
                                
                                this.pendingNotifications.add(replayPromise);
                                await replayPromise;
                            }
                        }
                    }
                    composite[component.name] = observable;
                }
                else {
                    composite[component.name] = pr.result[component.name];
                }
            }
            return composite;
        }
        else {
            return pr.result;
        }
    }
}
