import { Observable } from "../observable/observable";
import { Query } from "../query/query";
import { FactEnvelope, FactPath, FactRecord, FactReference, Storage } from "../storage";
import { Channel } from "./channel";
import { Fork } from "./fork";

export class PassThroughFork implements Fork {
    constructor(
        private storage: Storage
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
        return this.storage.query(start, query);
    }

    load(references: FactReference[]): Promise<FactRecord[]> {
        return this.storage.load(references);
    }

    addChannel(fact: FactReference, query: Query): Channel {
        return Channel.NoOp;
    }

    removeChannel(channel: Channel): void {
    }
}