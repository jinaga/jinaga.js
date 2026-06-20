import { computeObjectHash } from "../fact/hash";
import { FactManager } from "../managers/factManager";
import { SpecificationListener } from "../observable/observable";
import { describeDeclaration, describeSpecification } from "../specification/description";
import { SpecificationInverse, invertSpecification } from "../specification/inverse";
import { Projection, Specification } from "../specification/specification";
import { FactReference, ProjectedResult, ReferencesByName, computeTupleSubsetHash } from "../storage";
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
     */
    processed(): Promise<void>;
    stop(): void;
}

interface ObserverBranch {
    specification: Specification;
    feeds: string[];
    listeners: SpecificationListener[];
    /**
     * Labels of this branch's spec (givens + match unknowns). Used to
     * compute a stable "vote id" for per-row ref counting: the same
     * (row, auth path) tuple from this branch's ADD inverse and its
     * REMOVE inverse hash to the same id because both bind the same set
     * of labels (the inverse's "from" fact differs but the resolved
     * spec labels match in shape and value).
     */
    voteLabels: string[];
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
    private addedHandlers: {
        tupleHash: string;
        path: string;
        handler: ResultAddedFunc<any>;
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
     * Tracks all pending notification promises to enable waiting for processing completion.
     */
    private pendingNotifications: Set<Promise<void>> = new Set();
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

    constructor(
        private factManager: FactManager,
        private given: FactReference[],
        specification: Specification,
        resultAdded: ResultAddedFunc<T>
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
        this.branches = [{
            specification,
            feeds: [],
            listeners: [],
            voteLabels: [...this.rowIdentityLabels]
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
            handler: resultAdded
        });

        // Identify the specification by its hash.
        const declarationString = describeDeclaration(given, specification.given.map(g => g.label));
        const specificationString = describeSpecification(specification, 0);
        const request = `${declarationString}\n${specificationString}`;
        this.specificationHash = computeStringHash(request);
    }

    public start(keepAlive: boolean) {
        const givenTypes = this.given.map(g => g.type).join(', ');
        Trace.info(`[Observer] START - Spec hash: ${this.specificationHash.substring(0, 8)}..., Given hash: ${this.givenHash.substring(0, 8)}..., Given types: [${givenTypes}], KeepAlive: ${keepAlive}`);

        this.cachedPromise = new Promise((cacheResolve, _) => {
            this.loadedPromise = new Promise(async (loadResolve, loadReject) => {
                this.loadResolve = loadResolve;
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
                        loadResolve();
                    }
                    else {
                        Trace.info(`[Observer] Cached (MRU: ${mruDate.toISOString()}) - Spec hash: ${this.specificationHash.substring(0, 8)}..., will read then fetch`);
                        // Read from local storage into the cache.
                        await this.read();
                        cacheResolve(true);
                        // Then fetch from the server to update the cache.
                        await this.fetch(keepAlive);
                        if (this.stopped) return;
                        loadResolve();
                    }
                    await this.factManager.setMruDate(this.specificationHash, new Date());
                    Trace.info(`[Observer] COMPLETE - Spec hash: ${this.specificationHash.substring(0, 8)}...`);
                    this.loadResolve = undefined;
                }
                catch (e) {
                    Trace.error(`[Observer] ERROR - Spec hash: ${this.specificationHash.substring(0, 8)}..., Error: ${e}`);
                    this.loadResolve = undefined;
                    cacheResolve(false);
                    loadReject(e);
                }
            });
        });
    }

    private addSpecificationListeners() {
        if (this.listenersAdded) {
            return;
        }
        Trace.info(`[Observer] ADDING LISTENERS - Spec hash: ${this.specificationHash.substring(0, 8)}..., Given hash: ${this.givenHash.substring(0, 8)}..., Branches: ${this.branches.length}`);

        for (let branchIndex = 0; branchIndex < this.branches.length; branchIndex++) {
            const branch = this.branches[branchIndex];
            const inverses = invertSpecification(branch.specification);
            Trace.info(`[Observer] Branch ${branchIndex} produced ${inverses.length} inverse specifications`);

            inverses.forEach((inverse, index) => {
                const givenType = inverse.inverseSpecification.given[0].label.type;
                const path = inverse.path || "(root)";
                const operation = inverse.operation;
                Trace.info(`[Observer] Branch ${branchIndex} Inverse ${index + 1}/${inverses.length} - Path: ${path}, Operation: ${operation}, Given type: ${givenType}, Given subset: [${inverse.givenSubset.join(', ')}], Parent subset: [${inverse.parentSubset.join(', ')}]`);
            });

            branch.listeners = inverses.map((inverse, index) => {
                const listener = this.factManager.addSpecificationListener(
                    inverse.inverseSpecification,
                    (results) => this.onResult(inverse, results, branch)
                );
                const path = inverse.path || "(root)";
                Trace.info(`[Observer] Branch ${branchIndex} registered listener ${index + 1}/${inverses.length} for path: ${path}`);
                return listener;
            });
        }
        const totalListeners = this.branches.reduce((sum, b) => sum + b.listeners.length, 0);
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

    public stop() {
        this.stopped = true;
        for (const branch of this.branches) {
            for (const listener of branch.listeners) {
                this.factManager.removeSpecificationListener(listener);
            }
            if (branch.feeds.length > 0) {
                this.factManager.unsubscribe(branch.feeds);
                branch.feeds = [];
            }
        }
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
        this.branches = branches.map(b => ({
            specification: b.specification,
            feeds: [],
            listeners: [],
            // Vote labels are the branch's spec labels — broader than the
            // shared row-identity labels because each branch's auth path
            // contributes alpha-renamed unknowns (dist_admin, dist_user,
            // distributionUser, ...). Two distinct auth paths through the
            // same branch produce different vote ids; identical paths
            // collide and ref-count as one.
            voteLabels: [
                ...b.specification.given.map(g => g.label.name),
                ...b.specification.matches.map(m => m.unknown.name)
            ]
        }));
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
        if (keepAlive) {
            await Promise.all(this.branches.map(async branch => {
                const feeds = await this.factManager.subscribe(this.given, branch.specification);
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
            }));
        }
        else {
            await Promise.all(this.branches.map(branch =>
                this.factManager.fetch(this.given, branch.specification)));
        }
    }

    private async read() {
        // Read every branch's spec. Each branch produces an independently
        // filtered result set (different intersected auth conditions); the
        // dedup at `notifyAdded` ensures each row surfaces only once.
        const branchResults = await Promise.all(this.branches.map(async branch => ({
            branch,
            projected: await this.factManager.read(this.given, branch.specification)
        })));
        if (this.stopped) {
            // The observer was stopped before the read completed.
            return;
        }
        for (const { branch, projected } of branchResults) {
            const givenSubset = branch.specification.given.map(g => g.label.name);
            const resultSubset = [...givenSubset, ...branch.specification.matches.map(m => m.unknown.name)];
            await this.notifyAdded(projected, branch.specification.projection, "", givenSubset, resultSubset, branch);
        }
    }

    private async onResult(inverse: SpecificationInverse, results: ProjectedResult[], branch: ObserverBranch): Promise<void> {
        const path = inverse.path || "(root)";
        Trace.info(`[Observer] ON_RESULT - Path: ${path}, Operation: ${inverse.operation}, Results count: ${results.length}, Given hash: ${this.givenHash.substring(0, 8)}...`);
        
        // Track this notification for processing completion
        const processNotification = async () => {
            // Filter out results that do not match the given.
            const matchingResults = results.filter(pr =>
                this.givenHash === computeTupleSubsetHash(pr.tuple, inverse.givenSubset));
            
            if (matchingResults.length === 0) {
                Trace.info(`[Observer] No matching results after filtering - Path: ${path}, Given subset: [${inverse.givenSubset.join(', ')}]`);
                return;
            }
            
            Trace.info(`[Observer] Matching results: ${matchingResults.length} - Path: ${path}, Operation: ${inverse.operation}`);

            if (inverse.operation === "add") {
                return await this.notifyAdded(matchingResults, inverse.inverseSpecification.projection, inverse.path, inverse.parentSubset, inverse.resultSubset, branch);
            }
            else if (inverse.operation === "remove") {
                return await this.notifyRemoved(inverse, matchingResults, branch);
            }
            else {
                const _exhaustiveCheck: never = inverse.operation;
                throw new Error(`Inverse operation ${_exhaustiveCheck} not implemented.`);
            }
        };
        
        const notificationPromise = processNotification().finally(() => {
            // Remove from pending notifications when complete
            this.pendingNotifications.delete(notificationPromise);
        });
        
        this.pendingNotifications.add(notificationPromise);
        await notificationPromise;
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

    private async notifyAdded(projectedResults: ProjectedResult[], projection: Projection, path: string, parentSubset: string[], resultSubset: string[], branch: ObserverBranch) {
        const displayPath = path || "(root)";
        Trace.info(`[Observer] NOTIFY_ADDED - Path: ${displayPath}, Results: ${projectedResults.length}, Parent subset: [${parentSubset.join(', ')}]`);

        for (const pr of projectedResults) {
            const result: any = await this.injectObservers(pr, projection, path);
            const parentTupleHash = computeTupleSubsetHash(pr.tuple, parentSubset);
            const { rowHash, voteId } = this.rowAndVoteHashes(pr.tuple, path, branch, resultSubset);

            Trace.info(`[Observer] Processing result - Path: ${displayPath}, Row hash: ${rowHash.substring(0, 8)}..., Vote id: ${voteId.substring(0, 8)}..., Parent tuple hash: ${parentTupleHash.substring(0, 8)}...`);

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
                continue;
            } else if (!resultAdded) {
                Trace.warn(`[Observer] Handler found but no callback - Path: ${displayPath}`);
                // Buffer for replay when the callback is attached.
                this.bufferPendingNotification(path, pr, projection, parentSubset, resultSubset, branch);
                continue;
            } else {
                Trace.info(`[Observer] Handler found - Path: ${displayPath}`);
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
                    continue;
                }
                Trace.info(`[Observer] CALLING HANDLER - Path: ${displayPath}, Row hash: ${rowHash.substring(0, 8)}...`);
                const promiseMaybe = resultAdded(result);
                if (promiseMaybe instanceof Promise) {
                    const functionMaybe = await promiseMaybe;
                    if (functionMaybe instanceof Function) {
                        this.removalsByRow.set(rowHash, functionMaybe);
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

            // Recursively notify added for specification results.
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
                        Trace.info(`[Observer] Processing nested spec - Parent path: ${displayPath}, Child path: ${childPath}, Child results: ${childResults?.length || 0}`);
                        await this.notifyAdded(childResults, component.projection, childPath, Object.keys(pr.tuple), childResultSubset, branch);
                    }
                }
            }
        }
    }

    async notifyRemoved(inverse: SpecificationInverse, projectedResult: ProjectedResult[], branch: ObserverBranch): Promise<void> {
        for (const pr of projectedResult) {
            const { rowHash, voteId } = this.rowAndVoteHashes(pr.tuple, inverse.path, branch, inverse.resultSubset);
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
            if (removal !== undefined) {
                Trace.info(`[Observer] NOTIFY_REMOVED - Row hash: ${rowHash.substring(0, 8)}..., Last vote withdrawn, firing removal`);
                await removal();
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

    private async injectObservers(pr: ProjectedResult, projection: Projection, parentPath: string): Promise<any> {
        const displayPath = parentPath || "(root)";
        
        if (projection.type === "composite") {
            const composite: any = {};
            const tupleHash = computeObjectHash(pr.tuple);
            
            for (const component of projection.components) {
                if (component.type === "specification") {
                    const path = parentPath + "." + component.name;
                    Trace.info(`[Observer] INJECT_OBSERVER - Parent path: ${displayPath}, Component: ${component.name}, Full path: ${path}, Tuple hash: ${tupleHash.substring(0, 8)}...`);
                    
                    const observable: ObservableCollection<any> = {
                        onAdded: async (handler: ResultAddedFunc<any>) => {
                            this.addedHandlers.push({
                                tupleHash: tupleHash,
                                path: path,
                                handler: handler
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
