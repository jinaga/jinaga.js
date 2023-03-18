import { TopologicalSorter } from '../fact/sorter';
import { WebClient } from '../http/web-client';
import { Handler, Observable, ObservableSubscription } from '../observable/observable';
import { Query } from '../query/query';
import { FactEnvelope, FactRecord, FactReference, factReferenceEquals, Queue, Storage } from '../storage';
import { flatten } from '../util/fn';
import { Trace } from '../util/trace';
import { Channel } from "./channel";
import { ChannelProcessor } from "./channel-processor";
import { Fork } from "./fork";
import { serializeLoad, serializeQuery, serializeSave } from './serialize';

class PersistentForkSubscription implements ObservableSubscription {
    constructor(
        private inner: ObservableSubscription,
        private loadedLocal: Promise<void>,
        private loadedRemote: Promise<void>
    ) {}

    async load(): Promise<void> {
        await this.inner.load();
        await this.loadedLocal;
    }

    dispose(): void {
        return this.inner.dispose();
    }
}

class PersistentForkObservable implements Observable {
    constructor(
        private inner: Observable,
        private loadedLocal: Promise<void>,
        private loadedRemote: Promise<void>
    ) {}

    subscribe(added: Handler, removed: Handler): ObservableSubscription {
        return new PersistentForkSubscription(this.inner.subscribe(added, removed), this.loadedLocal, this.loadedRemote);
    }
}

export class PersistentFork implements Fork {
    private channels: Channel[] = [];
    private channelProcessor: ChannelProcessor | null = null;

    constructor(
        private storage: Storage,
        private queue: Queue,
        private client: WebClient
    ) {
        
    }

    initialize() {
        (async () => {
            const envelopes = await this.queue.peek();
            this.sendAndDequeue(envelopes);
        })().catch(err => Trace.error(err));
    }

    close(): Promise<void> {
        return Promise.resolve();
    }

    async save(envelopes: FactEnvelope[]): Promise<void> {
        await this.queue.enqueue(envelopes);
        this.sendAndDequeue(envelopes);
    }

    async query(start: FactReference, query: Query) {
        if (query.isDeterministic()) {
            const results = await this.storage.query(start, query);
            return results;
        }
        else {
            try {
                const response = await this.client.queryWithRetry(serializeQuery(start, query));
                return response.results;
            }
            catch (errRemote) {
                try {
                    const results = await this.storage.query(start, query);
                    return results;
                }
                catch (errLocal) {
                    throw errRemote;
                }
            }
        }
    }

    async load(references: FactReference[]): Promise<FactRecord[]> {
        const known = await this.storage.load(references);
        const remaining = references.filter(reference => !known.some(factReferenceEquals(reference)));
        if (remaining.length === 0) {
            return known;
        }
        else {
            const records = await this.loadRecords(remaining);
            return records.concat(known);
        }
    }

    decorateObservable(fact: FactReference, query: Query, observable: Observable) {
        const loadedLocal = this.initiateQueryLocal(fact, query);
        const loadedRemote = this.initiateQueryRemote(fact, query);
        return new PersistentForkObservable(observable, loadedLocal, loadedRemote);
    }

    addChannel(fact: FactReference, query: Query): Channel {
        const channel = new Channel(() => this.initiateQueryRemote(fact, query));
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

    private async initiateQueryLocal(start: FactReference, query: Query) {
      const paths = await this.storage.query(start, query);
      if (paths.length > 0) {
        const references = distinct(flatten(paths, p => p));
        await this.load(references);
      }
    }

    private async initiateQueryRemote(start: FactReference, query: Query) {
        const queryResponse = await this.client.queryWithRetry(serializeQuery(start, query));
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
            const response = await this.client.loadWithRetry(serializeLoad(chunk));
            const facts = sorter.sort(response.facts, (p, f) => f);
            const envelopes = facts.map(fact => {
                return <FactEnvelope>{
                    fact: fact,
                    signatures: []
                };
            });
            await this.storage.save(envelopes);
            records = records.concat(facts);
        }
        return records;
    }

    private sendAndDequeue(envelopes: FactEnvelope[]) {
        (async () => {
            await this.client.saveWithRetry(serializeSave(envelopes));
            await this.queue.dequeue(envelopes);
        })().catch(err => Trace.error(err));
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