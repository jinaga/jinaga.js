import { Authentication } from "./authentication/authentication";
import { dehydrateReference, Dehydration, HashMap, hashSymbol, hydrate, hydrateFromTree, lookupHash } from './fact/hydrate';
import { SyncStatus, SyncStatusNotifier } from './http/web-client';
import { DistributionDeniedError, DistributionDiagnostic, isStructuralDenial, toDistributionDiagnostics } from './managers/distributionDiagnostic';
import { FactManager } from './managers/factManager';
import { User } from './model/user';
import { ChangeSubscription, SpecificationChangeHandlers, startChangeObserver } from './observer/change-observer';
import { ObservableCollection, Observer, ResultAddedFunc } from './observer/observer';
import { describeSpecification } from './specification/description';
import { extractResults } from './specification/results';
import { SpecificationRow, rowIdentityLabels, toRows } from './specification/row';
import { FactConstructor, SpecificationOf } from './specification/model';
import { detectDisconnectedSpecification } from "./specification/UnionFind";
import { FactEnvelope, FactReference } from './storage';
import { toJSON } from './util/obj';
import { Trace } from './util/trace';

export { DistributionDeniedError, DistributionDiagnostic } from './managers/distributionDiagnostic';

export interface Profile {
    displayName: string;
}

export type MakeObservable<T> =
    T extends Array<infer U> ? ObservableCollection<MakeObservable<U>> :
    T extends { [key: string]: unknown } ? { [K in keyof T]: MakeObservable<T[K]> } :
    T;

type WatchArgs<T extends unknown[], U> = [...T, ResultAddedFunc<MakeObservable<U>>];

export type Fact = { type: string } & HashMap;

export class Jinaga {
    private errorHandlers: ((message: string) => void)[] = [];
    private loadingHandlers: ((loading: boolean) => void)[] = [];
    private progressHandlers: ((count: number) => void)[] = [];
    private distributionDiagnosticHandlers: ((diagnostic: DistributionDiagnostic) => void)[] = [];

    constructor(
        private authentication: Authentication,
        private factManager: FactManager,
        private syncStatusNotifier: SyncStatusNotifier | null
    ) { }

    /**
     * Register an callback to receive error messages.
     * 
     * @param handler A function to receive error messages
     */
    onError(handler: (message: string) => void) {
        this.errorHandlers.push(handler);
    }

    /**
     * Register a callback to receive loading state notifications.
     * 
     * @param handler A function to receive loading state
     */
    onLoading(handler: (loading: boolean) => void) {
        this.loadingHandlers.push(handler);
    }

    /**
     * Register a callback to receive outgoing fact count.
     * A count greater than 0 is an indication to the user that the application is saving.
     * 
     * @param handler A function to receive the number of facts in the queue
     */
    onProgress(handler: (queueCount: number) => void) {
        this.progressHandlers.push(handler);
    }

    onSyncStatus(handler: (status: SyncStatus) => void) {
        this.syncStatusNotifier?.onSyncStatus(handler);
    }

    /**
     * Register a callback to receive distribution diagnostics (issue #207 W5).
     * Fires for `query`, `watch`, and `subscribe` alike — all three pass through
     * the same per-feed decision capture — whenever a feed is `denied` or
     * `reactive`. Authorized feeds and old replicators (which report no
     * decisions) produce nothing, so this channel is inert until there is
     * something to report.
     *
     * This is the always-on programmatic channel: route it to your own
     * devtools/telemetry. Branch on `diagnostic.reactive` — a `reactive`
     * diagnostic is the subscription race and must never be treated as fatal.
     *
     * @param handler A function to receive each distribution diagnostic
     */
    onDistributionDiagnostic(handler: (diagnostic: DistributionDiagnostic) => void) {
        this.distributionDiagnosticHandlers.push(handler);
    }

    /**
     * Deliver diagnostics to every registered handler. A throwing handler must
     * not abort delivery to the others or bubble into the operation that
     * produced the diagnostic (a diagnostic is never fatal), so each call is
     * isolated.
     */
    private emitDistributionDiagnostics(diagnostics: DistributionDiagnostic[]) {
        for (const diagnostic of diagnostics) {
            for (const handler of this.distributionDiagnosticHandlers) {
                try {
                    handler(diagnostic);
                }
                catch (e) {
                    Trace.error(e);
                }
            }
        }
    }

