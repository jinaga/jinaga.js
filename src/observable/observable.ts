import { describeSpecification } from '../specification/description';
import { Specification } from "../specification/specification";
import { FactEnvelope, FactRecord, ProjectedResult, Storage } from '../storage';
import { computeStringHash } from '../util/encoding';
import { TIMED_OUT, withTimeout } from '../util/promise';
import { Trace } from '../util/trace';

export interface SpecificationListener {
    onResult(results: ProjectedResult[]): Promise<void>;
}

/**
 * Ceiling on a single listener's `onResult`, in milliseconds. Deliberately
 * generous: it must never fire for a healthy handler, only for a wedged one.
 */
export const DEFAULT_LISTENER_TIMEOUT_MS = 30000;

export interface ObservableSourceOptions {
    /**
     * Maximum time to wait for one listener's `onResult` to settle before
     * abandoning the wait and continuing without it. A callback that never
     * settles would otherwise block the save that triggered the notification,
     * and every query behind it, forever (issue #246). Set to 0 to wait
     * indefinitely, which is the behavior prior to that fix. Defaults to
     * `DEFAULT_LISTENER_TIMEOUT_MS`.
     */
    listenerTimeoutMs?: number;
}

export class ObservableSource {
    private listenersByTypeAndSpecification: Map<string, Map<string, {
        specification: Specification,
        listeners: SpecificationListener[]
    }>> = new Map();
    private readonly listenerTimeoutMs: number;
    private notificationDepth = 0;
    private listenerDispatchDepth = 0;

    constructor(private store: Storage, options: ObservableSourceOptions = {}) {
        this.listenerTimeoutMs = options.listenerTimeoutMs ?? DEFAULT_LISTENER_TIMEOUT_MS;
    }

    async notify(saved: FactEnvelope[]): Promise<void> {
        if (this.notificationDepth > 0) {
            // A notification began while another is still in flight. Usually
            // this is benign concurrency, such as two feeds delivering at once.
            // It is also the signature of re-entrancy: a listener that saved or
            // queried facts and came back through this path from inside its own
            // notification. The two are indistinguishable here without async
            // context propagation, which the browser target rules out, so warn
            // and continue rather than throwing on a pattern that works today.
            Trace.counter("observable_notify_overlapped", 1);
            Trace.warn(`[ObservableSource] OVERLAPPING NOTIFY - Depth on entry: ${this.notificationDepth}, Envelopes: ${saved.length}. If a listener callback writes or queries facts, this notification is re-entrant and may block against an in-flight feed; the listener timeout (${this.listenerTimeoutMs}ms) bounds the stall.`);
        }
        this.notificationDepth++;
        try {
            // KNOWN GAP: `saved` arrives in topological order — Dehydration
            // pushes a fact's predecessors before the fact itself, and both
            // stores preserve input order — and this line discards it. That is
            // the one causal edge the model states explicitly and this dispatch
            // does not honor. `ObserverImpl.pendingAddsByKey` is the standing
            // compensation: a child row whose parent has not been delivered
            // buffers and replays when the parent's onAdded registers.
            // Tracked separately; do not treat this fan-out as evidence that
            // predecessor order is unimportant.
            //
            // Every fact's notification is awaited to a conclusion, but a
            // conclusion is not the same as completion: a listener either
            // finishes, fails, or is abandoned once it exceeds
            // `listenerTimeoutMs`. So `notify()` resolving does NOT imply that
            // every listener ran to completion, and neither does the `save()`
            // above it. Bounding that wait is the point of issue #246.
            await Promise.all(saved.map(envelope => this.notifyFactSaved(envelope.fact)));
        }
        finally {
            this.notificationDepth--;
        }
    }

