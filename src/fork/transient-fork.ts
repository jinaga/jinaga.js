import { TopologicalSorter } from '../fact/sorter';
import { WebClient } from '../http/web-client';
import { FactEnvelope, FactRecord, FactReference, factReferenceEquals, Storage } from '../storage';
import { Fork } from "./fork";
import { serializeLoad, serializeSave } from './serialize';

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
        await this.client.save(serializeSave(envelopes));
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
            await this.storage.save(envelopes);
            records = records.concat(facts);
        }
        return records;
    }
}