    /**
     * Log the user in and return a fact that represents their identity.
     * This method is only valid in the browser.
     * 
     * @returns A promise that resolves to a fact that represents the user's identity, and the user's profile as reported by the configured Passport strategy
     */
    async login<U extends Fact>(): Promise<{ userFact: U, profile: Profile }> {
        const { userFact, profile } = await this.authentication.login();
        return {
            userFact: hydrate<U>(userFact),
            profile
        };
    }

    /**
     * Access the identity of the local machine.
     * This method is only valid for the server and clients with local storage.
     * The local machine's identity is not shared with remote machines.
     * 
     * @returns A promise that resolves to the local machine's identity
     */
    async local<D extends Fact>(): Promise<D> {
        const deviceFact = await this.authentication.local();
        return hydrate<D>(deviceFact);
    }
    
    /**
     * Creates a new fact.
     * This method is asynchronous.
     * It will be resolved when the fact has been persisted.
     * 
     * @param prototype The fact to save and share
     * @returns The fact that was just created
     */
    async fact<T extends Fact>(prototype: T) : Promise<T> {
        if (!prototype) {
            return prototype;
        }
        try {
            const fact = this.validateFact(prototype);
            const dehydration = new Dehydration();
            const reference = dehydration.dehydrate(fact);
            const factRecords = dehydration.factRecords();
            const hydrated = hydrateFromTree([reference], factRecords)[0];
            const envelopes = factRecords.map(fact => {
                return <FactEnvelope>{
                    fact: fact,
                    signatures: []
                };
            });
            const authorized = await this.authentication.authorize(envelopes);
            const saved = await this.factManager.save(authorized);
            return hydrated as T;
        } catch (error) {
            this.error(error);
            throw error;
        }
    }

    /**
     * Execute a query for facts matching a specification.
     * 
     * @param specification Use Model.given().match() to create a specification
     * @param given The fact or facts from which to begin the query
     * @returns A promise that resolves to an array of results
     */
    async query<T extends unknown[], U>(specification: SpecificationOf<T, U>, ...given: T): Promise<U[]> {
        const innerSpecification = specification.specification;
        
        detectDisconnectedSpecification(innerSpecification);

        if (!given || given.some(g => !g)) {
            return [];
        }
        if (given.length !== innerSpecification.given.length) {
            throw new Error(`Expected ${innerSpecification.given.length} given facts, but received ${given.length}.`);
        }

        const references = given.map(g => this.prepareFactReference(g));
        const decisions = await this.factManager.fetch(references, innerSpecification);
        const diagnostics = toDistributionDiagnostics(
            'query',
            describeSpecification(innerSpecification, 0),
            decisions
        );
        this.emitDistributionDiagnostics(diagnostics);
        // Fail loudly, by default, for a structural denial (a missing rule or a
        // spec narrowed past its rule) that provably never self-heals. A
        // one-shot `query` has no "later" to wait for — unlike `subscribe`, whose
        // feed stays open and delivers the moment the authorizing fact arrives —
        // so a silent empty result is indistinguishable from "no data" and hides
        // the mis-authored spec or distribution rule. This matches the write
        // path's exception-on-authorization-failure contract (issue
        // jinaga-server#179). A `reactive` decision (the subscription race) is
        // NEVER thrown for — it self-heals — and neither are non-structural
        // denials (`principal-excluded` / `not-authenticated`), which are auth
        // states rather than authoring errors. Callers that want to inspect any
        // decision without throwing use `queryWithDiagnostics`.
        const structural = diagnostics.filter(isStructuralDenial);
        if (structural.length > 0) {
            throw new DistributionDeniedError(structural);
        }
        const projectedResults = await this.factManager.read(references, innerSpecification);
        const extracted = extractResults(projectedResults, innerSpecification.projection);
        Trace.counter("facts_loaded", extracted.totalCount);
        return extracted.results;
    }

