import { Authentication } from "../authentication/authentication";
import { computeObjectHash } from "../fact/hash";
import { SpecificationListener } from "../observable/observable";
import { invertSpecification, SpecificationInverse } from "../specification/inverse";
import { Specification } from "../specification/specification";
import { FactReference, ProjectedResult, ReferencesByName } from "../storage";

export type ResultAddedFunc<U> = (value: U) =>
    Promise<() => Promise<void>> |  // Asynchronous with removal function
    Promise<void> |                 // Asynchronous without removal function
    (() => void) |                  // Synchronous with removal function
    void;                           // Synchronous without removal function


export interface Observer<T> {
    initialized(): Promise<void>;
    stop(): Promise<void>;
}

export class ObserverImpl<T> {
    private initialQuery: Promise<void> | undefined;
    private listeners: SpecificationListener[] = [];
    private removalsByTuple: {
        [tupleHash: string]: () => Promise<void>;
    } = {};

    constructor(
        private authentication: Authentication,
        private given: FactReference[],
        private specification: Specification,
        private resultAdded: ResultAddedFunc<T>
    ) { }

    public start() {
        this.initialQuery = this.runInitialQuery();
        const inverses: SpecificationInverse[] = invertSpecification(this.specification);
        const listeners = inverses.map(inverse => this.authentication.addSpecificationListener(
            inverse.specification,
            (results) => this.onResult(inverse, results)
        ));
        this.listeners = listeners;
    }

    public initialized(): Promise<void> {
        if (this.initialQuery === undefined) {
            throw new Error("The observer has not been started.");
        }
        return this.initialQuery;
    }

    public stop(): Promise<void> {
        for (const listener of this.listeners) {
            this.authentication.removeSpecificationListener(listener);
        }
        return Promise.resolve();
    }

    private async runInitialQuery() {
        const projectedResults = await this.authentication.read(this.given, this.specification);
        await this.notifyAdded(projectedResults);
    }

    private async onResult(inverse: SpecificationInverse, results: ProjectedResult[]): Promise<void> {
        if (inverse.operation === "add") {
            return await this.notifyAdded(results);
        }
        else if (inverse.operation === "remove") {
            return await this.notifyRemoved(inverse.parentSubset, results);
        }
        else {
            throw new Error(`Inverse operation ${inverse.operation} not implemented.`);
        }
    }

    private async notifyAdded(projectedResults: ProjectedResult[]) {
        for (const pr of projectedResults) {
            const promiseMaybe = this.resultAdded(pr.result);
            if (promiseMaybe instanceof Promise) {
                const functionMaybe = await promiseMaybe;
                if (functionMaybe instanceof Function) {
                    const tupleHash = computeObjectHash(pr.tuple);
                    this.removalsByTuple[tupleHash] = functionMaybe;
                }
            }
            else {
                const functionMaybe = promiseMaybe;
                if (functionMaybe instanceof Function) {
                    const tupleHash = computeObjectHash(pr.tuple);
                    this.removalsByTuple[tupleHash] = async () => {
                        functionMaybe();
                        return Promise.resolve();
                    };
                }
            }
        }
    }

    async notifyRemoved(parentSubset: string[], projectedResult: ProjectedResult[]): Promise<void> {
        for (const pr of projectedResult) {
            const parentTuple = Object.getOwnPropertyNames(pr.tuple)
                .filter(name => parentSubset.includes(name))
                .reduce((t, name) =>
                    ({
                        ...t,
                        [name]: pr.tuple[name]
                    }),
                    {} as ReferencesByName);
            const parentTupleHash = computeObjectHash(parentTuple);
            const removal = this.removalsByTuple[parentTupleHash];
            if (removal !== undefined) {
                await removal();
                delete this.removalsByTuple[parentTupleHash];
            }
        }
    }
}