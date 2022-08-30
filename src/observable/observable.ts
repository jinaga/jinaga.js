import { Query } from '../query/query';
import { FactPath, FactReference, Storage } from '../storage';

export interface ObservableSubscription {
    load(): Promise<void>;
    dispose(): void;
}

export type Handler = (paths: FactPath[]) => Promise<void>;

export interface Observable {
    subscribe(added: Handler, removed: Handler): ObservableSubscription;
}

export interface ObservableSource extends Storage {
    from(fact: FactReference, query: Query): Observable;
}