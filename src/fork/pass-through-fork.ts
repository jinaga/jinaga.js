import { Observable, ObservableSource } from "../observable/observable";
import { Query } from "../query/query";
import { FactEnvelope, FactPath, FactRecord, FactReference } from "../storage";
import { Channel } from "./channel";
import { Fork } from "./fork";

export class PassThroughFork implements Fork {
    constructor(
        private inner: ObservableSource
    ) { }

    async close(): Promise<void> {
        return Promise.resolve();
    }

    decorateObservable(fact: FactReference, query: Query, observable: Observable): Observable {
        return observable;
    }

    save(envelopes: FactEnvelope[]): Promise<void> {
        return Promise.resolve();
    }

    query(start: FactReference, query: Query): Promise<FactPath[]> {
        return this.inner.query(start, query);
    }

    load(references: FactReference[]): Promise<FactRecord[]> {
        return this.inner.load(references);
    }

    addChannel(fact: FactReference, query: Query): Channel {
        return Channel.NoOp;
    }

    removeChannel(channel: Channel): void {
    }
}