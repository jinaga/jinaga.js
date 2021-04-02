import { Feed, Observable } from "../feed/feed";
import { Query } from "../query/query";
import { FactReference, FactEnvelope, FactPath, FactRecord } from "../storage";
import { Channel } from "./channel";
import { Fork } from "./fork";

export class PassThroughFork implements Fork {
    constructor(
        private inner: Feed
    ) { }

    from(fact: FactReference, query: Query): Observable {
        return this.inner.from(fact, query);
    }

    save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        return this.inner.save(envelopes);
    }

    query(start: FactReference, query: Query): Promise<FactPath[]> {
        return this.inner.query(start, query);
    }

    exists(fact: FactReference): Promise<boolean> {
        return this.inner.exists(fact);
    }

    load(references: FactReference[]): Promise<FactRecord[]> {
        return this.inner.load(references);
    }

    addChannel(fact: FactReference, query: Query): Channel {
        return null;
    }

    removeChannel(channel: Channel): void {
    }

}