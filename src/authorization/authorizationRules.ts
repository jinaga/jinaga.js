import { getPredecessors } from '../memory/memory-store';
import { Device, User } from '../model/user';
import { Query } from '../query/query';
import { Preposition } from '../query/query-parser';
import { Direction, Join, PropertyCondition, Step } from '../query/steps';
import { describeSpecification } from '../specification/description';
import { FactConstructor, FactRepository, LabelOf, Model, Traversal, getPayload } from '../specification/model';
import { Condition, Label, Match, PathCondition, Specification, splitBeforeFirstSuccessor } from '../specification/specification';
import { SpecificationParser } from '../specification/specification-parser';
import { FactRecord, FactReference, ReferencesByName, Storage, factReferenceEquals } from '../storage';
import { findIndex, flatten, flattenAsync } from '../util/fn';
import { Trace } from '../util/trace';

class FactGraph {
    constructor(
        private factRecords: FactRecord[]
    ) { }

    getField(reference: FactReference, name: string) {
        const record = this.findFact(reference);
        if (record === null) {
            throw new Error(`The fact ${reference.type}:${reference.hash} is not defined.`);
        }
        return record.fields[name];
    }

    query(start: FactReference, query: Query): FactReference[] {
        const results = this.executeQuery(start, query.steps);
        return results;
    }

    private executeQuery(start: FactReference, steps: Step[]) {
        return steps.reduce((facts, step) => {
            return this.executeStep(facts, step);
        }, [start]);
    }

    private executeStep(facts: FactReference[], step: Step): FactReference[] {
        if (step instanceof PropertyCondition) {
            if (step.name === 'type') {
                return facts.filter(fact => {
                    return fact.type === step.value;
                });
            }
        }
        else if (step instanceof Join) {
            if (step.direction === Direction.Predecessor) {
                return flatten(facts, fact => {
                    const record = this.findFact(fact);
                    return getPredecessors(record, step.role);
                });
            }
        }

        throw new Error('Defect in parsing authorization rule.');
    }

    executeSpecification(givenName: string, matches: Match[], label: string, fact: FactRecord): FactReference[] {
        const references: ReferencesByName = {
            [givenName]: {
                type: fact.type,
                hash: fact.hash
            }
        };
        const results = this.executeMatches(references, matches);
        return results.map(result => result[label]);
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
        if (pathCondition.rolesLeft.length > 0) {
            throw new Error('Cannot execute successor steps on evidence.');
        }
        return predecessors;
    }

    private executePredecessorStep(set: FactReference[], name: string, predecessorType: string): FactReference[] {
        return flatten(set, reference => {
            const record = this.findFact(reference);
            if (record === null) {
                throw new Error(`The fact ${reference.type}:${reference.hash} is not defined.`);
            }
            const predecessors = getPredecessors(record, name);
            return predecessors.filter(predecessor => predecessor.type === predecessorType);
        });
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

    private findFact(reference: FactReference): FactRecord | null {
        return this.factRecords.find(factReferenceEquals(reference)) ?? null;
    }
}

function headStep(step: Step) {
    if (step instanceof PropertyCondition) {
        return step.name === 'type';
    }
    else if (step instanceof Join) {
        return step.direction === Direction.Predecessor;
    }
    else {
        return false;
    }
}

interface AuthorizationRule {
    describe(type: string): string;
    isAuthorized(userFact: FactReference | null, fact: FactRecord, graph: FactGraph, store: Storage): Promise<boolean>;
    getAuthorizedPopulation(candidateKeys: string[], fact: FactRecord, graph: FactGraph, store: Storage): Promise<AuthorizationPopulation>;
}

class AuthorizationRuleAny implements AuthorizationRule {
    describe(type: string) {
        return `    any ${type}\n`;
    }

    isAuthorized(userFact: FactReference | null, fact: FactRecord, graph: FactGraph, store: Storage) {
        return Promise.resolve(true);
    }

    getAuthorizedPopulation(candidateKeys: string[], fact: FactRecord, graph: FactGraph, store: Storage): Promise<AuthorizationPopulation> {
        return Promise.resolve({
            quantifier: 'everyone'
        });
    }
}

class AuthorizationRuleNone implements AuthorizationRule {
    describe(type: string) {
        return `    no ${type}\n`;
    }

    isAuthorized(userFact: FactReference | null, fact: FactRecord, graph: FactGraph, store: Storage): Promise<boolean> {
        Trace.warn(`No fact of type ${fact.type} is authorized.`);
        return Promise.resolve(false);
    }