    /**
     * Read the rows that currently match a specification, identified the same
     * way `observeChanges` identifies them.
     *
     * `query` answers "what does this specification select", which is what an
     * application renders. A durable consumer needs one thing more: a stable
     * identity for the row, so that the set it reads and the changes it is
     * notified of can be deduplicated against each other. That identity is
     * `rowHash`, and it is the same value `observeChanges` delivers for the
     * same row, on the add and on the remove.
     *
     * The pairing is what makes a consumer correct. `observeChanges` delivers
     * only changes, so a consumer registers it first and reads the current set
     * second: a row that already matched is in this result, a row that appears
     * after registration is notified, and a row that lands between the two is
     * both. The overlap is absorbed by deduplicating on `rowHash`; the reverse
     * order would drop the rows that land in the gap.
     *
     * Like `query`, this fetches from the replicator before reading, so it is
     * also how a consumer pulls work that has not reached this client yet. It
     * materializes the whole matching set: bound it by the specification or by
     * the given, not by this call.
     *
     * @param specification Use Model.given().match() to create a specification. It must have exactly one given.
     * @param given The fact from which to begin the query
     * @returns The current rows, each carrying the projection and its row hash
     */
    async queryRows<T extends [unknown], U>(specification: SpecificationOf<T, U>, given: T[0]): Promise<SpecificationRow<U>[]> {
        const innerSpecification = specification.specification;

        // Checked before the structural analysis below, so that a caller who
        // passed a multi-given specification is told that rather than whatever
        // else is true of it.
        if (innerSpecification.given.length !== 1) {
            throw new Error(`queryRows requires a specification with exactly one given fact, but this one has ${innerSpecification.given.length}. Bind the others into the specification, or use query.`);
        }

        detectDisconnectedSpecification(innerSpecification);

        if (given === undefined || given === null) {
            return [];
        }

        const references = [this.prepareFactReference(given)];
        const decisions = await this.factManager.fetch(references, innerSpecification);
        const diagnostics = toDistributionDiagnostics(
            'query',
            describeSpecification(innerSpecification, 0),
            decisions
        );
        this.emitDistributionDiagnostics(diagnostics);
        // Same contract as `query`: a structural denial provably never
        // self-heals, so a silent empty result would hide the mis-authored
        // specification or distribution rule.
        const structural = diagnostics.filter(isStructuralDenial);
        if (structural.length > 0) {
            throw new DistributionDeniedError(structural);
        }
        const projectedResults = await this.factManager.read(references, innerSpecification);
        const labels = rowIdentityLabels(innerSpecification);
        const { rows, totalCount } = toRows<U>(projectedResults, innerSpecification, labels);
        // Counts facts the way `query` does: nested collection rows included,
        // so one read reports the same number through either surface.
        Trace.counter("facts_loaded", totalCount);
        return rows;
    }

    /**
     * Execute a query and return, alongside the results, the distribution
     * diagnostics correlated to this exact fetch (issue #207 W8b). This is the
     * one-shot, correlated channel deliberate callers (e.g. the factual MCP)
     * use to distinguish "denied by distribution" from "authorized but empty"
     * in a single call — without a `POST /feeds/explain` endpoint.
     *
     * Unlike `query`, this never throws on a distribution decision. A `reactive`
     * decision (the subscription race — the current user is not yet authorized
     * but the feed will self-heal when the authorizing fact arrives) is reported
     * as a diagnostic, not an error; the results stay silently empty. Against an
     * old replicator that omits decisions, `diagnostics` is always empty.
     *
     * @param specification Use Model.given().match() to create a specification
     * @param given The fact or facts from which to begin the query
     * @returns A promise resolving to the projected results and the diagnostics
     */
    async queryWithDiagnostics<T extends unknown[], U>(specification: SpecificationOf<T, U>, ...given: T): Promise<{ results: U[]; diagnostics: DistributionDiagnostic[] }> {
        const innerSpecification = specification.specification;

        detectDisconnectedSpecification(innerSpecification);

        if (!given || given.some(g => !g)) {
            return { results: [], diagnostics: [] };
        }
        if (given.length !== innerSpecification.given.length) {
            throw new Error(`Expected ${innerSpecification.given.length} given facts, but received ${given.length}.`);
        }

        const references = given.map(g => this.prepareFactReference(g));
        const decisions = await this.factManager.fetch(references, innerSpecification);
        const projectedResults = await this.factManager.read(references, innerSpecification);
        const extracted = extractResults(projectedResults, innerSpecification.projection);
        Trace.counter("facts_loaded", extracted.totalCount);
        const diagnostics = toDistributionDiagnostics(
            'query',
            describeSpecification(innerSpecification, 0),
            decisions
        );
        // Also drive the always-on instance hook so a caller that registered
        // `onDistributionDiagnostic` sees these alongside the correlated return
        // value, exactly as it would for a plain `query`.
        this.emitDistributionDiagnostics(diagnostics);
        return { results: extracted.results, diagnostics };
    }