    /**
     * True while at least one listener callback is executing. Lets the network
     * layer recognize a feed whose load is parked behind a listener that may be
     * this very caller, so it does not wait on a promise that cannot make
     * progress until the callback returns (issue #246).
     *
     * This is narrower than "a notify turn is open" — it excludes the store
     * reads `notifyFactSaved` performs between spec groups — but it is still
     * not caller-scoped: it cannot distinguish "this call came from inside a
     * listener" from "some unrelated listener happens to be running". Precise
     * attribution needs async context propagation, which the browser target
     * rules out. See `NetworkManager.joinWouldAwaitARunningListener` for what
     * the remaining imprecision costs.
     */
    public isDispatchingListener(): boolean {
        return this.listenerDispatchDepth > 0;
    }

    public addSpecificationListener(specification: Specification, onResult: (results: ProjectedResult[]) => Promise<void>): SpecificationListener {
        if (specification.given.length !== 1) {
            throw new Error("Specification must have exactly one given fact");
        }
        const givenType = specification.given[0].label.type;
        const givenName = specification.given[0].label.name;
        const specificationKey = computeStringHash(describeSpecification(specification, 0));
        const hasNestedSpecs = specification.projection.type === "composite" &&
            specification.projection.components.some(c => c.type === "specification");

        Trace.info(`[ObservableSource] ADD_LISTENER REQUEST - Type: ${givenType}, Name: ${givenName}, Spec key: ${specificationKey.substring(0, 8)}..., Has nested specs: ${hasNestedSpecs}`);

        let listenersBySpecification = this.listenersByTypeAndSpecification.get(givenType);
        if (!listenersBySpecification) {
            listenersBySpecification = new Map();
            this.listenersByTypeAndSpecification.set(givenType, listenersBySpecification);
            Trace.info(`[ObservableSource] Created new listener map for type: ${givenType}`);
        }

        let listeners = listenersBySpecification.get(specificationKey);
        if (!listeners) {
            listeners = {
                specification,
                listeners: []
            };
            listenersBySpecification.set(specificationKey, listeners);
            Trace.info(`[ObservableSource] Created new listener group for spec: ${specificationKey.substring(0, 8)}... (type: ${givenType})`);
        }

        const specificationListener = {
            onResult
        };
        listeners.listeners.push(specificationListener);
        
        const listenerCount = listeners.listeners.length;
        const totalListeners = Array.from(this.listenersByTypeAndSpecification.values())
            .reduce((total, map) => total + Array.from(map.values()).reduce((sum, l) => sum + l.listeners.length, 0), 0);
        
        Trace.info(`[ObservableSource] LISTENER ADDED - Spec: ${specificationKey.substring(0, 8)}..., Type: ${givenType}, Count for spec: ${listenerCount}, Total listeners: ${totalListeners}, Nested specs: ${hasNestedSpecs}`);
        
        return specificationListener;
    }

    public removeSpecificationListener(specificationListener: SpecificationListener) {
        const startTime = Date.now();
        let found = false;
        let removedFromSpec = '';
        let removedFromType = '';
        
        for (const [givenType, listenersBySpecification] of this.listenersByTypeAndSpecification) {
            for (const [specificationKey, listeners] of listenersBySpecification) {
                const beforeCount = listeners.listeners.length;
                const index = listeners.listeners.indexOf(specificationListener);
                if (index >= 0) {
                    Trace.info(`[ObservableSource] REMOVING listener - Spec: ${specificationKey.substring(0, 8)}..., Type: ${givenType}, Index: ${index}, Before count: ${beforeCount}`);
                    
                    listeners.listeners.splice(index, 1);
                    found = true;
                    removedFromSpec = specificationKey;
                    removedFromType = givenType;
                    
                    const afterCount = listeners.listeners.length;
                    Trace.info(`[ObservableSource] REMOVED listener - After count: ${afterCount}`);

                    if (listeners.listeners.length === 0) {
                        listenersBySpecification.delete(specificationKey);
                        Trace.info(`[ObservableSource] Deleted empty spec group: ${specificationKey.substring(0, 8)}...`);

                        if (listenersBySpecification.size === 0) {
                            this.listenersByTypeAndSpecification.delete(givenType);
                            Trace.info(`[ObservableSource] Deleted empty type group: ${givenType}`);
                        }
                    }
                    break;
                }
            }
            if (found) break;
        }
        
        const totalListeners = Array.from(this.listenersByTypeAndSpecification.values())
            .reduce((total, map) => total + Array.from(map.values()).reduce((sum, l) => sum + l.listeners.length, 0), 0);
        
        const duration = Date.now() - startTime;
        if (found) {
            Trace.info(`[ObservableSource] Listener removal completed - Spec: ${removedFromSpec.substring(0, 8)}..., Type: ${removedFromType}, Total remaining: ${totalListeners}, Duration: ${duration}ms`);
        } else {
            Trace.warn(`[ObservableSource] Listener NOT FOUND during removal - Total listeners: ${totalListeners}, Duration: ${duration}ms`);
        }
    }