    getAuthorizedPopulation(candidateKeys: string[], fact: FactRecord, graph: FactGraph, store: Storage): Promise<AuthorizationPopulation> {
        return Promise.resolve({
            quantifier: 'none'
        });
    }
}

class AuthorizationRuleQuery implements AuthorizationRule {
    constructor(
        private head: Query,
        private tail: Query | null
    ) {

    }

    describe(type: string): string {
        throw new Error("Authorization rules must be based on specifications, not template functions.");
    }

    async isAuthorized(userFact: FactReference | null, fact: FactRecord, graph: FactGraph, store: Storage) {
        if (!userFact) {
            Trace.warn(`No user is logged in while attempting to authorize ${fact.type}.`);
            return false;
        }
        const predecessors = graph.query(fact, this.head);
        const results = await flattenAsync(predecessors, async p =>
            await this.executeQuery(store, p));
        const authorized = results.some(factReferenceEquals(userFact));
        if (!authorized) {
            if (results.length === 0) {
                Trace.warn(`The authorization rule for ${fact.type} returned no authorized users.`);
            }
            else {
                const count = results.length === 1 ? '1 user' : `${results.length} users`;
                Trace.warn(`The authorization rule for ${fact.type} returned ${count}, but not the logged in user.`);
            }
        }
        return authorized;
    }

    getAuthorizedPopulation(candidateKeys: string[], fact: FactRecord, graph: FactGraph, store: Storage): Promise<AuthorizationPopulation> {
        throw new Error("Authorization with template functions is no longer supported.");
    }

    private async executeQuery(store: Storage, predecessors: FactReference) {
        if (!this.tail) {
            return [ predecessors ];
        }
        const results = await store.query(predecessors, this.tail);
        return results
            .map(path => path[path.length-1]);
    }
}

class AuthorizationRuleSpecification implements AuthorizationRule {
    constructor(
        private specification: Specification
    ) { }

    describe(type: string): string {
        const description = describeSpecification(this.specification, 1);
        return description;
    }

    async isAuthorized(userFact: FactReference | null, fact: FactRecord, graph: FactGraph, store: Storage): Promise<boolean> {
        if (!userFact) {
            Trace.warn(`No user is logged in while attempting to authorize ${fact.type}.`);
            return false;
        }

        // The specification must be given a single fact.
        if (this.specification.given.length !== 1) {
            throw new Error('The specification must be given a single fact.');
        }

        // The projection must be a singular label.
        if (this.specification.projection.type !== 'fact') {
            throw new Error('The projection must be a singular label.');
        }
        const label = this.specification.projection.label;

        // Split the specification.
        // The head is deterministic, and can be run on the graph.
        // The tail is non-deterministic, and must be run on the store.
        const { head, tail } = splitBeforeFirstSuccessor(this.specification);

        // If there is no head, then the specification is unsatisfiable.
        if (head === undefined) {
            throw new Error('The specification must start with a predecessor join. Otherwise, it is unsatisfiable.');
        }

        // Execute the head on the graph.
        if (head.projection.type !== 'fact') {
            throw new Error('The head of the specification must project a fact.');
        }
        let results = graph.executeSpecification(
            head.given[0].name,
            head.matches,
            head.projection.label,
            fact);

        // If there is a tail, execute it on the store.
        if (tail !== undefined) {
            if (tail.given.length !== 1) {
                throw new Error('The tail of the specification must be given a single fact.');
            }
            const tailResults: FactReference[] = [];
            for (const result of results) {
                const users = await store.read([result], tail);
                tailResults.push(...users.map(user => user.tuple[label]));
            }
            results = tailResults;
        }

        // If any of the results match the user, then the user is authorized.
        const authorized = results.some(factReferenceEquals(userFact));
        return authorized;
    }

