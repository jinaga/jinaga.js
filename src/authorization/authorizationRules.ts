import { getPredecessors } from '../memory/memory-store';
import { Device, User } from '../model/user';
import { describeSpecification } from '../specification/description';
import { FactConstructor, FactRepository, LabelOf, Model, Traversal, getPayload } from '../specification/model';
import { Condition, Label, Match, PathCondition, Specification, splitBeforeFirstSuccessor } from '../specification/specification';
import { SpecificationParser } from '../specification/specification-parser';
import { FactRecord, FactReference, ReferencesByName, Storage, factReferenceEquals } from '../storage';
import { distinct, flatten } from '../util/fn';
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
            const matchingReferences = results.filter(result => {
                const matches = this.executeMatches(result, condition.matches);
                return condition.exists ?
                    matches.length > 0 :
                    matches.length === 0;
            });
            return matchingReferences;
        }
        else {
            const _exhaustiveCheck: never = condition;
            throw new Error(`Unknown condition type: ${(_exhaustiveCheck as any).type}`);
        }
    }

    private findFact(reference: FactReference): FactRecord | null {
        return this.factRecords.find(factReferenceEquals(reference)) ?? null;
    }
}

interface AuthorizationRule {
    describe(type: string): string;
    isAuthorized(userFact: FactReference | null, fact: FactRecord, graph: FactGraph, store: Storage): Promise<boolean>;
    getAuthorizedPopulation(candidateKeys: string[], fact: FactRecord, graph: FactGraph, store: Storage): Promise<AuthorizationPopulation>;
}

export class AuthorizationRuleAny implements AuthorizationRule {
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

export class AuthorizationRuleNone implements AuthorizationRule {
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

export class AuthorizationRuleSpecification implements AuthorizationRule {
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
            head.given[0].label.name,
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
        const results = graph.executeSpecification(
            head.given[0].label.name,
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

type UserSpecificationDefinition<T> =
    ((fact: LabelOf<T>, facts: FactRepository) => (Traversal<LabelOf<User>>)) |
    ((fact: LabelOf<T>, facts: FactRepository) => (Traversal<LabelOf<Device>>));

type UserPredecessorSelector<T> =
    ((fact: LabelOf<T>) => (LabelOf<User>)) |
    ((fact: LabelOf<T>) => (LabelOf<Device>));

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
    static empty: AuthorizationRules = new AuthorizationRules(undefined);

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

    type<T>(factConstructor: FactConstructor<T>, definition: UserSpecificationDefinition<T>): AuthorizationRules;
    type<T>(factConstructor: FactConstructor<T>, predecessorSelector: UserPredecessorSelector<T>): AuthorizationRules;
    type<T>(factConstructor: FactConstructor<T>, definitionOrPredecessorSelector: UserSpecificationDefinition<T> | UserPredecessorSelector<T>): AuthorizationRules {
        if (definitionOrPredecessorSelector.length === 2) {
            return this.typeFromDefinition(factConstructor, <UserSpecificationDefinition<T>>definitionOrPredecessorSelector);
        }
        else {
            return this.typeFromPredecessorSelector(factConstructor, <UserPredecessorSelector<T>>definitionOrPredecessorSelector);
        }
    }

    private typeFromDefinition<T>(factConstructor: FactConstructor<T>, definition: UserSpecificationDefinition<T>): AuthorizationRules {
        const type = factConstructor.Type;
        if (this.model === undefined) {
            throw new Error('The model must be given to define a rule using a specification.');
        }
        const specification = this.model.given(factConstructor).match<unknown>(definition);
        return this.withRule(type, new AuthorizationRuleSpecification(specification.specification));
    }

    private typeFromPredecessorSelector<T>(factConstructor: FactConstructor<T>, predecessorSelector: UserPredecessorSelector<T>): AuthorizationRules {
        const type = factConstructor.Type;
        if (this.model === undefined) {
            throw new Error('The model must be given to define a rule using a specification.');
        }
        const specification = this.model.given(factConstructor).match<unknown>((fact, facts) => {
            const label = predecessorSelector(fact);
            const payload = getPayload(label);
            if (payload instanceof Traversal) {
                const traversal = payload as Traversal<LabelOf<User> | LabelOf<Device>>;
                const projection = traversal.projection;
                if (projection.type !== 'fact') {
                    throw new Error('Authorization rules must select facts.');
                }
                const label = projection.label;
                const match = traversal.matches.find(m => m.unknown.name === label);
                if (match === undefined) {
                    throw new Error(`The traversal must match the label ${label}.`);
                }
                if (match.unknown.type !== User.Type && match.unknown.type !== Device.Type) {
                    throw new Error(`The traversal must match a user or device.`);
                }
                return traversal;
            }
            if (payload.type !== 'fact') {
                throw new Error('Authorization rules must select facts.');
            }
            if (payload.factType === User.Type) {
                const userTraversal = facts.ofType(User)
                    .join(user => user, label);
                return userTraversal;
            }
            else if (payload.factType === Device.Type) {
                const deviceTraversal = facts.ofType(Device)
                    .join(device => device, label);
                return deviceTraversal;
            }
            else {
                throw new Error(`Authorization rules must select users or devices.`);
            }
        });
        return this.withRule(type, new AuthorizationRuleSpecification(specification.specification));
    }

    merge(authorizationRules2: AuthorizationRules): AuthorizationRules {
        let result = new AuthorizationRules(this.model);
        for (const type in this.rulesByType) {
            const rules1 = this.rulesByType[type];
            const rules2 = authorizationRules2.rulesByType[type];
            if (rules2) {
                const rules = [...rules1, ...rules2];
                for (const rule of rules) {
                    result = result.withRule(type, rule);
                }
            }
            else {
                for (const rule of rules1) {
                    result = result.withRule(type, rule);
                }
            }
        }
        for (const type in authorizationRules2.rulesByType) {
            if (!this.rulesByType[type]) {
                const rules2 = authorizationRules2.rulesByType[type];
                for (const rule of rules2) {
                    result = result.withRule(type, rule);
                }
            }
        }
        return result
    }

    public static combine(rules: AuthorizationRules, type: string, rule: AuthorizationRule): AuthorizationRules {
        return rules.withRule(type, rule);
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

    async getAuthorizedPopulation(candidateKeys: string[], fact: FactRecord, factRecords: FactRecord[], store: Storage): Promise<AuthorizationPopulation> {
        const rules = this.rulesByType[fact.type];
        if (!rules) {
            return {
                quantifier: 'none'
            };
        }

        const graph = new FactGraph(factRecords);
        let authorizedKeys: string[] = [];
        for (const rule of rules) {
            const population = await rule.getAuthorizedPopulation(candidateKeys, fact, graph, store);
            if (population.quantifier === 'everyone') {
                return population;
            }
            else if (population.quantifier === 'some') {
                authorizedKeys = [...authorizedKeys, ...population.authorizedKeys]
                    .filter(distinct);
            }
        }
        if (authorizedKeys.length > 0) {
            return {
                quantifier: 'some',
                authorizedKeys
            };
        }
        return {
            quantifier: 'none'
        }
    }

    saveToDescription(): string {
        let description = 'authorization {\n';
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
        const authorizationRules = parser.parseAuthorizationRules();
        return authorizationRules;
    }
}

export function describeAuthorizationRules(model: Model, authorization: (a: AuthorizationRules) => AuthorizationRules) {
    const rules = authorization(new AuthorizationRules(model));
    return rules.saveToDescription();
}