    /**
     * Receive notification when a projection changes.
     * The notification function will initially receive all matching results.
     * It will then subsequently receive new results as they are created.
     * Return a function to be called when the result is removed.
     * 
     * @param specification Use Model.given().match() to create a specification
     * @param given The fact or facts from which to begin the query
     * @param resultAdded A function to receive the initial and new results
     * @returns An observer to control notifications
     */
    watch<T extends unknown[], U>(specification: SpecificationOf<T, U>, ...args: WatchArgs<T, U>): Observer<U> {
        const given: T = args.slice(0, args.length - 1) as T;
        const resultAdded = args[args.length - 1] as ResultAddedFunc<U>;
        const innerSpecification = specification.specification;

        if (!given) {
            throw new Error("No given facts provided.");
        }
        if (given.some(g => !g)) {
            throw new Error("One or more given facts are null.");
        }
        if (!resultAdded || typeof resultAdded !== "function") {
            throw new Error("No resultAdded function provided.");
        }
        if (given.length !== innerSpecification.given.length) {
            throw new Error(`Expected ${innerSpecification.given.length} given facts, but received ${given.length}.`);
        }

        const references = given.map(g => this.prepareFactReference(g));

        return this.factManager.startObserver<U>(references, innerSpecification, resultAdded, false,
            diagnostics => this.emitDistributionDiagnostics(diagnostics));
    }

    /**
     * Request server-sent events when a fact affects query results.
     * While the subscription is active, the server will push matching facts
     * to the client. Call Subscription.stop() to stop receiving events.
     * 
     * @param specification Use Model.given().match() to create a specification
     * @param given The fact or facts from which to begin the subscription
     * @returns A subscription, which remains running until you call stop
     */
    subscribe<T extends unknown[], U>(specification: SpecificationOf<T, U>, ...args: WatchArgs<T, U>): Observer<U> {
        const given: T = args.slice(0, args.length - 1) as T;
        const resultAdded = args[args.length - 1] as ResultAddedFunc<U>;
        const innerSpecification = specification.specification;

        if (!given) {
            throw new Error("No given facts provided.");
        }
        if (given.some(g => !g)) {
            throw new Error("One or more given facts are null.");
        }
        if (!resultAdded || typeof resultAdded !== "function") {
            throw new Error("No resultAdded function provided.");
        }
        if (given.length !== innerSpecification.given.length) {
            throw new Error(`Expected ${innerSpecification.given.length} given facts, but received ${given.length}.`);
        }

        const references = given.map(g => this.prepareFactReference(g));

        return this.factManager.startObserver<U>(references, innerSpecification, resultAdded, true,
            diagnostics => this.emitDistributionDiagnostics(diagnostics));
    }

