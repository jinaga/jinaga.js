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
    stop(): void;
}

export class ObserverImpl<T> implements Observer<T> {
    private givenHash: string;
    private cachedPromise: Promise<boolean> | undefined;
    private loadedPromise: Promise<void> | undefined;
    private listeners: SpecificationListener[] = [];
    private removalsByTuple: {
        [tupleHash: string]: () => Promise<void>;
    } = {};
    private notifiedTuples = new Set<string>();
    private addedHandlers: {
        tupleHash: string;
        path: string;
        handler: ResultAddedFunc<any>;
    }[] = [];
    private specificationHash: string;
    private feeds: string[] = [];
    private stopped: boolean = false;
    private listenersAdded: boolean = false;
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
     *   - `results`: The buffered results (of type `ProjectedResult[]`) to be replayed to handlers when they are registered.
     * 
     * This map is used to buffer results that are produced before any handlers are registered,
     * enabling replay of results to late-registered handlers.
     */
    private pendingAddsByKey: Map<string, { projection: Projection; parentSubset: string[]; results: ProjectedResult[] }>
        = new Map();

    constructor(
        private factManager: FactManager,
        private given: FactReference[],
        private specification: Specification,
        resultAdded: ResultAddedFunc<T>
    ) {
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
                try {
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
                        loadResolve();
                    }
                    await this.factManager.setMruDate(this.specificationHash, new Date());
                    Trace.info(`[Observer] COMPLETE - Spec hash: ${this.specificationHash.substring(0, 8)}...`);
                }
                catch (e) {
                    Trace.error(`[Observer] ERROR - Spec hash: ${this.specificationHash.substring(0, 8)}..., Error: ${e}`);
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
        Trace.info(`[Observer] ADDING LISTENERS - Spec hash: ${this.specificationHash.substring(0, 8)}..., Given hash: ${this.givenHash.substring(0, 8)}...`);
        
        const inverses = invertSpecification(this.specification);
        Trace.info(`[Observer] Generated ${inverses.length} inverse specifications`);
        
        inverses.forEach((inverse, index) => {
            const givenType = inverse.inverseSpecification.given[0].label.type;
            const path = inverse.path || "(root)";
            const operation = inverse.operation;
            Trace.info(`[Observer] Inverse ${index + 1}/${inverses.length} - Path: ${path}, Operation: ${operation}, Given type: ${givenType}, Given subset: [${inverse.givenSubset.join(', ')}], Parent subset: [${inverse.parentSubset.join(', ')}]`);
        });
        
        const listeners = inverses.map((inverse, index) => {
            const listener = this.factManager.addSpecificationListener(
                inverse.inverseSpecification,
                (results) => this.onResult(inverse, results)
            );
            const path = inverse.path || "(root)";
            Trace.info(`[Observer] Registered listener ${index + 1}/${inverses.length} for path: ${path}`);
            return listener;
        });
        
        this.listeners = listeners;
        Trace.info(`[Observer] LISTENERS REGISTERED - Total: ${this.listeners.length}, Spec hash: ${this.specificationHash.substring(0, 8)}...`);
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

    public stop() {
        this.stopped = true;
        for (const listener of this.listeners) {
            this.factManager.removeSpecificationListener(listener);
        }
        if (this.feeds.length > 0) {
            this.factManager.unsubscribe(this.feeds);
        }
    }

    private async fetch(keepAlive: boolean) {
        if (keepAlive) {
            this.feeds = await this.factManager.subscribe(this.given, this.specification);
        }
        else {
            await this.factManager.fetch(this.given, this.specification);
        }
    }

    private async read() {
        const projectedResults = await this.factManager.read(this.given, this.specification);
        if (this.stopped) {
            // The observer was stopped before the read completed.
            return;
        }
        const givenSubset = this.specification.given.map(g => g.label.name);
        await this.notifyAdded(projectedResults, this.specification.projection, "", givenSubset);
    }

    private async onResult(inverse: SpecificationInverse, results: ProjectedResult[]): Promise<void> {
        const path = inverse.path || "(root)";
        Trace.info(`[Observer] ON_RESULT - Path: ${path}, Operation: ${inverse.operation}, Results count: ${results.length}, Given hash: ${this.givenHash.substring(0, 8)}...`);
        
        // Filter out results that do not match the given.
        const matchingResults = results.filter(pr =>
            this.givenHash === computeTupleSubsetHash(pr.tuple, inverse.givenSubset));
        
        if (matchingResults.length === 0) {
            Trace.info(`[Observer] No matching results after filtering - Path: ${path}, Given subset: [${inverse.givenSubset.join(', ')}]`);
            return;
        }
        
        Trace.info(`[Observer] Matching results: ${matchingResults.length} - Path: ${path}, Operation: ${inverse.operation}`);

        if (inverse.operation === "add") {
            return await this.notifyAdded(matchingResults, inverse.inverseSpecification.projection, inverse.path, inverse.parentSubset);
        }
        else if (inverse.operation === "remove") {
            return await this.notifyRemoved(inverse.resultSubset, matchingResults);
        }
        else {
            const _exhaustiveCheck: never = inverse.operation;
            throw new Error(`Inverse operation ${_exhaustiveCheck} not implemented.`);
        }
    }

    private async notifyAdded(projectedResults: ProjectedResult[], projection: Projection, path: string, parentSubset: string[]) {
        const displayPath = path || "(root)";
        Trace.info(`[Observer] NOTIFY_ADDED - Path: ${displayPath}, Results: ${projectedResults.length}, Parent subset: [${parentSubset.join(', ')}]`);
        
        for (const pr of projectedResults) {
            const result: any = await this.injectObservers(pr, projection, path);
            const parentTupleHash = computeTupleSubsetHash(pr.tuple, parentSubset);
            const tupleHash = computeObjectHash(pr.tuple);
            
            Trace.info(`[Observer] Processing result - Path: ${displayPath}, Tuple hash: ${tupleHash.substring(0, 8)}..., Parent tuple hash: ${parentTupleHash.substring(0, 8)}...`);
            
            const addedHandler = this.addedHandlers.find(h => h.tupleHash === parentTupleHash && h.path === path);
            const resultAdded = addedHandler?.handler;
            
            if (!addedHandler) {
                Trace.warn(`[Observer] NO HANDLER FOUND - Path: ${displayPath}, Parent tuple hash: ${parentTupleHash.substring(0, 8)}..., Available handlers: ${this.addedHandlers.length}`);
                this.addedHandlers.forEach((h, index) => {
                    Trace.warn(`[Observer]   Handler ${index + 1}: Path="${h.path}", Tuple hash: ${h.tupleHash.substring(0, 8)}...`);
                });
                // Buffer for replay when the handler registers later.
                this.bufferPendingNotification(path, pr, projection, parentSubset);
                // Skip deeper recursion until handler is registered.
                continue;
            } else if (!resultAdded) {
                Trace.warn(`[Observer] Handler found but no callback - Path: ${displayPath}`);
                // Buffer for replay when the callback is attached.
                this.bufferPendingNotification(path, pr, projection, parentSubset);
                continue;
            } else {
                Trace.info(`[Observer] Handler found - Path: ${displayPath}`);
            }
            
            // Don't call result added if we have already called it for this tuple.
            if (this.notifiedTuples.has(tupleHash) === false) {
                // Check if observer was stopped before calling the handler
                if (this.stopped) {
                    Trace.info(`[Observer] SKIPPING HANDLER - Observer stopped, Path: ${displayPath}, Tuple hash: ${tupleHash.substring(0, 8)}...`);
                    continue;
                }
                Trace.info(`[Observer] CALLING HANDLER - Path: ${displayPath}, Tuple hash: ${tupleHash.substring(0, 8)}...`);
                const promiseMaybe = resultAdded(result);
                this.notifiedTuples.add(tupleHash);
                if (promiseMaybe instanceof Promise) {
                    const functionMaybe = await promiseMaybe;
                    if (functionMaybe instanceof Function) {
                        this.removalsByTuple[tupleHash] = functionMaybe;
                    }
                }
                else {
                    const functionMaybe = promiseMaybe;
                    if (functionMaybe instanceof Function) {
                        this.removalsByTuple[tupleHash] = async () => {
                            functionMaybe();
                            return Promise.resolve();
                        };
                    }
                }
            } else if (this.notifiedTuples.has(tupleHash)) {
                Trace.info(`[Observer] Skipping already notified tuple - Path: ${displayPath}, Tuple hash: ${tupleHash.substring(0, 8)}...`);
            }

            // Recursively notify added for specification results.
            if (projection.type === "composite") {
                for (const component of projection.components) {
                    if (component.type === "specification") {
                        const childPath = path + "." + component.name;
                        const childResults = pr.result[component.name];
                        Trace.info(`[Observer] Processing nested spec - Parent path: ${displayPath}, Child path: ${childPath}, Child results: ${childResults?.length || 0}`);
                        await this.notifyAdded(childResults, component.projection, childPath, Object.keys(pr.tuple));
                    }
                }
            }
        }
    }

    async notifyRemoved(resultSubset: string[], projectedResult: ProjectedResult[]): Promise<void> {
        for (const pr of projectedResult) {
            const resultTupleHash = computeTupleSubsetHash(pr.tuple, resultSubset);
            const removal = this.removalsByTuple[resultTupleHash];
            if (removal !== undefined) {
                await removal();
                delete this.removalsByTuple[resultTupleHash];

                // After the tuple is removed, it can be re-added.
                this.notifiedTuples.delete(resultTupleHash);
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
    private bufferPendingNotification(path: string, pr: ProjectedResult, projection: Projection, parentSubset: string[]): void {
        const parentTupleHash = computeTupleSubsetHash(pr.tuple, parentSubset);
        const key = `${path}|${parentTupleHash}`;
        const existing = this.pendingAddsByKey.get(key);
        if (existing) {
            existing.results.push(pr);
        }
        else {
            this.pendingAddsByKey.set(key, { projection, parentSubset, results: [pr] });
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
                                try {
                                    await this.notifyAdded(pending.results, pending.projection, path, pending.parentSubset);
                                } catch (error) {
                                    Trace.error(`[Observer] ERROR in buffered replay - Path: ${path}, Error: ${error}`);
                                }
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