    private async notifyFactSaved(fact: FactRecord) {
        const startTime = Date.now();
        const listenersBySpecification = this.listenersByTypeAndSpecification.get(fact.type);
        
        if (listenersBySpecification) {
            Trace.info(`[ObservableSource] NOTIFY START - Fact type: ${fact.type}, Hash: ${fact.hash.substring(0, 8)}..., Spec groups: ${listenersBySpecification.size}`);
            
            let totalNotifications = 0;
            let specCount = 0;
            let nestedSpecCount = 0;
            
            for (const [specificationKey, listeners] of listenersBySpecification) {
                specCount++;
                if (listeners && listeners.listeners.length > 0) {
                    const listenerCount = listeners.listeners.length;
                    const specification = listeners.specification;
                    const hasNestedSpecs = specification.projection.type === "composite" &&
                        specification.projection.components.some(c => c.type === "specification");
                    
                    if (hasNestedSpecs) {
                        nestedSpecCount++;
                        const nestedSpecNames = specification.projection.type === "composite"
                            ? specification.projection.components
                                .filter(c => c.type === "specification")
                                .map(c => c.name)
                                .join(', ')
                            : '';
                        Trace.info(`[ObservableSource] NESTED SPEC DETECTED - Spec ${specCount}/${listenersBySpecification.size}, Key: ${specificationKey.substring(0, 8)}..., Nested components: [${nestedSpecNames}], Listeners: ${listenerCount}`);
                    } else {
                        Trace.info(`[ObservableSource] Processing spec ${specCount}/${listenersBySpecification.size} - Key: ${specificationKey.substring(0, 8)}..., Listeners: ${listenerCount}`);
                    }
                    
                    const givenReference = {
                        type: fact.type,
                        hash: fact.hash
                    };
                    
                    const readStart = Date.now();
                    const results = await this.store.read([givenReference], specification);
                    const readDuration = Date.now() - readStart;
                    
                    if (hasNestedSpecs) {
                        Trace.info(`[ObservableSource] Store read for NESTED spec - Results: ${results.length}, Duration: ${readDuration}ms`);
                        // Log nested result structure if present
                        if (results.length > 0 && specification.projection.type === "composite") {
                            const nestedResults = specification.projection.components
                                .filter(c => c.type === "specification")
                                .map(c => `${c.name}: ${results[0].result[c.name]?.length || 0}`)
                                .join(', ');
                            Trace.info(`[ObservableSource] Nested results structure: {${nestedResults}}`);
                        }
                    } else {
                        Trace.info(`[ObservableSource] Store read completed - Results: ${results.length}, Duration: ${readDuration}ms`);
                    }
                    
                    // Create a snapshot of listeners to avoid modification during iteration
                    const listenerSnapshot = [...listeners.listeners];

                    // Concurrent by derivation, not by preference. The model
                    // records causality explicitly — a fact names its
                    // predecessors — and it delivers specification results as
                    // SETS precisely to say that no such relation holds among
                    // them. The listeners in this group are independent
                    // subscriptions to one specification, so the model records
                    // no edge between them and dispatch order is not ours to
                    // define. Do not reintroduce a mode toggle here: offering
                    // "serial" would promise an ordering the model refuses to
                    // make, and a consumer that came to depend on it would be
                    // depending on an accident.
                    //
                    // Sequencing belongs only where an edge exists: predecessor
                    // before successor, and a parent row before its child rows
                    // (see the await in ObserverImpl.notifyAddedRow).
                    //
                    // notifyListener never rejects, so one listener can neither
                    // leave a sibling rejection unhandled nor short-circuit the
                    // others.
                    const outcomes = await Promise.all(listenerSnapshot.map((specificationListener, i) =>
                        this.notifyListener(specificationListener, results, i, listenerSnapshot.length, specificationKey, fact.type, hasNestedSpecs)));
                    totalNotifications += outcomes.filter(completed => completed).length;
                } else {
                    Trace.info(`[ObservableSource] Skipping spec ${specCount}/${listenersBySpecification.size} - No listeners or null group`);
                }
            }
            
            const totalDuration = Date.now() - startTime;
            Trace.info(`[ObservableSource] NOTIFY COMPLETE - Fact: ${fact.hash.substring(0, 8)}..., Type: ${fact.type}, Specs processed: ${specCount} (${nestedSpecCount} nested), Total notifications: ${totalNotifications}, Duration: ${totalDuration}ms`);
        } else {
            Trace.info(`[ObservableSource] No listeners for fact type: ${fact.type} - Available types: [${Array.from(this.listenersByTypeAndSpecification.keys()).join(', ')}]`);
        }
    }