    async getAuthorizedPopulation(candidateKeys: string[], fact: FactRecord, graph: FactGraph, store: Storage): Promise<AuthorizationPopulation> {
        if (candidateKeys.length === 0) {
            Trace.warn(`No candidate keys were given while attempting to authorize ${fact.type}.`);
            return {
                quantifier: 'none'
            };
        }

        // The specification must be given a single fact.
        if (this.specification.given.length !== 1) {
            throw new Error('The specification must be given a single fact.');
        }

        // The projection must be a singular label.
        if (this.specification.projection.type !== 'fact') {
            throw new Error('The projection must be a singular label.');
        }

        // Split the specification.
        // The head is deterministic, and can be run on the graph.
        // The tail is non-deterministic, and must be run on the store.
        const { head, tail } = splitBeforeFirstSuccessor(this.specification);

        // If there is no head, then the specification is unsatisfiable.
        if (head === undefined) {
            throw new Error('The specification must start with a predecessor join. Otherwise, it is unsatisfiable.');
        }

        // Execute the head on the graph.
        if (head.projection.type !== 'fact') {
            throw new Error('The head of the specification must project a fact.');
        }
        let results = graph.executeSpecification(
            head.given[0].name,
            head.matches,
            head.projection.label,
            fact);

        const publicKeys: string[] = [];
        // If there is a tail, execute it on the store.
        if (tail !== undefined) {
            if (tail.given.length !== 1) {
                throw new Error('The tail of the specification must be given a single fact.');
            }
            for (const result of results) {
                const users = await store.read([result], tail);
                publicKeys.push(...users.map(user => user.result.publicKey));
            }
        }
        else {
            publicKeys.push(...results.map(result => graph.getField(result, 'publicKey')));
        }

        // Find the intersection between the candidate keys and the public keys.
        const authorizedKeys = candidateKeys.filter(key => publicKeys.some(publicKey => publicKey === key));

        // If any are left, then those are the authorized keys.
        if (authorizedKeys.length > 0) {
            return {
                quantifier: 'some',
                authorizedKeys
            };
        }
        else {
            return {
                quantifier: 'none'
            };
        }
    }
}

type UserSpecificationDefinition<T> = (fact: LabelOf<T>, facts: FactRepository) => (Traversal<User | Device>);

type UserPredecessorSelector<T> = (fact: LabelOf<T>) => (LabelOf<User | Device>);

type AuthorizationPopulationEveryone = {
    quantifier: "everyone";
};
type AuthorizationPopulationSome = {
    quantifier: "some";
    authorizedKeys: string[];
};
type AuthorizationPopulationNone = {
    quantifier: "none";
};
export type AuthorizationPopulation = AuthorizationPopulationEveryone | AuthorizationPopulationSome | AuthorizationPopulationNone;

export class AuthorizationRules {
    private rulesByType: {[type: string]: AuthorizationRule[]} = {};

    constructor(
        private model: Model | undefined
    ) { }

    with(rules: (r: AuthorizationRules) => AuthorizationRules) {
        return rules(this);
    }

    no(type: string): AuthorizationRules;
    no<T>(factConstructor: FactConstructor<T>): AuthorizationRules;
    no<T>(typeOrFactConstructor: string | FactConstructor<T>): AuthorizationRules {
        const type = typeof(typeOrFactConstructor) === 'string' ?
            typeOrFactConstructor :
            typeOrFactConstructor.Type;
        return this.withRule(type, new AuthorizationRuleNone());
    }

    any(type: string): AuthorizationRules;
    any<T>(factConstructor: FactConstructor<T>): AuthorizationRules;
    any<T>(typeOrFactConstructor: string | FactConstructor<T>): AuthorizationRules {
        const type = typeof(typeOrFactConstructor) === 'string' ?
            typeOrFactConstructor :
            typeOrFactConstructor.Type;
        return this.withRule(type, new AuthorizationRuleAny());
    }

    type<T, U>(type: string, preposition: Preposition<T, U>): AuthorizationRules;
    type<T>(factConstructor: FactConstructor<T>, definition: UserSpecificationDefinition<T>): AuthorizationRules;
    type<T>(factConstructor: FactConstructor<T>, predecessorSelector: UserPredecessorSelector<T>): AuthorizationRules;
    type<T, U>(type: string | FactConstructor<T>, prepositionOrSpecification: Preposition<T, U> | UserSpecificationDefinition<T> | UserPredecessorSelector<T>): AuthorizationRules {
        if (typeof(type) === 'string' && prepositionOrSpecification instanceof Preposition) {
            return this.oldType(type, prepositionOrSpecification);
        }
        else if (typeof(type) === 'function' && typeof(prepositionOrSpecification) === 'function') {
            if (prepositionOrSpecification.length === 2) {
                return this.typeFromDefinition(type, <UserSpecificationDefinition<T>>prepositionOrSpecification);
            }
            else {
                return this.typeFromPredecessorSelector(type, <UserPredecessorSelector<T>>prepositionOrSpecification);
            }
        }
        else {
            throw new Error('Invalid arguments.');
        }
    }

    private oldType<T, U>(type: string, preposition: Preposition<T, U>): AuthorizationRules {
        if (preposition.steps.length === 0) {
            throw new Error(`Invalid authorization rule for type ${type}: the query matches the fact itself.`);
        }
        const first = preposition.steps[0];
        if (!(first instanceof Join)) {
            throw new Error(`Invalid authorization rule for type ${type}: the query does not begin with a predecessor.`);
        }
        if (first.direction !== Direction.Predecessor) {
            throw new Error(`Invalid authorization rule for type ${type}: the query expects successors.`);
        }

        const index = findIndex(preposition.steps, step => !headStep(step));
        const head = index < 0 ? new Query(preposition.steps) : new Query(preposition.steps.slice(0, index));
        const tail = index < 0 ? null : new Query(preposition.steps.slice(index));
        return this.withRule(type, new AuthorizationRuleQuery(head, tail));
    }

