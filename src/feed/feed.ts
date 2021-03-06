import { Query } from '../query/query';
import { FactPath, FactReference, Storage } from '../storage';

export interface Subscription {
    load(): Promise<void>;
    dispose(): void;
}

export type Handler = (paths: FactPath[]) => Promise<void>;

export interface Observable {
    subscribe(added: Handler, removed: Handler): Subscription;
}

export interface Feed extends Storage {
    from(fact: FactReference, query: Query): Observable;
}