    /**
     * Dispatch one listener, bounding how long we wait for it. Never rejects:
     * a listener that throws, or one that never settles, is reported and
     * stepped over so it cannot hold the save that triggered this notification
     * (issue #246). Returns whether the listener actually completed.
     */
    private async notifyListener(
        specificationListener: SpecificationListener,
        results: ProjectedResult[],
        index: number,
        count: number,
        specificationKey: string,
        givenType: string,
        hasNestedSpecs: boolean
    ): Promise<boolean> {
        const label = `${index + 1}/${count}`;
        const notifyStart = Date.now();
        Trace.info(`[ObservableSource] Calling listener ${label} - Nested: ${hasNestedSpecs}`);
        Trace.counter("observable_listener_started", 1);
        this.listenerDispatchDepth++;
        try {
            const outcome = await withTimeout(
                specificationListener.onResult(results),
                this.listenerTimeoutMs,
                late => {
                    Trace.counter("observable_listener_late_settled", 1);
                    if ("error" in late) {
                        Trace.error(`[ObservableSource] Abandoned listener ${label} rejected after ${late.elapsedMs}ms - Spec: ${specificationKey.substring(0, 8)}..., Type: ${givenType}, Error: ${late.error}`);
                    } else {
                        Trace.warn(`[ObservableSource] Abandoned listener ${label} finally completed after ${late.elapsedMs}ms - Spec: ${specificationKey.substring(0, 8)}..., Type: ${givenType}`);
                    }
                });
            const notifyDuration = Date.now() - notifyStart;

            if (outcome === TIMED_OUT) {
                Trace.counter("observable_listener_timed_out", 1);
                Trace.warn(`[ObservableSource] LISTENER TIMEOUT - Listener ${label} did not settle within ${this.listenerTimeoutMs}ms; abandoning the wait so the save can complete. Spec: ${specificationKey.substring(0, 8)}..., Type: ${givenType}, Nested: ${hasNestedSpecs}`);
                Trace.metric("observable_listener_timeout", {
                    durationMs: notifyDuration,
                    listenerIndex: index,
                    listenerCount: count
                });
                return false;
            }

            Trace.counter("observable_listener_completed", 1);
            if (notifyDuration > 100) {
                Trace.warn(`[ObservableSource] SLOW notification - Listener ${label}, Duration: ${notifyDuration}ms, Nested: ${hasNestedSpecs}`);
            } else {
                Trace.info(`[ObservableSource] Listener completed - ${label}, Duration: ${notifyDuration}ms`);
            }
            return true;
        }
        catch (error) {
            Trace.counter("observable_listener_failed", 1);
            Trace.error(`[ObservableSource] ERROR in listener notification - Listener ${label}, Nested: ${hasNestedSpecs}, Error: ${error}`);
            return false;
        }
        finally {
            this.listenerDispatchDepth--;
        }
    }
}
