import { TopologicalSorter } from '../fact/sorter';
import { WebClient } from '../http/web-client';
import { FactEnvelope, FactRecord, FactReference, factReferenceEquals, Queue, Storage } from '../storage';
import { Trace } from '../util/trace';
import { Fork } from "./fork";
import { serializeLoad, serializeSave } from './serialize';

export class PersistentFork implements Fork {
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

    async load(references: FactReference[]): Promise<FactEnvelope[]> {
        const known = await this.storage.load(references);
        const remaining = references.filter(reference => !known.some(e => factReferenceEquals(reference)(e.fact)));
        if (remaining.length === 0) {
            return known;
        }
        else {
            const records = await this.loadEnvelopes(remaining);
            return records.concat(known);
        }
    }

    private async loadEnvelopes(references: FactReference[]) {
        const sorter = new TopologicalSorter<FactRecord>();
        let loaded: FactEnvelope[] = [];
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
            loaded = loaded.concat(envelopes);
        }
        return loaded;
    }

    private sendAndDequeue(envelopes: FactEnvelope[]) {
        (async () => {
            await this.client.saveWithRetry(serializeSave(envelopes));
            await this.queue.dequeue(envelopes);
        })().catch(err => Trace.error(err));
    }
}