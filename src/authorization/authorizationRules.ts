import { getPredecessors } from '../memory/memory-store';
import { User } from '../model/user';
import { Query } from '../query/query';
import { Preposition } from '../query/query-parser';
import { Direction, Join, PropertyCondition, Step } from '../query/steps';
import { FactConstructor, FactRepository, LabelOf, Model, Traversal } from '../specification/model';
import { Condition, Label, Match, PathCondition, Specification, splitBeforeFirstSuccessor } from '../specification/specification';
import { FactRecord, FactReference, factReferenceEquals, ReferencesByName, Storage } from '../storage';
import { findIndex, flatten, flattenAsync, mapAsync } from '../util/fn';
import { Trace } from '../util/trace';

class Evidence {
    constructor(
        private factRecords: FactRecord[]
    ) { }

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
    isAuthorized(userFact: FactReference | null, fact: FactRecord, evidence: Evidence, store: Storage): Promise<boolean>;
}

class AuthorizationRuleAny implements AuthorizationRule {
    isAuthorized(userFact: FactReference | null, fact: FactRecord, evidence: Evidence, store: Storage) {
        return Promise.resolve(true);
    }
}

class AuthorizationRuleNone implements AuthorizationRule {
    isAuthorized(userFact: FactReference | null, fact: FactRecord, evidence: Evidence, store: Storage): Promise<boolean> {
        Trace.warn(`No fact of type ${fact.type} is authorized.`);
        return Promise.resolve(false);
    }
}

class AuthorizationRuleQuery implements AuthorizationRule {
    constructor(
        private head: Query,
        private tail: Query | null
    ) {

    }

    async isAuthorized(userFact: FactReference | null, fact: FactRecord, evidence: Evidence, store: Storage) {
        if (!userFact) {
            Trace.warn(`No user is logged in while attempting to authorize ${fact.type}.`);
            return false;
        }
        const predecessors = evidence.query(fact, this.head);
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

    async isAuthorized(userFact: FactReference | null, fact: FactRecord, evidence: Evidence, store: Storage): Promise<boolean> {
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
        let results = evidence.executeSpecification(
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
}

type UserSpecificationDefinition<T> = (fact: LabelOf<T>, facts: FactRepository) => Traversal<User>;

type UserPredecessorSelector<T> = (fact: LabelOf<T>) => LabelOf<User>;

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
        const specification = this.model.given(factConstructor).match((fact, facts) =>
            facts.ofType(User)
                .join(user => user, predecessorSelector(fact)));
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

        const evidence = new Evidence(factRecords);
        const results = await mapAsync(rules, async r =>
            await r.isAuthorized(userFact, fact, evidence, store));
        return results.some(b => b);
    }
}