    /**
     * Learn which rows enter and leave a specification's result set, without
     * the observer machinery.
     *
     * This is a narrow seam over the same inverse specifications that drive
     * `watch` and `subscribe`, and it deliberately stops there. There is no
     * projection tree, no nested `onAdded` registration, no buffering of
     * undelivered parents, and no `loaded()` or `processed()`. It is not a
     * replacement for `watch`/`subscribe`.
     *
     * Each callback receives the specification's own projection, hydrated
     * exactly as `query` and `queryRows` deliver it, paired with the row hash
     * that identifies the row. A consumer acts on the value it is handed; it
     * never has to load a fact from a reference, and if it wants a hash it
     * projects one.
     *
     * Four consequences worth reading before you use it:
     *
     * - **Changes only.** Nothing is delivered for rows that already match.
     *   Register this first and read the current set with `queryRows` second:
     *   a row that already matched is in that result, a row that arrives later
     *   is notified, and a row that lands between the two is both. The overlap
     *   deduplicates on `rowHash`; the reverse order loses the gap.
     * - **Do the work outside the callback.** These run inside the `save()`
     *   that triggered them. A callback that queries or saves facts re-enters
     *   `ObservableSource.notify` from inside its own notification. Enqueue
     *   and return.
     * - **A notification can be dropped.** The callbacks dispatch through the
     *   listener bound added in #249: one that exceeds `listenerTimeoutMs` is
     *   abandoned so it cannot wedge the save. For a consumer whose source of
     *   truth is its own periodic `queryRows` sweep, a dropped notification
     *   costs latency and nothing else.
     * - **Local facts only.** This observes facts as they are saved into this
     *   client's store. It opens no feed of its own; pair it with `subscribe`
     *   or a `queryRows` sweep if facts must arrive from a replicator first.
     *
     * `onRemoved` is not symmetry for its own sake. For a specification ending
     * in `notExists(Completion)` — how a durable consumer expresses its
     * outstanding work — the remove inverse fires exactly when the completion
     * fact is saved, for exactly the row that just left the set.
     *
     * @param specification Use Model.given().match() to create a specification. It must have exactly one given.
     * @param given The fact from which to begin the query
     * @param handlers `onAdded` and/or `onRemoved`; at least one is required
     * @returns A subscription; call stop() to release its listeners
     */
    observeChanges<T extends [unknown], U>(
        specification: SpecificationOf<T, U>,
        given: T[0],
        handlers: SpecificationChangeHandlers<U>
    ): ChangeSubscription {
        const innerSpecification = specification.specification;

        if (given === undefined || given === null) {
            throw new Error("No given fact provided.");
        }
        if (innerSpecification.given.length !== 1) {
            throw new Error(`observeChanges requires a specification with exactly one given fact, but this one has ${innerSpecification.given.length}. Bind the others into the specification, or use watch.`);
        }
        if (!handlers || (typeof handlers.onAdded !== "function" && typeof handlers.onRemoved !== "function")) {
            throw new Error("Provide at least one of onAdded or onRemoved.");
        }

        const reference = this.prepareFactReference(given);

        return startChangeObserver(this.factManager, innerSpecification, [reference], handlers);
    }

    /**
     * Compute the SHA-256 hash of a fact.
     * This is a deterministic hash that can be used to identify the fact.
     * @param fact The fact to hash
     * @returns The SHA-256 hash of the fact as a base-64 string
     */
    static hash<T extends Fact>(fact: T) {
        const hash = lookupHash(fact);
        if (hash) {
            return hash;
        }
        const error = this.getFactError(fact);
        if (error) {
            throw new Error(`Cannot hash the object. It is not a fact. ${error}: ${JSON.stringify(fact)}`);
        }
        const reference = dehydrateReference(fact);
        return reference.hash;
    }

    /**
     * Create a strongly-typed fact reference from a type constructor and hash.
     * This allows you to create a minimal fact object that can be used with
     * query, watch, and subscribe APIs when you only have the hash.
     * 
     * @param ctor The constructor function with a static Type property
     * @param hash The SHA-256 hash of the fact as a base-64 string
     * @returns A fact reference object typed as T
     */
    static factReference<T extends Fact>(ctor: FactConstructor<T>, hash: string): T {
        const type = (ctor as any).Type;
        if (!type || typeof type !== 'string') {
            throw new Error(`Constructor must have a static Type property of type string. Found: ${typeof type}`);
        }
        
        const factRef = {
            type: type
        } as T;
        
        // Set the hash symbol if available
        if (hashSymbol) {
            (factRef as any)[hashSymbol] = hash;
        }
        
        return factRef;
    }

    /**
     * Compute the SHA-256 hash of a fact.
     * This is a deterministic hash that can be used to identify the fact.
     * @param fact The fact to hash
     * @returns The SHA-256 hash of the fact as a base-64 string
     */
    hash<T extends Fact>(fact: T) {
        return Jinaga.hash(fact);
    }

