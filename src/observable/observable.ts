import { describeSpecification } from '../specification/description';
import { Specification } from "../specification/specification";
import { FactEnvelope, FactRecord, FactReference, ProjectedResult, Storage } from '../storage';
import { computeStringHash } from '../util/encoding';
import { TIMED_OUT, withTimeout } from '../util/promise';
import { Trace } from '../util/trace';

export interface SpecificationListener {
    onResult(results: ProjectedResult[]): Promise<void>;
}

/**
 * A listener registered for one inverse read with a subscription's own givens.
 *
 * Structurally identical to `SpecificationListener`, and deliberately a
 * separate name: the two live in separate registries, so
 * `removeInverseListener` looks only here and `removeSpecificationListener`
 * only there.
 */
export interface InverseListener {
    onResult(results: ProjectedResult[]): Promise<void>;
}

/**
 * Identifies the read that serves a group of inverse listeners. Two listeners
 * share a read exactly when they registered the same inverse against the same
 * given references, in the same order; the order is positional, so it is not
 * normalized.
 */
function inverseGroupKey(inverse: Specification, givenRefs: FactReference[]): string {
    const givens = givenRefs.map(r => `${r.type}:${r.hash}`).join(",");
    return computeStringHash(`${describeSpecification(inverse, 0)}\n${givens}`);
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
     *
     * This bounds one listener, not one save. Listeners registered for the
     * same specification are dispatched concurrently, but specification groups
     * are notified in sequence, so a fact type with K wedged groups can delay
     * its save by up to K times this value.
     */
    listenerTimeoutMs?: number;
}

export class ObservableSource {
    private listenersByTypeAndSpecification: Map<string, Map<string, {
        specification: Specification,
        listeners: SpecificationListener[]
    }>> = new Map();
    /**
     * Keyed by the pin's type, then by `inverseGroupKey`. The pin is the
     * inverse's last given (`__f`), so the type a group waits for is the type
     * of the unknown that inverse binds the new fact to.
     */
    private inverseListenersByTypeAndGroup: Map<string, Map<string, {
        inverse: Specification,
        givenRefs: FactReference[],
        listeners: InverseListener[]
    }>> = new Map();
    private readonly listenerTimeoutMs: number;
    private listenerDispatchDepth = 0;

    constructor(private store: Storage, options: ObservableSourceOptions = {}) {
        this.listenerTimeoutMs = options.listenerTimeoutMs ?? DEFAULT_LISTENER_TIMEOUT_MS;
    }

