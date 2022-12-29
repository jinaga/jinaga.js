import { Query } from '../query/query';
import { Specification } from '../specification/specification';
import { FactPath, FactReference, ProjectedResult, Storage } from '../storage';

export interface ObservableSubscription {
    load(): Promise<void>;
    dispose(): void;
}

export type Handler = (paths: FactPath[]) => Promise<void>;

export interface Observable {
    subscribe(added: Handler, removed: Handler): ObservableSubscription;
}

export interface SpecificationListener {
    onResult(results: ProjectedResult[]): Promise<void>;
}

export interface ObservableSource extends Storage {
    from(fact: FactReference, query: Query): Observable;
    addSpecificationListener(specification: Specification, onResult: (results: ProjectedResult[]) => Promise<void>): SpecificationListener;
    removeSpecificationListener(listener: SpecificationListener): void;
}