    /**
     * Create a strongly-typed fact reference from a type constructor and hash.
     * This allows you to create a minimal fact object that can be used with
     * query, watch, and subscribe APIs when you only have the hash.
     * 
     * @param ctor The constructor function with a static Type property
     * @param hash The SHA-256 hash of the fact as a base-64 string
     * @returns A fact reference object typed as T
     */
    factReference<T extends Fact>(ctor: FactConstructor<T>, hash: string): T {
        return Jinaga.factReference(ctor, hash);
    }

    /**
     * Purge the data store of all descendants of purge roots.
     * A purge root is a fact that satisfies a purge condition.
     * @returns Resolves when the data store has been purged.
     */
    purge(): Promise<void> {
        return this.factManager.purge();
    }

    /**
     * Processes the queue immediately, bypassing any delay.
     * This allows you to ensure that all facts have been sent to the server.
     */
    push(): Promise<void> {
        return this.factManager.push();
    }

    /**
     * Create some facts owned by a single-use principal. A key pair is
     * generated for the principal and used to sign the facts. The private
     * key is discarded after the facts are saved.
     * 
     * @param func A function that saves a set of facts and returns one or more of them
     * @returns The result of the function
     */
    async singleUse<T>(func: (principal: User) => Promise<T>): Promise<T> {
        try {
            const { last } = await this.factManager.beginSingleUse();
            const principal = hydrate<User>(last);
            return await func(principal);
        } finally {
            this.factManager.endSingleUse();
        }
    }

    private validateFact(prototype: Fact): Fact {
        let fact = this.removeNullPredecessors(prototype);

        const error = Jinaga.getFactError(fact);
        if (error) {
            throw new Error(error);
        }

        return fact as Fact;
    }

    private removeNullPredecessors(fact: HashMap): HashMap {
        if (!fact) {
            return fact;
        }
        if (fact instanceof Date) {
            return fact;
        }
        if (typeof fact !== 'object') {
            return fact;
        }
        if (Array.isArray(fact)) {
            // Let the validator report the error
            return fact;
        }
        if (lookupHash(fact)) {
            // If the fact has a hash symbol, then we need to retain its identity
            return fact;
        }
        const result: any = {};
        for (const key in fact) {
            const value = fact[key];
            if (value !== null && value !== undefined) {
                if (Array.isArray(value)) {
                    result[key] = value.filter(v => v !== null && v !== undefined).map(v => this.removeNullPredecessors(v));
                } else if (typeof value === 'object') {
                    result[key] = this.removeNullPredecessors(value);
                } else {
                    result[key] = value;
                }
            }
        }
        return result;
    }

    private static getFactError(prototype: HashMap): string | undefined {
        if (!prototype) {
            return 'A fact cannot be null.';
        }
        if (!('type' in prototype)) {
            return 'Specify the type of the fact and all of its predecessors.';
        }
        for (const field in prototype) {
            const value = toJSON(prototype[field]);
            if (typeof(value) === 'object') {
                if (Array.isArray(value)) {
                    for (const element of value) {
                        const error = this.getFactError(element);
                        if (error) {
                            return error;
                        }
                    }
                }
                else {
                    const error = this.getFactError(value);
                    if (error) {
                        return error;
                    }
                }
            }
            else if (typeof(value) === 'function') {
                return `A fact may not have any methods: ${field} in ${prototype.type} is a function.`;
            }
        }
    }

    private error(error: any) {
        Trace.error(error);
        this.errorHandlers.forEach((errorHandler) => {
            errorHandler(error);
        });
    }

    private prepareFactReference(g: unknown): FactReference {
        // Check if this is a factReference created by our helper
        // It should be an object with only a 'type' field and a hashSymbol
        if (typeof g === 'object' && g !== null) {
            const obj = g as any;
            const keys = Object.keys(obj);
            const hasType = typeof obj.type === 'string';
            const hasHash = hashSymbol && obj[hashSymbol];
            
            // If it only has a 'type' field and a hash symbol, treat it as a fact reference
            if (hasType && hasHash && keys.length === 1 && keys[0] === 'type') {
                return {
                    type: obj.type,
                    hash: hashSymbol ? obj[hashSymbol] : ''
                };
            }
        }
        
        // Otherwise, process it as a normal fact
        const fact = JSON.parse(JSON.stringify(g));
        const validatedFact = this.validateFact(fact);
        return dehydrateReference(validatedFact);
    }
}