    async notify(saved: FactEnvelope[]): Promise<void> {
        if (this.listenerDispatchDepth > 0) {
            // A notification entered while a listener callback is running. Two
            // overlapping notifications are ordinary concurrency -- two feeds
            // delivering at once -- and keying on that would warn on nearly
            // every busy client, drowning the signal. Keying on a listener
            // being mid-dispatch is what actually distinguishes re-entrancy:
            // a callback that wrote or queried facts and came back through
            // this path from inside its own notification.
            //
            // Still not caller-scoped -- an unrelated listener may simply
            // happen to be running -- because precise attribution needs async
            // context propagation that the browser target rules out. So this
            // warns and continues rather than throwing on a pattern that works
            // today.
            Trace.counter("observable_notify_reentrant", 1);
            Trace.warn(`[ObservableSource] RE-ENTRANT NOTIFY - Listener dispatch depth on entry: ${this.listenerDispatchDepth}, Envelopes: ${saved.length}. A listener callback appears to be writing or querying facts from inside its own notification; the listener timeout (${this.listenerTimeoutMs}ms) bounds any stall this causes.`);
        }

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

    /**
     * Traced at `debug` throughout. Every line here describes one listener, or
     * one map entry created on its behalf, which is the per-item detail
     * `debug` carries; there is no aggregate to keep at `info`, because
     * registering a listener has no items to summarize. At `info` this made a
     * reconnect write lines in proportion to the subscriptions it
     * re-established (issue #331). The same holds for removal, below.
     */
    public addSpecificationListener(specification: Specification, onResult: (results: ProjectedResult[]) => Promise<void>): SpecificationListener {
        if (specification.given.length !== 1) {
            throw new Error("Specification must have exactly one given fact");
        }
        const givenType = specification.given[0].label.type;
        const givenName = specification.given[0].label.name;
        const specificationKey = computeStringHash(describeSpecification(specification, 0));
        const hasNestedSpecs = specification.projection.type === "composite" &&
            specification.projection.components.some(c => c.type === "specification");

        Trace.debug(`[ObservableSource] ADD_LISTENER REQUEST - Type: ${givenType}, Name: ${givenName}, Spec key: ${specificationKey.substring(0, 8)}..., Has nested specs: ${hasNestedSpecs}`);

        let listenersBySpecification = this.listenersByTypeAndSpecification.get(givenType);
        if (!listenersBySpecification) {
            listenersBySpecification = new Map();
            this.listenersByTypeAndSpecification.set(givenType, listenersBySpecification);
            Trace.debug(`[ObservableSource] Created new listener map for type: ${givenType}`);
        }

        let listeners = listenersBySpecification.get(specificationKey);
        if (!listeners) {
            listeners = {
                specification,
                listeners: []
            };
            listenersBySpecification.set(specificationKey, listeners);
            Trace.debug(`[ObservableSource] Created new listener group for spec: ${specificationKey.substring(0, 8)}... (type: ${givenType})`);
        }

        const specificationListener = {
            onResult
        };
        listeners.listeners.push(specificationListener);
        
        const listenerCount = listeners.listeners.length;
        const totalListeners = Array.from(this.listenersByTypeAndSpecification.values())
            .reduce((total, map) => total + Array.from(map.values()).reduce((sum, l) => sum + l.listeners.length, 0), 0);
        
        Trace.debug(`[ObservableSource] LISTENER ADDED - Spec: ${specificationKey.substring(0, 8)}..., Type: ${givenType}, Count for spec: ${listenerCount}, Total listeners: ${totalListeners}, Nested specs: ${hasNestedSpecs}`);
        
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
                    Trace.debug(`[ObservableSource] REMOVING listener - Spec: ${specificationKey.substring(0, 8)}..., Type: ${givenType}, Index: ${index}, Before count: ${beforeCount}`);
                    
                    listeners.listeners.splice(index, 1);
                    found = true;
                    removedFromSpec = specificationKey;
                    removedFromType = givenType;
                    
                    const afterCount = listeners.listeners.length;
                    Trace.debug(`[ObservableSource] REMOVED listener - After count: ${afterCount}`);

                    if (listeners.listeners.length === 0) {
                        listenersBySpecification.delete(specificationKey);
                        Trace.debug(`[ObservableSource] Deleted empty spec group: ${specificationKey.substring(0, 8)}...`);

                        if (listenersBySpecification.size === 0) {
                            this.listenersByTypeAndSpecification.delete(givenType);
                            Trace.debug(`[ObservableSource] Deleted empty type group: ${givenType}`);
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
            Trace.debug(`[ObservableSource] Listener removal completed - Spec: ${removedFromSpec.substring(0, 8)}..., Type: ${removedFromType}, Total remaining: ${totalListeners}, Duration: ${duration}ms`);
        } else {
            Trace.warn(`[ObservableSource] Listener NOT FOUND during removal - Total listeners: ${totalListeners}, Duration: ${duration}ms`);
        }
    }

    /**
     * Register a listener for one inverse produced by `candidateInverses`.
     *
     * The inverse's last given is the pin, `__f`, and its type is the type the
     * listener waits for. When a fact of that type is saved, the inverse is
     * read with `[...givenRefs, newFactRef]` and every resulting row is passed
     * to `onResult`.
     *
     * That is the whole difference from `addSpecificationListener`, which
     * reads an inverse from the new fact alone and so requires every given to
     * be reachable from it. Binding the subscription's givens in the read
     * instead lets a specification whose given is joined only inside an
     * existential condition be listened to, and leaves the consumer nothing to
     * filter: every row the read returns already belongs to these givens.
     *
     * Traced at `debug` for the reason registration is there for specification
     * listeners (issue #331): each line describes one listener, and
     * registering one has no aggregate to summarize.
     */
    public addInverseListener(inverse: Specification, givenRefs: FactReference[], onResult: (results: ProjectedResult[]) => Promise<void>): InverseListener {
        if (inverse.given.length === 0) {
            throw new Error("An inverse must declare at least one given, the pin");
        }
        if (givenRefs.length !== inverse.given.length - 1) {
            throw new Error(`The inverse declares ${inverse.given.length - 1} given(s) besides the pin, but ${givenRefs.length} reference(s) were supplied`);
        }
        const pinType = inverse.given[inverse.given.length - 1].label.type;
        const groupKey = inverseGroupKey(inverse, givenRefs);

        Trace.debug(`[ObservableSource] ADD_INVERSE_LISTENER REQUEST - Pin type: ${pinType}, Group: ${groupKey.substring(0, 8)}..., Givens: ${givenRefs.length}`);

        let groupsByKey = this.inverseListenersByTypeAndGroup.get(pinType);
        if (!groupsByKey) {
            groupsByKey = new Map();
            this.inverseListenersByTypeAndGroup.set(pinType, groupsByKey);
            Trace.debug(`[ObservableSource] Created new inverse listener map for pin type: ${pinType}`);
        }

        let group = groupsByKey.get(groupKey);
        if (!group) {
            group = {
                inverse,
                // Copied: the group key was computed from these references, so
                // a caller that later mutated its own array would leave the
                // key and the read disagreeing.
                givenRefs: [...givenRefs],
                listeners: []
            };
            groupsByKey.set(groupKey, group);
            Trace.debug(`[ObservableSource] Created new inverse listener group: ${groupKey.substring(0, 8)}... (pin type: ${pinType})`);
        }

        const inverseListener = {
            onResult
        };
        group.listeners.push(inverseListener);

        Trace.debug(`[ObservableSource] INVERSE LISTENER ADDED - Group: ${groupKey.substring(0, 8)}..., Pin type: ${pinType}, Count for group: ${group.listeners.length}`);

        return inverseListener;
    }

    public removeInverseListener(inverseListener: InverseListener) {
        for (const [pinType, groupsByKey] of this.inverseListenersByTypeAndGroup) {
            for (const [groupKey, group] of groupsByKey) {
                const index = group.listeners.indexOf(inverseListener);
                if (index >= 0) {
                    group.listeners.splice(index, 1);
                    Trace.debug(`[ObservableSource] REMOVED inverse listener - Group: ${groupKey.substring(0, 8)}..., Pin type: ${pinType}, After count: ${group.listeners.length}`);

                    if (group.listeners.length === 0) {
                        groupsByKey.delete(groupKey);
                        Trace.debug(`[ObservableSource] Deleted empty inverse group: ${groupKey.substring(0, 8)}...`);

                        if (groupsByKey.size === 0) {
                            this.inverseListenersByTypeAndGroup.delete(pinType);
                            Trace.debug(`[ObservableSource] Deleted empty inverse pin type group: ${pinType}`);
                        }
                    }
                    return;
                }
            }
        }
        Trace.warn("[ObservableSource] Inverse listener NOT FOUND during removal");
    }

    private async notifyFactSaved(fact: FactRecord) {
        const startTime = Date.now();
        const listenersBySpecification = this.listenersByTypeAndSpecification.get(fact.type);
        
        if (listenersBySpecification) {
            // COMPLETE carries everything START carries and the outcome
            // besides, so reporting both at `info` reported one notification
            // twice. START stays at `debug`, where it still marks a
            // notification that began and never completed (issue #331).
            Trace.debug(`[ObservableSource] NOTIFY START - Fact type: ${fact.type}, Hash: ${fact.hash.substring(0, 8)}..., Spec groups: ${listenersBySpecification.size}`);
            
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
                        Trace.debug(`[ObservableSource] NESTED SPEC DETECTED - Spec ${specCount}/${listenersBySpecification.size}, Key: ${specificationKey.substring(0, 8)}..., Nested components: [${nestedSpecNames}], Listeners: ${listenerCount}`);
                    } else {
                        Trace.debug(`[ObservableSource] Processing spec ${specCount}/${listenersBySpecification.size} - Key: ${specificationKey.substring(0, 8)}..., Listeners: ${listenerCount}`);
                    }
                    
                    const givenReference = {
                        type: fact.type,
                        hash: fact.hash
                    };
                    
                    const readStart = Date.now();
                    const results = await this.store.read([givenReference], specification);
                    const readDuration = Date.now() - readStart;
                    
                    if (hasNestedSpecs) {
                        Trace.debug(`[ObservableSource] Store read for NESTED spec - Results: ${results.length}, Duration: ${readDuration}ms`);
                        // Log nested result structure if present
                        if (results.length > 0 && specification.projection.type === "composite") {
                            const nestedResults = specification.projection.components
                                .filter(c => c.type === "specification")
                                .map(c => `${c.name}: ${results[0].result[c.name]?.length || 0}`)
                                .join(', ');
                            Trace.debug(`[ObservableSource] Nested results structure: {${nestedResults}}`);
                        }
                    } else {
                        Trace.debug(`[ObservableSource] Store read completed - Results: ${results.length}, Duration: ${readDuration}ms`);
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
                    //
                    // The fan-out is within a spec group only; the loop over
                    // spec groups above is still serial, so a wedged listener
                    // delays the groups after it by up to listenerTimeoutMs
                    // each. A fact type with K wedged groups therefore costs
                    // K * listenerTimeoutMs, not one. Distinct specifications
                    // carry no causal edge either, so hoisting this Promise.all
                    // to that loop would be sound; it is left serial here to
                    // keep this change to the wait that caused issue #246.
                    const outcomes = await Promise.all(listenerSnapshot.map((specificationListener, i) =>
                        this.notifyListener(specificationListener, results, i, listenerSnapshot.length, specificationKey, fact.type, hasNestedSpecs)));
                    totalNotifications += outcomes.filter(completed => completed).length;
                } else {
                    Trace.debug(`[ObservableSource] Skipping spec ${specCount}/${listenersBySpecification.size} - No listeners or null group`);
                }
            }
            
            const totalDuration = Date.now() - startTime;
            Trace.info(`[ObservableSource] NOTIFY COMPLETE - Fact: ${fact.hash.substring(0, 8)}..., Type: ${fact.type}, Specs processed: ${specCount} (${nestedSpecCount} nested), Total notifications: ${totalNotifications}, Duration: ${totalDuration}ms`);
        } else {
            Trace.debug(`[ObservableSource] No specification listeners for fact type: ${fact.type} - Available types: [${Array.from(this.listenersByTypeAndSpecification.keys()).join(', ')}]`);
        }

        await this.notifyInverseListeners(fact);
    }

