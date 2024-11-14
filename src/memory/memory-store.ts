import { hydrateFromTree } from '../fact/hydrate';
import { Specification } from "../specification/specification";
import { SpecificationRunner } from '../specification/specification-runner';
import { FactEnvelope, FactFeed, FactRecord, FactReference, ProjectedResult, Storage, factEnvelopeEquals, factReferenceEquals } from '../storage';

export function getPredecessors(fact: FactRecord | null, role: string) {
    if (!fact) {
        return [];
    }
    
    const predecessors = fact.predecessors[role];
    if (predecessors) {
        if (Array.isArray(predecessors)) {
            return predecessors;
        }
        else {
            return [ predecessors ];
        }
    }
    else {
        return [];
    }
}

function loadAll(references: FactReference[], source: FactEnvelope[], target: FactEnvelope[]) {
    references.forEach(reference => {
        const predicate = factEnvelopeEquals(reference);
        if (!target.some(predicate)) {
            const record = source.find(predicate);
            if (record) {
                target.push(record);
                for (const role in record.fact.predecessors) {
                    const predecessors = getPredecessors(record.fact, role);
                    loadAll(predecessors, source, target);
                }
            }
        }
    });
}

export class MemoryStore implements Storage {
    private factEnvelopes: FactEnvelope[] = [];
    private bookmarksByFeed: { [feed: string]: string } = {};
    private runner: SpecificationRunner;
    private mruDateBySpecificationHash: { [specificationHash: string]: Date } = {};

    constructor() {
        this.runner = new SpecificationRunner({
            getPredecessors: this.getPredecessors.bind(this),
            getSuccessors: this.getSuccessors.bind(this),
            findFact: this.findFact.bind(this),
            hydrate: this.hydrate.bind(this)
        });
    }

    close(): Promise<void> {
        return Promise.resolve();
    }

    save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
        const added: FactEnvelope[] = [];
        for (const envelope of envelopes) {
            const isFact = factReferenceEquals(envelope.fact);
            const existing = this.factEnvelopes.find(e => isFact(e.fact));
            if (!existing) {
                this.factEnvelopes.push(envelope);
                added.push(envelope);
            }
            else {
                const newSignatures = envelope.signatures.filter(s =>
                    !existing.signatures.some(s2 => s2.publicKey === s.publicKey));
                if (newSignatures.length > 0) {
                    existing.signatures = [ ...existing.signatures, ...newSignatures ];
                }
            }
        }
        return Promise.resolve(added);
    }

    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        return this.runner.read(start, specification);
    }

    feed(feed: Specification, start: FactReference[], bookmark: string): Promise<FactFeed> {
        throw new Error('Method not implemented.');
    }

    whichExist(references: FactReference[]): Promise<FactReference[]> {
        const existing = references.filter(reference => {
            return this.factEnvelopes.some(factEnvelopeEquals(reference));
        });
        return Promise.resolve(existing);
    }

    load(references: FactReference[]): Promise<FactEnvelope[]> {
        const target: FactEnvelope[] = [];
        loadAll(references, this.factEnvelopes, target);
        return Promise.resolve(target);
    }

    purge(purgeConditions: Specification[]): Promise<void> {
        // Not yet implemented
        return Promise.resolve();
    }

    loadBookmark(feed: string): Promise<string> {
        const bookmark = this.bookmarksByFeed.hasOwnProperty(feed) ? this.bookmarksByFeed[feed] : '';
        return Promise.resolve(bookmark);
    }
    
    saveBookmark(feed: string, bookmark: string): Promise<void> {
        this.bookmarksByFeed[feed] = bookmark;
        return Promise.resolve();
    }
    
    getMruDate(specificationHash: string): Promise<Date | null> {
        const mruDate: Date | null = this.mruDateBySpecificationHash[specificationHash] ?? null;
        return Promise.resolve(mruDate);
    }

    setMruDate(specificationHash: string, mruDate: Date): Promise<void> {
        this.mruDateBySpecificationHash[specificationHash] = mruDate;
        return Promise.resolve();
    }

    private findFact(reference: FactReference): Promise<FactRecord | null> {
        const envelope = this.factEnvelopes.find(factEnvelopeEquals(reference)) ?? null;
        return Promise.resolve(envelope?.fact ?? null);
    }

    private getPredecessors(reference: FactReference, name: string, predecessorType: string): Promise<FactReference[]> {
        const record = this.factEnvelopes.find(factEnvelopeEquals(reference)) ?? null;
        if (record === null) {
            throw new Error(`The fact ${reference.type}:${reference.hash} is not defined.`);
        }
        const predecessors = getPredecessors(record.fact, name);
        const matching = predecessors.filter(predecessor => predecessor.type === predecessorType);
        return Promise.resolve(matching);
    }
    
    private getSuccessors(reference: FactReference, name: string, successorType: string): Promise<FactReference[]> {
        const successors = this.factEnvelopes.filter(record => record.fact.type === successorType &&
            getPredecessors(record.fact, name).some(factReferenceEquals(reference)))
            .map(e => e.fact);
        return Promise.resolve(successors);
    }

    private hydrate(reference: FactReference) {
        const fact = hydrateFromTree([reference], this.factEnvelopes.map(e => e.fact));
        if (fact.length === 0) {
            throw new Error(`The fact ${reference} is not defined.`);
        }
        if (fact.length > 1) {
            throw new Error(`The fact ${reference} is defined more than once.`);
        }
        return Promise.resolve(fact[0]);
    }
}