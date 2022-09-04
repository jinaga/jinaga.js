import { Query } from '../query/query';
import { Direction, ExistentialCondition, Join, PropertyCondition, Quantifier, Step } from '../query/steps';
import { Feed } from "../specification/feed";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactFeed, FactPath, FactRecord, FactReference, factReferenceEquals, Storage } from '../storage';
import { flatten } from '../util/fn';
import { formatDot } from './debug';
import { Inspector } from './inspector';

export function getPredecessors(fact: FactRecord, role: string) {
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

    read(start: FactReference[], specification: Specification): Promise<any[]> {
        throw new Error('Method not implemented.');
    }

    feed(feed: Feed, bookmark: string, limit: number): Promise<FactFeed> {
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
                    const record = this.findFact(fact);
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

    private findFact(reference: FactReference): FactRecord {
        return this.factRecords.find(factReferenceEquals(reference));
    }

    graphviz(): string[] {
        return formatDot(this.factRecords);
    }

    inspect() {
        return new Inspector(this.factRecords).inspect();
    }
}
