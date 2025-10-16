import { hydrateFromTree } from '../fact/hydrate';
import { Specification } from "../specification/specification";
import { SpecificationRunner } from '../specification/specification-runner';
import { FactEnvelope, FactFeed, FactRecord, FactReference, ProjectedResult, Storage, factEnvelopeEquals, factReferenceEquals, FactTuple, uniqueFactReferences } from '../storage';

// Internal types for time projection support
type TimestampedFactRecord = FactRecord & { timestamp: Date };
type TimestampedFactEnvelope = { fact: TimestampedFactRecord; signatures: FactEnvelope['signatures'] };
type TimeProvider = () => Date;

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
    private factEnvelopes: TimestampedFactEnvelope[] = [];
    private bookmarksByFeed: { [feed: string]: string } = {};
    private runner: SpecificationRunner;
    private mruDateBySpecificationHash: { [specificationHash: string]: Date } = {};
    private timeProvider: TimeProvider;

    constructor(timeProvider?: TimeProvider) {
        this.timeProvider = timeProvider ?? (() => new Date());
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
        const timestamp = this.timeProvider();
        for (const envelope of envelopes) {
            const isFact = factReferenceEquals(envelope.fact);
            const existing = this.factEnvelopes.find(e => isFact(e.fact));
            if (!existing) {
                // Add timestamp to new facts
                const timestampedEnvelope: TimestampedFactEnvelope = {
                    fact: { ...envelope.fact, timestamp },
                    signatures: envelope.signatures
                };
                this.factEnvelopes.push(timestampedEnvelope);
                added.push(envelope);
            }
            else {
                // Preserve original timestamp for duplicates
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

    async feed(feed: Specification, start: FactReference[], _bookmark: string): Promise<FactFeed> {
        // TODO: Implement monotonic bookmarks defined by the store.
        // Bookmarks must be monotonically increasing quantities with a store-defined
        // format and comparison function. Fact hashes are not monotonic, so prior
        // implementations that derived bookmarks from hashes have been removed.
        // For now, feeds ignore bookmarks and always return empty bookmark values.

        // Compute projected results using the same engine as application reads
        const results: ProjectedResult[] = await this.runner.read(start, feed);

        // Map each projected result to a tuple of fact references
        const tuples: FactTuple[] = results.map(result => {
            const references = Object.values(result.tuple);
            const unique = uniqueFactReferences(references);
            return { facts: unique, bookmark: '' };
        });

        return { tuples, bookmark: '' };
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

    purge(purgeConditions: Specification[]): Promise<number> {
        // Not yet implemented
        return Promise.resolve(0);
    }

    purgeDescendants(purgeRoot: FactReference, triggers: FactReference[]): Promise<number> {
        // Remove all facts that are descendants of the purge root
        // and not a trigger or an ancestor of a trigger.
        const triggersAndTheirAncestors: FactReference[] = [...triggers];
        for (const trigger of triggers) {
            const triggerEnvelope = this.factEnvelopes.find(factEnvelopeEquals(trigger));
            if (triggerEnvelope) {
                this.addAllAncestors(triggerEnvelope.fact, triggersAndTheirAncestors);
            }
        }
        const startingCount = this.factEnvelopes.length;
        this.factEnvelopes = this.factEnvelopes.filter(e => {
            const ancestors: FactReference[] = this.ancestorsOf(e.fact);
            return !ancestors.some(factReferenceEquals(purgeRoot)) ||
                triggersAndTheirAncestors.some(factReferenceEquals(e.fact));
        });
        const endingCount = this.factEnvelopes.length;
        return Promise.resolve(startingCount - endingCount);
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
            // Return empty array instead of throwing when fact is not found
            // This allows specifications to handle unpersisted given facts gracefully
            return Promise.resolve([]);
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

    private ancestorsOf(fact: FactRecord): FactReference[] {
        const ancestors: FactReference[] = [];
        this.addAllAncestors(fact, ancestors);
        return ancestors;
    }

    private addAllAncestors(fact: FactRecord, ancestors: FactReference[]) {
        for (const role in fact.predecessors) {
            const predecessors = getPredecessors(fact, role);
            predecessors.forEach(predecessor => {
                if (!ancestors.some(factReferenceEquals(predecessor))) {
                    ancestors.push(predecessor);
                    const predecessorRecord = this.factEnvelopes.find(factEnvelopeEquals(predecessor));
                    if (predecessorRecord) {
                        this.addAllAncestors(predecessorRecord.fact, ancestors);
                    }
                }
            });
        }
    }

    private hydrate(reference: FactReference) {
        const fact = hydrateFromTree([reference], this.factEnvelopes.map(e => e.fact));
        if (fact.length === 0) {
            return Promise.resolve(undefined);
        }
        if (fact.length > 1) {
            throw new Error(`The fact ${reference} is defined more than once.`);
        }
        return Promise.resolve(fact[0]);
    }
}