    private typeFromDefinition<T>(factConstructor: FactConstructor<T>, definition: UserSpecificationDefinition<T>): AuthorizationRules {
        const type = factConstructor.Type;
        if (this.model === undefined) {
            throw new Error('The model must be given to define a rule using a specification.');
        }
        const specification = this.model.given(factConstructor).match(definition);
        return this.withRule(type, new AuthorizationRuleSpecification(specification.specification));
    }

    private typeFromPredecessorSelector<T>(factConstructor: FactConstructor<T>, predecessorSelector: UserPredecessorSelector<T>): AuthorizationRules {
        const type = factConstructor.Type;
        if (this.model === undefined) {
            throw new Error('The model must be given to define a rule using a specification.');
        }
        const specification = this.model.given(factConstructor).match((fact, facts) => {
            const label = predecessorSelector(fact);
            const payload = getPayload(label);
            if (payload.type !== 'fact') {
                throw new Error('Authorization rules must select facts.');
            }
            if (payload.factType === User.Type) {
                const userTraversal: Traversal<LabelOf<User | Device>> = facts.ofType(User)
                    .join(user => user, label);
                return userTraversal;
            }
            else if (payload.factType === Device.Type) {
                const deviceTraversal: Traversal<LabelOf<User | Device>> = facts.ofType(Device)
                    .join(device => device, label);
                return deviceTraversal;
            }
            else {
                throw new Error(`Authorization rules must select users or devices.`);
            }
        });
        return this.withRule(type, new AuthorizationRuleSpecification(specification.specification));
    }

    private withRule(type: string, rule: AuthorizationRule) {
        const oldRules = this.rulesByType[type] || [];
        const newRules = [...oldRules, rule];
        const newRulesByType = { ...this.rulesByType, [type]: newRules };
        const result = new AuthorizationRules(this.model);
        result.rulesByType = newRulesByType;
        return result;
    }

    hasRule(type: string) {
        return !!this.rulesByType[type];
    }

    async isAuthorized(userFact: FactReference | null, fact: FactRecord, factRecords: FactRecord[], store: Storage) {
        const rules = this.rulesByType[fact.type];
        if (!rules) {
            return false;
        }

        const graph = new FactGraph(factRecords);
        for (const rule of rules) {
            const authorized = await rule.isAuthorized(userFact, fact, graph, store);
            if (authorized) {
                return true;
            }
        }
        return false;
    }

    async getAuthorizedPopulation(candidateKeys: string[], fact: FactRecord, factRecords: FactRecord[], store: Storage): Promise<AuthorizationPopulation> {
        const rules = this.rulesByType[fact.type];
        if (!rules) {
            return {
                quantifier: 'none'
            };
        }

        const graph = new FactGraph(factRecords);
        for (const rule of rules) {
            const population = await rule.getAuthorizedPopulation(candidateKeys, fact, graph, store);
            if (population.quantifier === 'everyone') {
                return population;
            }
            else if (population.quantifier === 'some') {
                // TODO: Union the authorized keys.
                return population;
            }
        }
        return {
            quantifier: 'none'
        }
    }

    saveToDescription(): string {
        var description = 'authorization {\n';
        for (const type in this.rulesByType) {
            const rules = this.rulesByType[type];
            for (const rule of rules) {
                const ruleDescription = rule.describe(type);
                description += ruleDescription;
            }
        }
        description += '}\n';
        return description;
    }

    static loadFromDescription(description: string): AuthorizationRules {
        const parser = new SpecificationParser(description);
        parser.skipWhitespace();
        var authorizationRules = new AuthorizationRules(undefined);
        parser.parseAuthorizationRules({
            any: (type: string) =>
                authorizationRules = authorizationRules.withRule(type, new AuthorizationRuleAny()),
            no: (type: string) =>
                authorizationRules = authorizationRules.withRule(type, new AuthorizationRuleNone()),
            type: (type: string, specification: Specification) =>
                authorizationRules = authorizationRules.withRule(type, new AuthorizationRuleSpecification(specification))
        });
        return authorizationRules;
    }
}

export function describeAuthorizationRules(model: Model, authorization: (a: AuthorizationRules) => AuthorizationRules) {
    const rules = authorization(new AuthorizationRules(model));
    return rules.saveToDescription();
}