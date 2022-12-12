import { Authentication } from './authentication/authentication';
import { dehydrateReference, Dehydration, HashMap, hydrate, hydrateFromTree, lookupHash } from './fact/hydrate';
import { SyncStatus, SyncStatusNotifier } from './http/web-client';
import { runService } from './observable/service';
import { ObservableCollection, Observer, ObserverImpl, ResultAddedFunc } from './observer/observer';
import { Query } from './query/query';
import { ConditionOf, ensure, FactDescription, Preposition, SpecificationOf as OldSpecificationOf } from './query/query-parser';
import { SpecificationOf } from './specification/given';
import { Projection } from './specification/specification';
import { FactEnvelope, FactPath, ProjectedResult, uniqueFactReferences } from './storage';
import { Subscription } from "./subscription/subscription";
import { SubscriptionImpl } from "./subscription/subscription-impl";
import { SubscriptionNoOp } from "./subscription/subscription-no-op";
import { Template } from './template';
import { toJSON } from './util/obj';
import { ServiceRunner } from './util/serviceRunner';
import { Trace, Tracer } from './util/trace';
import { Watch } from './watch/watch';
import { WatchImpl } from './watch/watch-impl';
import { WatchNoOp } from './watch/watch-noop';
    
export interface Profile {
    displayName: string;
}

export { Trace, Tracer, Preposition, FactDescription, ensure, Template };

type MakeObservable<T> =
    T extends Array<infer U> ? ObservableCollection<MakeObservable<U>> :
    T extends { [key: string]: unknown } ? { [K in keyof T]: MakeObservable<T[K]> } :
    T;

type WatchArgs<T extends unknown[], U> = [...T, ResultAddedFunc<MakeObservable<U>>];

export class Jinaga {
    private errorHandlers: ((message: string) => void)[] = [];
    private loadingHandlers: ((loading: boolean) => void)[] = [];
    private progressHandlers: ((count: number) => void)[] = [];
    private serviceRunner = new ServiceRunner(exception => this.error(exception));
    
