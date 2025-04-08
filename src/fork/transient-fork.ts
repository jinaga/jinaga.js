import { TopologicalSorter } from '../fact/sorter';
import { WebClient } from '../http/web-client';
import { FactEnvelope, factEnvelopeEquals, FactRecord, FactReference, Storage } from '../storage';
import { Trace } from "../util/trace";
import { Fork } from "./fork";
import { serializeLoad } from './serialize';

export class TransientFork implements Fork {
    constructor(
        private storage: Storage,
        private client: WebClient
    ) {
        
    }

    close() {
        return Promise.resolve();
    }

    async save(envelopes: FactEnvelope[]): Promise<void> {
        await this.client.save(envelopes);
    }

    async load(references: FactReference[]): Promise<FactEnvelope[]> {
        const known = await this.storage.load(references);
        const remaining = references.filter(reference => !known.some(factEnvelopeEquals(reference)));
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
            const response = await this.client.load(serializeLoad(chunk));
            const facts = sorter.sort(response.facts, (p, f) => f);
            const envelopes = facts.map(fact => {
                return <FactEnvelope>{
                    fact: fact,
                    signatures: []
                };
            });
            const saved = await this.storage.save(envelopes);
            if (saved.length > 0) {
                Trace.counter("facts_saved", saved.length);
            }
            loaded = loaded.concat(envelopes);
        }
        return loaded;
    }

    processQueueNow(): Promise<void> {
        // No-op for transient fork
        return Promise.resolve();
    }
}