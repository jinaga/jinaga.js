import { computeObjectHash } from "../fact/hash";
import { FactManager } from "../managers/factManager";
import { SpecificationListener } from "../observable/observable";
import { describeDeclaration, describeSpecification } from "../specification/description";
import { invertSpecification, SpecificationInverse } from "../specification/inverse";
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

    constructor(
        private factManager: FactManager,
        private given: FactReference[],
        private specification: Specification,
        resultAdded: ResultAddedFunc<T>
    ) {
        // Map the given facts to a tuple.
        const tuple = specification.given.reduce((tuple, label, index) => ({
            ...tuple,
            [label.name]: given[index]
        }), {} as ReferencesByName);
        this.givenHash = computeObjectHash(tuple);

        // Add the initial handler.
        this.addedHandlers.push({
            path: "",
            tupleHash: this.givenHash,
            handler: resultAdded
        });

        // Identify the specification by its hash.
        const declarationString = describeDeclaration(given, specification.given);
        const specificationString = describeSpecification(specification, 0);
        const request = `${declarationString}\n${specificationString}`;
        this.specificationHash = computeStringHash(request);
    }

    public start() {
        this.cachedPromise = new Promise((cacheResolve, _) => {
            this.loadedPromise = new Promise(async (loadResolve, loadReject) => {
                try {
                    const mruDate: Date | null = await this.factManager.getMruDate(this.specificationHash);
                    if (mruDate === null) {
                        // The data is not yet cached.
                        cacheResolve(false);
                        // Fetch from the server and then read from local storage.
                        await this.fetch();
                        await this.read();
                        loadResolve();
                    }
                    else {
                        // Read from local storage into the cache.
                        await this.read();
                        cacheResolve(true);
                        // Then fetch from the server to update the cache.
                        await this.fetch();
                        loadResolve();
                    }
                    await this.factManager.setMruDate(this.specificationHash, new Date());
                }
                catch (e) {
                    cacheResolve(false);
                    loadReject(e);
                }
            });
        });
    }

    private addSpecificationListeners() {
        const inverses = invertSpecification(this.specification);
        const listeners = inverses.map(inverse => this.factManager.addSpecificationListener(
            inverse.inverseSpecification,
            (results) => this.onResult(inverse, results)
        ));
        this.listeners = listeners;
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
        for (const listener of this.listeners) {
            this.factManager.removeSpecificationListener(listener);
        }
    }

    private async fetch() {
        await this.factManager.fetch(this.given, this.specification);
    }

    private async read() {
        const projectedResults = await this.factManager.read(this.given, this.specification);
        this.addSpecificationListeners();
        const givenSubset = this.specification.given.map(g => g.name);
        await this.notifyAdded(projectedResults, this.specification.projection, "", givenSubset);
    }

    private async onResult(inverse: SpecificationInverse, results: ProjectedResult[]): Promise<void> {
        // Filter out results that do not match the given.
        const matchingResults = results.filter(pr =>
            this.givenHash === computeTupleSubsetHash(pr.tuple, inverse.givenSubset));
        if (matchingResults.length === 0) {
            return;
        }

        if (inverse.operation === "add") {
            return await this.notifyAdded(matchingResults, inverse.inverseSpecification.projection, inverse.path, inverse.parentSubset);
        }
        else if (inverse.operation === "remove") {
            return await this.notifyRemoved(inverse.resultSubset, matchingResults);
        }
        else {
            const _: never = inverse.operation;
            throw new Error(`Inverse operation ${inverse.operation} not implemented.`);
        }
    }

    private async notifyAdded(projectedResults: ProjectedResult[], projection: Projection, path: string, parentSubset: string[]) {
        for (const pr of projectedResults) {
            const result: any = this.injectObservers(pr, projection, path);
            const parentTupleHash = computeTupleSubsetHash(pr.tuple, parentSubset);
            const addedHandler = this.addedHandlers.find(h => h.tupleHash === parentTupleHash && h.path === path);
            const resultAdded = addedHandler?.handler;
            const tupleHash = computeObjectHash(pr.tuple);
            // Don't call result added if we have already called it for this tuple.
            if (resultAdded && this.notifiedTuples.has(tupleHash) === false) {
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
            }

            // Recursively notify added for specification results.
            if (projection.type === "composite") {
                for (const component of projection.components) {
                    if (component.type === "specification") {
                        const childPath = path + "." + component.name;
                        await this.notifyAdded(pr.result[component.name], component.projection, childPath, Object.keys(pr.tuple));
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
    
    private injectObservers(pr: ProjectedResult, projection: Projection, parentPath: string): any {
        if (projection.type === "composite") {
            const composite: any = {};
            for (const component of projection.components) {
                if (component.type === "specification") {
                    const path = parentPath + "." + component.name;
                    const observable: ObservableCollection<any> = {
                        onAdded: (handler: ResultAddedFunc<any>) => {
                            this.addedHandlers.push({
                                tupleHash: computeObjectHash(pr.tuple),
                                path: path,
                                handler: handler
                            });
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