    /**
     * The inverse-listener half of a notification. Groups whose pin type
     * matches the saved fact are read once each, with the group's own given
     * references ahead of the new fact, and dispatched through
     * `notifyListener` so the timeout and the re-entrancy accounting are the
     * same as for a specification listener.
     *
     * Serial over groups and concurrent within one, matching the
     * specification loop above: the listeners in a group are independent
     * subscriptions to the same read, so the model records no edge between
     * them to sequence by, while a wedged listener in one group delays the
     * groups after it by up to `listenerTimeoutMs`.
     */
    private async notifyInverseListeners(fact: FactRecord) {
        const groupsByKey = this.inverseListenersByTypeAndGroup.get(fact.type);
        if (!groupsByKey) {
            return;
        }

        const factReference: FactReference = {
            type: fact.type,
            hash: fact.hash
        };

        for (const [groupKey, group] of groupsByKey) {
            if (group.listeners.length === 0) {
                continue;
            }

            const readStart = Date.now();
            const results = await this.store.read([...group.givenRefs, factReference], group.inverse);
            Trace.debug(`[ObservableSource] Inverse read completed - Group: ${groupKey.substring(0, 8)}..., Results: ${results.length}, Duration: ${Date.now() - readStart}ms`);

            const listenerSnapshot = [...group.listeners];
            await Promise.all(listenerSnapshot.map((inverseListener, i) =>
                this.notifyListener(inverseListener, results, i, listenerSnapshot.length, groupKey, fact.type, false)));
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
        Trace.debug(`[ObservableSource] Calling listener ${label} - Nested: ${hasNestedSpecs}`);
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
                Trace.debug(`[ObservableSource] Listener completed - ${label}, Duration: ${notifyDuration}ms`);
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
