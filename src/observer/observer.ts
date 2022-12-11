import { Authentication } from "../authentication/authentication";
import { SpecificationListener } from "../observable/observable";
import { invertSpecification, SpecificationInverse } from "../specification/inverse";
import { Specification } from "../specification/specification";
import { FactReference } from "../storage";

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
            (results) => this.onResult(results)
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
        const results = projectedResults.map(pr => pr.result);
        for (const result of results) {
            await this.resultAdded(result);
        }
    }

    private async onResult(results: any[]): Promise<void> {
        throw new Error("Method not implemented.");
    }
}