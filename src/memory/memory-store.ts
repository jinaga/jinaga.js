import { hydrateFromTree } from '../fact/hydrate';
import { Query } from '../query/query';
import { Direction, ExistentialCondition, Join, PropertyCondition, Quantifier, Step } from '../query/steps';
import { Specification } from "../specification/specification";
import { SpecificationRunner } from '../specification/specification-runner';
import { FactEnvelope, FactFeed, FactPath, FactRecord, FactReference, ProjectedResult, Storage, factReferenceEquals } from '../storage';
import { flatten } from '../util/fn';

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

function loadAll(references: FactReference[], source: FactEnvelope[], target: FactRecord[]) {
    references.forEach(reference => {
        const predicate = factReferenceEquals(reference);
        if (!target.some(predicate)) {
            const record = source.find(e => predicate(e.fact));
            if (record) {
                target.push(record.fact);
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

    query(start: FactReference, query: Query): Promise<FactPath[]> {
        const results = this.executeQuery(start, query.steps).map(path => path.slice(1));
        return Promise.resolve(results);
    }

    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        return this.runner.read(start, specification);
    }

    feed(feed: Specification, start: FactReference[], bookmark: string): Promise<FactFeed> {
        throw new Error('Method not implemented.');
    }

    whichExist(references: FactReference[]): Promise<FactReference[]> {
        const existing = references.filter(reference => {
            const isFact = factReferenceEquals(reference);
            return this.factEnvelopes.some(e => isFact(e.fact));
        });
        return Promise.resolve(existing);
    }

    load(references: FactReference[]): Promise<FactRecord[]> {
        let target: FactRecord[] = [];
        loadAll(references, this.factEnvelopes, target);
        return Promise.resolve(target);
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

    private executeQuery(start: FactReference, steps: Step[]) {
        return steps.reduce((paths, step) => {
            return this.executeStep(paths, step);
        }, [[start]]);
    }

    private executeStep(paths: FactPath[], step: Step): FactPath[] {
        if (step instanceof PropertyCondition) {
            if (step.name === 'type') {
                return paths.filter(path => {
                    const fact = path[path.length - 1];
                    return fact.type === step.value;
                });
            }
        }
        else if (step instanceof Join) {
            if (step.direction === Direction.Predecessor) {
                return flatten(paths, path => {
                    const fact = path[path.length - 1];
                    const isFact = factReferenceEquals(fact);
                    const record = this.factEnvelopes.find(e => isFact(e.fact)) ?? null;
                    return getPredecessors(record?.fact ?? null, step.role).map(predecessor =>
                        path.concat([predecessor])
                    );
                });
            }
            else {
                return flatten(paths, path => {
                    const fact = path[path.length - 1];
                    const isFact = factReferenceEquals(fact);
                    const successors = this.factEnvelopes.filter(envelope => {
                        const predecessors = getPredecessors(envelope.fact, step.role);
                        return predecessors.some(isFact);
                    });
                    return successors.map(successor =>
                        path.concat([{
                            type: successor.fact.type,
                            hash: successor.fact.hash
                        }])
                    );
                });
            }
        }
        else if (step instanceof ExistentialCondition) {
            return paths.filter(path => {
                const fact = path[path.length - 1];
                const results = this.executeQuery(fact, step.steps);
                return step.quantifier === Quantifier.Exists ?
                    results.length > 0 :
                    results.length === 0;
            });
        }

        throw new Error('Cannot yet handle this type of step: ' + step);
    }

    private findFact(reference: FactReference): Promise<FactRecord | null> {
        const isFact = factReferenceEquals(reference);
        const envelope = this.factEnvelopes.find(e => isFact(e.fact)) ?? null;
        return Promise.resolve(envelope?.fact ?? null);
    }

    private getPredecessors(reference: FactReference, name: string, predecessorType: string): Promise<FactReference[]> {
        const isFact = factReferenceEquals(reference);
        const record = this.factEnvelopes.find(e => isFact(e.fact)) ?? null;
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