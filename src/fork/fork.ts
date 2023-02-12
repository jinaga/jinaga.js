import { Observable } from "../observable/observable";
import { Query } from "../query/query";
import { FactEnvelope, FactPath, FactRecord, FactReference } from "../storage";
import { Channel } from "./channel";

export interface Fork {
    addChannel(fact: FactReference, query: Query): Channel;
    removeChannel(channel: Channel): void;
    decorateObservable(fact: FactReference, query: Query, observable: Observable): Observable;
    save(envelopes: FactEnvelope[]): Promise<void>;
    query(start: FactReference, query: Query): Promise<FactPath[]>;
    load(references: FactReference[]): Promise<FactRecord[]>;
    close(): Promise<void>;
}