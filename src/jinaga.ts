import { Authentication } from "./authentication/authentication";
import { dehydrateReference, Dehydration, HashMap, hydrate, hydrateFromTree, lookupHash } from './fact/hydrate';
import { SyncStatus, SyncStatusNotifier } from './http/web-client';
import { FactManager } from './managers/factManager';
import { User } from './model/user';
import { ObservableCollection, Observer, ResultAddedFunc } from './observer/observer';
import { SpecificationOf } from './specification/model';
import { Projection } from './specification/specification';
import { FactEnvelope, ProjectedResult } from './storage';
import { toJSON } from './util/obj';
import { Trace } from './util/trace';
    
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

        if (!given || given.some(g => !g)) {
            return [];
        }
        if (given.length !== innerSpecification.given.length) {
            throw new Error(`Expected ${innerSpecification.given.length} given facts, but received ${given.length}.`);
        }

        const references = given.map(g => {
            const fact = JSON.parse(JSON.stringify(g));
            const validatedFact = this.validateFact(fact);
            return dehydrateReference(validatedFact);
        });
        await this.factManager.fetch(references, innerSpecification);
        const projectedResults = await this.factManager.read(references, innerSpecification);
        const extracted = extractResults(projectedResults, innerSpecification.projection);
        Trace.counter("facts_loaded", extracted.totalCount);
        return extracted.results;
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

        const references = given.map(g => {
            const fact = JSON.parse(JSON.stringify(g));
            const validatedFact = this.validateFact(fact);
            return dehydrateReference(validatedFact);
        });

        return this.factManager.startObserver<U>(references, innerSpecification, resultAdded, false);
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

        const references = given.map(g => {
            const fact = JSON.parse(JSON.stringify(g));
            const validatedFact = this.validateFact(fact);
            return dehydrateReference(validatedFact);
        });

        return this.factManager.startObserver<U>(references, innerSpecification, resultAdded, true);
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
     * Compute the SHA-256 hash of a fact.
     * This is a deterministic hash that can be used to identify the fact.
     * @param fact The fact to hash
     * @returns The SHA-256 hash of the fact as a base-64 string
     */
    hash<T extends Fact>(fact: T) {
        return Jinaga.hash(fact);
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
        if (typeof fact !== 'object' || Array.isArray(fact)) {
            return fact; // Let the validator report the error
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
}

function extractResults(projectedResults: ProjectedResult[], projection: Projection) {
    const results = [];
    let totalCount = 0;
    for (const projectedResult of projectedResults) {
        let result = projectedResult.result;
        if (projection.type === "composite") {
            const obj: any = {};
            for (const component of projection.components) {
                const value = result[component.name];
                if (component.type === "specification") {
                    const { results: nestedResults, totalCount: nestedCount } = extractResults(value, component.projection);
                    obj[component.name] = nestedResults;
                    totalCount += nestedCount;
                }
                else {
                    obj[component.name] = value;
                }
            }
            result = obj;
        }
        results.push(result);
        totalCount++;
    }
    return { results, totalCount };
}
