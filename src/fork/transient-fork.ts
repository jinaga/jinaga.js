import { TopologicalSorter } from '../fact/sorter';
import { WebClient } from '../http/web-client';
import { Handler, Observable, ObservableSource, ObservableSubscription, SpecificationListener } from '../observable/observable';
import { Query } from '../query/query';
import { Feed } from "../specification/feed";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactFeed, FactRecord, FactReference, factReferenceEquals, ProjectedResult } from '../storage';
import { flatten } from '../util/fn';
import { Channel } from "./channel";
import { ChannelProcessor } from "./channel-processor";
import { Fork } from "./fork";
import { serializeLoad, serializeQuery, serializeSave } from './serialize';

class TransientForkSubscription implements ObservableSubscription {
    constructor(
        private inner: ObservableSubscription,
        private loaded: Promise<void>
    ) {}

    async load(): Promise<void> {
        await this.inner.load();
        await this.loaded;
    }

    dispose(): void {
        return this.inner.dispose();
    }
}

class TransientForkObservable implements Observable {
    constructor(
        private inner: Observable,
        private loaded: Promise<void>
    ) {}

    subscribe(added: Handler, removed: Handler): ObservableSubscription {
        return new TransientForkSubscription(this.inner.subscribe(added, removed), this.loaded);
    }
}

export class TransientFork implements Fork {
    private channels: Channel[] = [];
    private channelProcessor: ChannelProcessor | null = null;

    constructor(
        private observableSource: ObservableSource,
        private client: WebClient
    ) {
        
    }

    async close() {
        if (this.channelProcessor) {
            this.channelProcessor.stop();
        }
        this.channelProcessor = null;
        this.channels = [];
        await this.observableSource.close();
    }

    async save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        await this.client.save(serializeSave(envelopes));
        const saved = await this.observableSource.save(envelopes);
        return saved;
    }

    async query(start: FactReference, query: Query) {
        if (query.isDeterministic()) {
            const results = await this.observableSource.query(start, query);
            return results;
        }
        else {
            const response = await this.client.query(serializeQuery(start, query));
            return response.results;
        }
    }

    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        throw new Error('Method not implemented.');
    }

    feed(feed: Feed, bookmark: string): Promise<FactFeed> {
        return this.observableSource.feed(feed, bookmark);
    }

    whichExist(references: FactReference[]): Promise<FactReference[]> {
        return this.observableSource.whichExist(references);
    }

    async load(references: FactReference[]): Promise<FactRecord[]> {
        const known = await this.observableSource.load(references);
        const remaining = references.filter(reference => !known.some(factReferenceEquals(reference)));
        if (remaining.length === 0) {
            return known;
        }
        else {
            const records = await this.loadRecords(remaining);
            return records.concat(known);
        }
    }

    from(fact: FactReference, query: Query): Observable {
        const observable = this.observableSource.from(fact, query);
        const loaded = this.initiateQuery(fact, query);
        return new TransientForkObservable(observable, loaded);
    }

    addSpecificationListener(specification: Specification, onResult: (results: ProjectedResult[]) => Promise<void>) {
        return this.observableSource.addSpecificationListener(specification, onResult);
    }

    removeSpecificationListener(listener: SpecificationListener) {
        return this.observableSource.removeSpecificationListener(listener);
    }

    addChannel(fact: FactReference, query: Query): Channel {
        const channel = new Channel(() => this.initiateQuery(fact, query));
        this.channels = [...this.channels, channel];
        if (this.channelProcessor) {
            this.channelProcessor.stop();
        }
        this.channelProcessor = new ChannelProcessor(this.channels);
        this.channelProcessor.start();
        return channel;
    }

    removeChannel(channel: Channel) {
        this.channels = this.channels.filter(c => c !== channel);
        if (this.channelProcessor) {
            this.channelProcessor.stop();
            this.channelProcessor = null;
        }
        if (this.channels.length > 0) {
            this.channelProcessor = new ChannelProcessor(this.channels);
            this.channelProcessor.start();
        }
    }

    private async initiateQuery(start: FactReference, query: Query) {
        const queryResponse = await this.client.query(serializeQuery(start, query));
        const paths = queryResponse.results;
        if (paths.length > 0) {
            const references = distinct(flatten(paths, p => p));
            await this.load(references);
        }
    }

    private async loadRecords(references: FactReference[]) {
        const sorter = new TopologicalSorter<FactRecord>();
        let records: FactRecord[] = [];
        for (let start = 0; start < references.length; start += 300) {
            const chunk = references.slice(start, start + 300);
            const response = await this.client.load(serializeLoad(chunk));
            const facts = sorter.sort(response.facts, (p, f) => f);
            const envelopes = facts.map(fact => {
                return <FactEnvelope>{
                    fact: fact,
                    signatures: []
                };
            });
            await this.observableSource.save(envelopes);
            records = records.concat(facts);
        }
        return records;
    }
}

function distinct(references: FactReference[]) {
    const result: FactReference[] = [];
    references.forEach(reference => {
        if (!result.some(r => r.hash === reference.hash && r.type === reference.type)) {
            result.push(reference);
        }
    })
    return result;
}