    constructor(
        private authentication: Authentication,
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
     * Log the user in and return a fact that represents their identity.
     * This method is only valid in the browser.
     * 
     * @returns A promise that resolves to a fact that represents the user's identity, and the user's profile as reported by the configured Passport strategy
     */
    async login<U>(): Promise<{ userFact: U, profile: Profile }> {
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
    async local<D>(): Promise<D> {
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
    async fact<T>(prototype: T) : Promise<T> {
        if (!prototype) {
            return prototype;
        }
        try {
            this.validateFact(prototype);
            const dehydration = new Dehydration();
            const reference = dehydration.dehydrate(prototype);
            const factRecords = dehydration.factRecords();
            const hydrated = hydrateFromTree([reference], factRecords)[0];
            const envelopes = factRecords.map(fact => {
                return <FactEnvelope>{
                    fact: fact,
                    signatures: []
                };
            });
            const saved = await this.authentication.save(envelopes);
            return hydrated as T;
        } catch (error) {
            this.error(error);
            throw error;
        }
    }

    /**
     * Execute a query for facts matching a template.
     * 
     * @param start A fact from which to begin the query
     * @param preposition A template function passed into j.for
     * @returns A promise that resolves to an array of results
     */
    query<T, U>(start: T, preposition: Preposition<T, U>) : Promise<U[]>;
    /**
     * Execute a query for facts matching a specification.
     * 
     * @param specification Use Model.given().match() to create a specification
     * @param given The fact or facts from which to begin the query
     * @returns A promise that resolves to an array of results
     */
    query<T extends unknown[], U>(specification: SpecificationOf<T, U>, ...given: T): Promise<U[]>;
    query(first: any, ...rest: any[]): Promise<any[]> {
        if (rest.length === 1 && rest[0] instanceof Preposition) {
            return this.oldQuery(first, rest[0]);
        }
        else {
            return this.newQuery(first, ...rest);
        }
    }

    private async oldQuery<T, U>(start: T, preposition: Preposition<T, U>) : Promise<U[]> {
        if (!start) {
            return [];
        }
        const fact = JSON.parse(JSON.stringify(start));
        this.validateFact(fact);
        const reference = dehydrateReference(fact);
        const query = new Query(preposition.steps);
        const results = await this.authentication.query(reference, query);
        if (results.length === 0) {
            return [];
        }
        const references = results.map(r => r[r.length - 1]);
        const uniqueReferences = uniqueFactReferences(references);

        const facts = await this.authentication.load(uniqueReferences);
        return hydrateFromTree(uniqueReferences, facts);
    }

    private async newQuery<T extends unknown[], U>(specification: SpecificationOf<T, U>, ...given: T): Promise<U[]> {
        const innerSpecification = specification.specification;

        if (!given || given.some(g => !g)) {
            return [];
        }
        if (given.length !== innerSpecification.given.length) {
            throw new Error(`Expected ${innerSpecification.given.length} given facts, but received ${given.length}.`);
        }

        const references = given.map(g => {
            const fact = JSON.parse(JSON.stringify(g));
            this.validateFact(fact);
            return dehydrateReference(fact);
        });
        const projectedResults = await this.authentication.read(references, innerSpecification);
        return extractResults(projectedResults, innerSpecification.projection);
    }

    /**
     * Receive notification when a fact is added or removed from query results.
     * The notification function will initially recieve all matching facts.
     * It will then subsequently receive new facts as they are created.
     * 
     * @param start A fact from which to begin the query
     * @param preposition A template function passed into j.for
     * @param resultAdded A function that is called when a fact is added
     * @param resultRemoved (optional) A function that is called when a fact is removed
     * @returns A Watch object that can be used to nest new watches or stop watching
     */
    watch<T, U, V>(
        start: T,
        preposition: Preposition<T, U>,
        resultAdded: (result: U) => V,
        resultRemoved: (model: V) => void) : Watch<U, V>;
    /**
     * Receive notification when a fact is added or removed from query results.
     * The notification function will initially recieve all matching facts.
     * It will then subsequently receive new facts as they are created.
     * 
     * @param start A fact from which to begin the query
     * @param preposition A template function passed into j.for
     * @param resultAdded A function that is called when a fact is added
     * @returns A Watch object that can be used to nest new watches or stop watching
     */
    watch<T, U, V>(
        start: T,
        preposition: Preposition<T, U>,
        resultAdded: (result: U) => void) : Watch<U, V>;
    watch<T extends unknown[], U>(specification: SpecificationOf<T, U>, ...args: WatchArgs<T, U>): Observer<U>;
    watch(...args: any[]): any {
        if (args.length === 3 && args[1] instanceof Preposition) {
            return this.oldWatch(args[0], args[1], args[2]);
        }
        else if (args.length === 4 && args[1] instanceof Preposition) {
            return this.oldWatch(args[0], args[1], args[2], args[3]);
        }
        else {
            return this.newWatch(args[0], ...args.slice(1, args.length-1), args[args.length-1]);
        }
    }

    private oldWatch<T, U, V>(
        start: T,
        preposition: Preposition<T, U>,
        resultAdded: (fact: U) => (V | void),
        resultRemoved?: (model: V) => void
    ) : Watch<U, V> {
        if (!start) {
            return new WatchNoOp<U, V>();
        }
        const fact = JSON.parse(JSON.stringify(start));
        this.validateFact(fact);
        const reference = dehydrateReference(fact);
        const query = new Query(preposition.steps);
        const onResultAdded = (path: FactPath, fact: U, take: ((model: V | null) => void)) => {
            const model = resultAdded(fact);
            take(resultRemoved ? <V>model : null);
        };
        const watch = new WatchImpl<U, V>(reference, query, onResultAdded, resultRemoved, this.authentication);
        watch.begin();
        return watch;
    }

    private newWatch<T extends unknown[], U>(specification: SpecificationOf<T, U>, ...args: WatchArgs<T, U>): Observer<U> {
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

        const references = given.map(g => {
            const fact = JSON.parse(JSON.stringify(g));
            this.validateFact(fact);
            return dehydrateReference(fact);
        });

        const observer = new ObserverImpl<U>(this.authentication, references, innerSpecification, resultAdded);
        observer.start();
        return observer;
    }

    /**
     * Request server-sent events when a fact affects query results.
     * While the subscription is active, the server will push matching facts
     * to the client. Call Subscription.stop() to stop receiving events.
     * 
     * @param start A fact from which to begin the subscription
     * @param preposition A template function passed into j.for
     * @returns A subscription, which remains running until you call stop
     */
    subscribe<T, U>(
        start: T,
        preposition: Preposition<T, U>
    ): Subscription {
        if (!start) {
            return new SubscriptionNoOp();
        }
        const fact = JSON.parse(JSON.stringify(start));
        this.validateFact(fact);
        const reference = dehydrateReference(fact);
        const query = new Query(preposition.steps);
        const channel = this.authentication.addChannel(reference, query);
        const subscription = new SubscriptionImpl(channel, this.authentication);
        return subscription;
    }

    service<T, U>(
        start: T,
        preposition: Preposition<T, U>,
        handler: (message: U) => Promise<void>
    ) {
        if (!start) {
            return;
        }
        const fact = JSON.parse(JSON.stringify(start));
        this.validateFact(fact);
        const reference = dehydrateReference(fact);
        const query = new Query(preposition.steps);
        const feed = this.authentication;
        const serviceRunner = this.serviceRunner;
        runService<U>(feed, reference, query, serviceRunner, handler);
    }

    async stop() {
        await this.serviceRunner.all();
    }

    /**
     * Prepare a template function to be used in query or watch.
     * 
     * @param specification A template function, which returns j.match
     * @returns A preposition that can be passed to query or watch, or used to construct a preposition chain
     */
    static for<T, U>(specification: (target : T) => OldSpecificationOf<U>) : Preposition<T, U> {
        return Preposition.for(specification);
    }

    /**
     * Prepare a template function to be used in query or watch.
     * 
     * @param specification A template function, which returns j.match
     * @returns A preposition that can be passed to query or watch, or used to construct a preposition chain
     */
    for<T, U>(specification: (target : T) => OldSpecificationOf<U>) : Preposition<T, U> {
        return Jinaga.for(specification);
    }

    /**
     * Used within a template function to specify the shape of the target facts.
     * 
     * @param template A JSON object with the desired type and predecessors
     * @returns A specification that can be used by query or watch
     */
    static match<T>(template: Template<T>): OldSpecificationOf<T> {
        return new OldSpecificationOf<T>(template,[]);
    }

    /**
     * Used within a template function to specify the shape of the target facts.
     * 
     * @param template A JSON object with the desired type and predecessors
     * @returns A specification that can be used by query or watch
     */
    match<T>(template: Template<T>): OldSpecificationOf<T> {
        return Jinaga.match(template);
    }

    /**
     * Used in a template function to create a condition that is true if a matching fact exists.
     * 
     * @param template A JSON object with the desired type and predecessors
     * @returns A condition that can be used in suchThat or not
     */
    static exists<T>(template: Template<T>): ConditionOf<T> {
        return new ConditionOf<T>(template, [], false);
    }

    /**
     * Used in a template function to create a condition that is true if a matching fact exists.
     * 
     * @param template A JSON object with the desired type and predecessors
     * @returns A condition that can be used in suchThat or not
     */
    exists<T>(template: Template<T>): ConditionOf<T> {
        return Jinaga.exists(template);
    }

    /**
     * Used in a template function to create a condition that is true if no matching fact exists.
     * 
     * @param template A JSON object with the desired type and predecessors
     * @returns A condition that can be used in suchThat or not
     */
    static notExists<T>(template: Template<T>): ConditionOf<T> {
        return new ConditionOf<T>(template, [], true);
    }

    /**
     * Used in a template function to create a condition that is true if no matching fact exists.
     * 
     * @param template A JSON object with the desired type and predecessors
     * @returns A condition that can be used in suchThat or not
     */
    notExists<T>(template: Template<T>): ConditionOf<T> {
        return Jinaga.notExists(template);
    }

    /**
     * Inverts a condition defined using exists or notExists.
     * 
     * @param condition A template function using exists or notExists to invert
     * @returns The opposite condition
     */
    static not<T, U>(condition: (target: T) => ConditionOf<U>) : (target: T) => ConditionOf<U> {
        return target => {
            const original = condition(target);
            return new ConditionOf<U>(original.template, original.conditions, !original.negative);
        };
    }

    /**
     * Inverts a condition defined using exists or notExists.
     * 
     * @param condition A template function using exists or notExists to invert
     * @returns The opposite condition
     */
    not<T, U>(condition: (target: T) => ConditionOf<U>) : (target: T) => ConditionOf<U> {
        return Jinaga.not(condition);
    }

    static hash<T extends Object>(fact: T) {
        const hash = lookupHash(fact);
        if (hash) {
            return hash;
        }
        const reference = dehydrateReference(fact);
        return reference.hash;
    }

    hash<T extends Object>(fact: T) {
        return Jinaga.hash(fact);
    }

    private validateFact(prototype: HashMap) {
        if (!prototype) {
            throw new Error('A fact or any of its predecessors cannot be null.')
        }
        if (!('type' in prototype)) {
            throw new Error('Specify the type of the fact and all of its predecessors.');
        }
        for (const field in prototype) {
            const value = toJSON(prototype[field]);
            if (typeof(value) === 'object') {
                if (Array.isArray(value)) {
                    value
                        .filter(element => element)
                        .forEach(element => this.validateFact(element));
                }
                else {
                    this.validateFact(value);
                }
            }
            else if (typeof(value) === 'function') {
                throw new Error(`A fact may not have any methods: ${field} in ${prototype.type} is a function.`);
            }
        }
    }

    private error(error: any) {
        Trace.error(error);
        this.errorHandlers.forEach((errorHandler) => {
            errorHandler(error);
        });
    }
}

function extractResults(projectedResults: ProjectedResult[], projection: Projection) {
    const results = [];
    for (const projectedResult of projectedResults) {
        let result = projectedResult.result;
        if (projection.type === "composite") {
            const obj: any = {};
            for (const component of projection.components) {
                const value = result[component.name];
                if (component.type === "specification") {
                    obj[component.name] = extractResults(value, component.projection);
                }
                else {
                    obj[component.name] = value;
                }
            }
            result = obj;
        }
        results.push(result);
    }
    return results;
}
