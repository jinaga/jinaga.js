import { FactRecord, FactReference, PredecessorCollection } from '../storage';
import { toJSON } from '../util/obj';
import { computeHash } from './hash';

export type HashMap = { [key: string]: any };

type DehydrationEntry = {
    fact: HashMap,
    record: FactRecord,
    reference: FactReference
};

export class Dehydration {
    private entries : DehydrationEntry[] = [];

    factRecords() {
        return this.entries.map(entry => entry.record);
    }

    dehydrate(fact: HashMap) {
        const entry = this.entries.find(entry => {
            return entry.fact === fact;
        });

        if (entry) {
            return entry.reference;
        }

        const record = this.createFactRecord(fact);
        const reference = {
            type: record.type,
            hash: record.hash
        };
        if (!this.entries.find(entry => {
            return entry.reference.hash === reference.hash &&
                entry.reference.type === reference.type;
        })) {
            this.entries.push({ fact, record, reference });
        }

        return reference;
    }

    private createFactRecord(fact: HashMap): FactRecord {
        let type: string | null = null;
        let fields: HashMap = {};
        let predecessors: PredecessorCollection = {};
        for (let field in fact) {
            const value = toJSON(fact[field]);
            if (value === null || value === undefined) {
                // Skip
            }
            else if (field === 'type' && typeof(value) === 'string') {
                type = value;
            }
            else if (typeof(value) === 'object') {
                if (Array.isArray(value)) {
                    predecessors[field] = value
                        .filter(element => element)
                        .map(element => this.dehydrate(element));
                }
                else {
                    predecessors[field] = this.dehydrate(value);
                }
            }
            else {
                fields[field] = value;
            }
        }
        const hash = computeHash(fields, predecessors);
        if (!type) {
            throw new Error('Specify the type of the fact and all of its predecessors.');
        }
        return { type, hash, predecessors, fields };
    }
}

type HydrationEntry = {
    record: FactRecord,
    fact: HashMap | null
}

export const hashSymbol = typeof(Symbol) === "undefined" ? null : Symbol("hash");

export class Hydration {
    private entries: HydrationEntry[];

    constructor(records: FactRecord[]) {
        this.entries = records.map(r => {
            return {
                record: r,
                fact: null
            };
        });
    }

    hydrate(reference: FactReference): HashMap {
        const entry = this.entries.find(r => r.record.hash === reference.hash && r.record.type === reference.type);
        if (!entry) {
            throw new Error('Referenced fact not found in tree');
        }

        if (entry.fact) {
            return entry.fact;
        }

        const fields: HashMap = entry.record.fields;
        let fact: HashMap = {};
        for (const field in fields) {
            fact[field] = fields[field];
        }
        fact.type = entry.record.type;
    
        for (const role in entry.record.predecessors) {
            const value = entry.record.predecessors[role];
            fact[role] = this.hydratePredecessors(value);
        }

        entry.fact = fact;

        if (hashSymbol) {
            (fact as any)[hashSymbol] = reference.hash;
        }
        return fact;
    }

    private hydratePredecessors(references: FactReference | FactReference[]): HashMap | HashMap[] {
        if (Array.isArray(references)) {
            return references.map(p => this.hydrate(p));
        }
        else {
            return this.hydrate(references);
        }
    }
}

export function lookupHash<T extends Object>(fact: T) {
    return hashSymbol && (fact as any)[hashSymbol] as string;
}

export function hydrate<T>(record: FactRecord) {
    const fact: any = {
        ...record.fields,
        type: record.type
    };
    return <T>fact;
}

export function hydrateFromTree<T>(references: FactReference[], records: FactRecord[]) {
    const hydration = new Hydration(records);
    return references.map(r => {
        try {
            return <T>hydration.hydrate(r);
        }
        catch (e) {
            return null;
        }
    }).filter(f => f) as T[];
}

export function dehydrateFact(fact: HashMap): FactRecord[] {
    const dehydration = new Dehydration();
    dehydration.dehydrate(fact);
    return dehydration.factRecords();
}

export function dehydrateReference(fact: HashMap): FactReference {
    const dehydration = new Dehydration();
    return dehydration.dehydrate(fact);
}