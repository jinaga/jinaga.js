import { hydrateFromTree } from '../fact/hydrate';
import { Query } from '../query/query';
import { Direction, ExistentialCondition, Join, PropertyCondition, Quantifier, Step } from '../query/steps';
import { Feed } from "../specification/feed";
import { ComponentProjection, Condition, Label, Match, PathCondition, Projection, Role, SingularProjection, Specification } from "../specification/specification";
import { FactEnvelope, FactFeed, FactPath, FactRecord, FactReference, factReferenceEquals, ProjectedResult, ReferencesByName, Storage } from '../storage';
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
        if (start.length !== specification.given.length) {
            throw new Error(`The number of start references (${start.length}) must match the number of given facts (${specification.given.length}).`);
        }
        const references = start.reduce((references, reference, index) => ({
            ...references,
            [specification.given[index].name]: {
                type: reference.type,
                hash: reference.hash
            }
        }), {} as ReferencesByName);
        var products = this.executeMatchesAndProjection(references, specification.matches, specification.projection);
        return Promise.resolve(products);
    }

    feed(feed: Feed, bookmark: string): Promise<FactFeed> {
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

    private findFact(reference: FactReference): FactRecord | null {
        return this.factRecords.find(factReferenceEquals(reference)) ?? null;
    }

    private executeMatchesAndProjection(references: ReferencesByName, matches: Match[], projection: Projection): ProjectedResult[] {
        const tuples: ReferencesByName[] = this.executeMatches(references, matches);
        const products = tuples.map(tuple => this.createProduct(tuple, projection));
        return products;
    }

    private executeMatches(references: ReferencesByName, matches: Match[]): ReferencesByName[] {
        const results = matches.reduce(
            (tuples, match) => tuples.flatMap(
                tuple => this.executeMatch(tuple, match)
            ),
            [references]
        );
        return results;
    }

    private executeMatch(references: ReferencesByName, match: Match): ReferencesByName[] {
        let results: ReferencesByName[] = [];
        if (match.conditions.length === 0) {
            throw new Error("A match must have at least one condition.");
        }
        const firstCondition = match.conditions[0];
        if (firstCondition.type === "path") {
            const result: FactReference[] = this.executePathCondition(references, match.unknown, firstCondition);
            results = result.map(reference => ({
                ...references,
                [match.unknown.name]: {
                    type: reference.type,
                    hash: reference.hash
                }
            }));
        }
        else {
            throw new Error("The first condition must be a path condition.");
        }

        const remainingConditions = match.conditions.slice(1);
        for (const condition of remainingConditions) {
            results = this.filterByCondition(references, match.unknown, results, condition);
        }
        return results;
    }

    private executePathCondition(references: ReferencesByName, unknown: Label, pathCondition: PathCondition): FactReference[] {
        if (!references.hasOwnProperty(pathCondition.labelRight)) {
            throw new Error(`The label ${pathCondition.labelRight} is not defined.`);
        }
        const start = references[pathCondition.labelRight];
        const predecessors = pathCondition.rolesRight.reduce(
            (set, role) => this.executePredecessorStep(set, role.name, role.predecessorType),
            [start]
        );
        const invertedRoles = invertRoles(pathCondition.rolesLeft, unknown.type);
        const results = invertedRoles.reduce(
            (set, role) => this.executeSuccessorStep(set, role.name, role.successorType),
            predecessors
        );
        return results;
    }

    private executePredecessorStep(set: FactReference[], name: string, predecessorType: string): FactReference[] {
        return flatten(set, reference => {
            const record = this.findFact(reference);
            if (record === null) {
                throw new Error(`The fact ${reference} is not defined.`);
            }
            const predecessors = getPredecessors(record, name);
            return predecessors.filter(predecessor => predecessor.type === predecessorType);
        });
    }

    private executeSuccessorStep(set: FactReference[], name: string, successorType: string): FactReference[] {
        return set.flatMap(reference => this.factRecords.filter(record =>
            record.type === successorType &&
            getPredecessors(record, name).some(factReferenceEquals(reference)))
        );
    }
    
    private filterByCondition(references: ReferencesByName, unknown: Label, results: ReferencesByName[], condition: Condition): ReferencesByName[] {
        if (condition.type === "path") {
            const otherResults = this.executePathCondition(references, unknown, condition);
            return results.filter(result => otherResults.some(factReferenceEquals(result[unknown.name])));
        }
        else if (condition.type === "existential") {
            var matchingReferences = results.filter(result => {
                const matches = this.executeMatches(result, condition.matches);
                return condition.exists ?
                    matches.length > 0 :
                    matches.length === 0;
            });
            return matchingReferences;
        }
        else {
            const _exhaustiveCheck: never = condition;
            throw new Error(`Unknown condition type: ${(condition as any).type}`);
        }
    }

    private createProduct(tuple: ReferencesByName, projection: Projection): ProjectedResult {
        if (projection.type === "composite") {
            const result = projection.components.reduce((obj, component) => ({
                ...obj,
                [component.name]: this.createComponent(tuple, component)
            }), {});
            return {
                tuple,
                result
            };
        }
        else {
            const result = this.createSingularProduct(tuple, projection);
            return {
                tuple,
                result
            };
        }
    }
    private createComponent(tuple: ReferencesByName, component: ComponentProjection): any {
        if (component.type === "specification") {
            return this.executeMatchesAndProjection(tuple, component.matches, component.projection);
        }
        else {
            return this.createSingularProduct(tuple, component);
        }
    }

    private createSingularProduct(tuple: ReferencesByName, projection: SingularProjection): any {
        if (projection.type === "fact") {
            if (!tuple.hasOwnProperty(projection.label)) {
                throw new Error(`The label ${projection.label} is not defined.`);
            }
            const reference = tuple[projection.label];
            const fact = hydrateFromTree([reference], this.factRecords);
            if (fact.length === 0) {
                throw new Error(`The fact ${reference} is not defined.`);
            }
            if (fact.length > 1) {
                throw new Error(`The fact ${reference} is defined more than once.`);
            }
            return fact[0];
        }
        else if (projection.type === "field") {
            if (!tuple.hasOwnProperty(projection.label)) {
                throw new Error(`The label ${projection.label} is not defined.`);
            }
            const reference = tuple[projection.label];
            const fact = this.findFact(reference);
            if (fact === null) {
                throw new Error(`The fact ${reference} is not defined.`);
            }
            const value: any = fact.fields[projection.field];
            if (value === undefined) {
                throw new Error(`The fact ${reference} does not have a field named ${projection.field}.`);
            }
            return value;
        }
        else if (projection.type === "hash") {
            if (!tuple.hasOwnProperty(projection.label)) {
                throw new Error(`The label ${projection.label} is not defined.`);
            }
            const reference = tuple[projection.label];
            return reference.hash;
        }
        else {
            const _exhaustiveCheck: never = projection;
            throw new Error(`Unexpected child projection type: ${_exhaustiveCheck}`);
        }
    }
}

interface InvertedRole {
    name: string;
    successorType: string;
}

function invertRoles(roles: Role[], type: string): InvertedRole[] {
    const results: InvertedRole[] = [];
    for (const role of roles) {
        results.push({
            name: role.name,
            successorType: type
        });
        type = role.predecessorType;
    }
    return results.reverse();
}