import { ObservableSource, Observable } from "../observable/observable";
import { Query } from "../query/query";
import { Feed } from "../specification/feed";
import { Specification } from "../specification/specification";
import { FactReference, FactEnvelope, FactPath, FactRecord, FactFeed } from "../storage";
import { Channel } from "./channel";
import { Fork } from "./fork";

export class PassThroughFork implements Fork {
    constructor(
        private inner: ObservableSource
    ) { }

    async close(): Promise<void> {
        await this.inner.close();
    }

    from(fact: FactReference, query: Query): Observable {
        return this.inner.from(fact, query);
    }

    save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        return this.inner.save(envelopes);
    }

    query(start: FactReference, query: Query): Promise<FactPath[]> {
        return this.inner.query(start, query);
    }

    read(start: FactReference[], specification: Specification): Promise<any[]> {
        return this.inner.read(start, specification);
    }

    feed(feed: Feed, bookmark: string): Promise<FactFeed> {
        return this.inner.feed(feed, bookmark);
    }

    whichExist(references: FactReference[]): Promise<FactReference[]> {
        return this.inner.whichExist(references);
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