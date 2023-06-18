import { hydrateFromTree } from '../fact/hydrate';
import { Query } from '../query/query';
import { Direction, ExistentialCondition, Join, PropertyCondition, Quantifier, Step } from '../query/steps';
import { Feed } from "../specification/feed";
import { Specification } from "../specification/specification";
import { SpecificationRunner } from '../specification/specification-runner';
import { FactEnvelope, FactFeed, FactPath, FactRecord, FactReference, factReferenceEquals, ProjectedResult, Storage } from '../storage';
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

function loadAll(references: FactReference[], source: FactRecord[], target: FactRecord[]) {
    references.forEach(reference => {
        const predicate = factReferenceEquals(reference);
        if (!target.some(predicate)) {
            const record = source.find(predicate);
            if (record) {
                target.push(record);
                for (const role in record.predecessors) {
                    const predecessors = getPredecessors(record, role);
                    loadAll(predecessors, source, target);
                }
            }
        }
    });
}

export class MemoryStore implements Storage {
    private factRecords: FactRecord[] = [];
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
        envelopes.forEach(envelope => {
            if (!this.factRecords.some(factReferenceEquals(envelope.fact))) {
                this.factRecords.push(envelope.fact);
                added.push(envelope);
            }
        });
        return Promise.resolve(added);
    }

    query(start: FactReference, query: Query): Promise<FactPath[]> {
        const results = this.executeQuery(start, query.steps).map(path => path.slice(1));
        return Promise.resolve(results);
    }

    read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
        return this.runner.read(start, specification);
    }

    feed(feed: Feed, start: FactReference[], bookmark: string): Promise<FactFeed> {
        throw new Error('Method not implemented.');
    }

    whichExist(references: FactReference[]): Promise<FactReference[]> {
        const existing = references.filter(reference =>
            this.factRecords.some(factReferenceEquals(reference)));
        return Promise.resolve(existing);
    }

    load(references: FactReference[]): Promise<FactRecord[]> {
        let target: FactRecord[] = [];
        loadAll(references, this.factRecords, target);
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
                    const record = this.factRecords.find(factReferenceEquals(fact)) ?? null;
                    return getPredecessors(record, step.role).map(predecessor =>
                        path.concat([predecessor])
                    );
                });
            }
            else {
                return flatten(paths, path => {
                    const fact = path[path.length - 1];
                    const successors = this.factRecords.filter(record => {
                        const predecessors = getPredecessors(record, step.role);
                        return predecessors.some(factReferenceEquals(fact));
                    });
                    return successors.map(successor =>
                        path.concat([{
                            type: successor.type,
                            hash: successor.hash
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
        const fact = this.factRecords.find(factReferenceEquals(reference)) ?? null;
        return Promise.resolve(fact);
    }

    private getPredecessors(reference: FactReference, name: string, predecessorType: string): Promise<FactReference[]> {
        const record = this.factRecords.find(factReferenceEquals(reference)) ?? null;
        if (record === null) {
            throw new Error(`The fact ${reference.type}:${reference.hash} is not defined.`);
        }
        const predecessors = getPredecessors(record, name);
        const matching = predecessors.filter(predecessor => predecessor.type === predecessorType);
        return Promise.resolve(matching);
    }
    
    private getSuccessors(reference: FactReference, name: string, successorType: string): Promise<FactReference[]> {
        const successors = this.factRecords.filter(record => record.type === successorType &&
            getPredecessors(record, name).some(factReferenceEquals(reference)));
        return Promise.resolve(successors);
    }

    private hydrate(reference: FactReference) {
        const fact = hydrateFromTree([reference], this.factRecords);
        if (fact.length === 0) {
            throw new Error(`The fact ${reference} is not defined.`);
        }
        if (fact.length > 1) {
            throw new Error(`The fact ${reference} is defined more than once.`);
        }
        return Promise.resolve(fact[0]);
    }
}