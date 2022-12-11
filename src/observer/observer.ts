import { Specification } from "../specification/specification";
import { FactReference } from "../storage";
import { Authentication } from "../authentication/authentication";

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

    constructor(
        private authentication: Authentication,
        private given: FactReference[],
        private specification: Specification,
        private resultAdded: ResultAddedFunc<T>
    ) { }

    public start() {
        this.initialQuery = this.runInitialQuery();
    }

    public initialized(): Promise<void> {
        if (this.initialQuery === undefined) {
            throw new Error("The observer has not been started.");
        }
        return this.initialQuery;
    }

    public stop(): Promise<void> {
        return Promise.resolve();
    }

    private async runInitialQuery() {
        const results: T[] = await this.authentication.read(this.given, this.specification);
        for (const result of results) {
            await this.resultAdded(result);
        }
    }
}