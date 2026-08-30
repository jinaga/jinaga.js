import { AuthorizationRuleError } from './errors';
import { getPredecessors } from '../memory/memory-store';
import { Device, User } from '../model/user';
import { describeSpecification } from '../specification/description';
import { FactConstructor, FactRepository, LabelOf, Model, Traversal, getPayload } from '../specification/model';
import { Condition, Label, Match, PathCondition, Specification, splitBeforeFirstSuccessor } from '../specification/specification';
import { SpecificationParser } from '../specification/specification-parser';
import { validateSpecificationOrThrow } from '../specification/specification-validation';
import { FactEnvelope, FactRecord, FactReference, ReferencesByName, Storage, factReferenceEquals } from '../storage';
import { distinct, filterAsync, flatten, flattenAsync } from '../util/fn';
import { Trace } from '../util/trace';

class FactGraph {
    private loadedRecords: FactRecord[] = [];
    private pendingLoads = new Map<string, Promise<void>>();

    constructor(
        private factRecords: FactRecord[],
        private store: Storage
    ) { }

    async getField(reference: FactReference, name: string) {
        const record = await this.findFact(reference);
        if (record === null) {
            throw new AuthorizationRuleError(`The fact ${reference.type}:${reference.hash} is not defined.`);
        }
        return record.fields[name];
    }

    async executeSpecification(givenName: string, matches: Match[], label: string, fact: FactRecord): Promise<FactReference[]> {
        const references: ReferencesByName = {
            [givenName]: {
                type: fact.type,
                hash: fact.hash
            }
        };
        const results = await this.executeMatches(references, matches);
        return results.map(result => result[label]);
    }

    private async executeMatches(references: ReferencesByName, matches: Match[]): Promise<ReferencesByName[]> {
        let tuples = [references];
        for (const match of matches) {
            tuples = await flattenAsync(tuples, tuple => this.executeMatch(tuple, match));
        }
        return tuples;
    }

    private async executeMatch(references: ReferencesByName, match: Match): Promise<ReferencesByName[]> {
        let results: ReferencesByName[] = [];
        if (match.conditions.length === 0) {
            throw new AuthorizationRuleError("A match must have at least one condition.");
        }
        const firstCondition = match.conditions[0];
        if (firstCondition.type === "path") {
            const result: FactReference[] = await this.executePathCondition(references, match.unknown, firstCondition);
            results = result.map(reference => ({
                ...references,
                [match.unknown.name]: {
                    type: reference.type,
                    hash: reference.hash
                }
            }));
        }
        else {
            throw new AuthorizationRuleError("The first condition must be a path condition.");
        }

        const remainingConditions = match.conditions.slice(1);
        for (const condition of remainingConditions) {
            results = await this.filterByCondition(references, match.unknown, results, condition);
        }
        return results;
    }

    private async executePathCondition(references: ReferencesByName, unknown: Label, pathCondition: PathCondition): Promise<FactReference[]> {
        if (!references.hasOwnProperty(pathCondition.labelRight)) {
            throw new AuthorizationRuleError(`The label ${pathCondition.labelRight} is not defined.`);
        }
        let predecessors = [references[pathCondition.labelRight]];
        for (const role of pathCondition.rolesRight) {
            predecessors = await this.executePredecessorStep(predecessors, role.name, role.predecessorType);
        }
        if (pathCondition.rolesLeft.length > 0) {
            throw new AuthorizationRuleError('Cannot execute successor steps on evidence.');
        }
        return predecessors;
    }

    private async executePredecessorStep(set: FactReference[], name: string, predecessorType: string): Promise<FactReference[]> {
        // Resolve every reference needed for this step with a single batched
        // store read, rather than one store.load() call per fact.
        await this.ensureLoaded(set);
        return flatten(set, reference => {
            const record = this.findFactSync(reference);
            if (record === null) {
                throw new AuthorizationRuleError(`The fact ${reference.type}:${reference.hash} is not defined.`);
            }
            const predecessors = getPredecessors(record, name);
            return predecessors.filter(predecessor => predecessor.type === predecessorType);
        });
    }

    private async filterByCondition(references: ReferencesByName, unknown: Label, results: ReferencesByName[], condition: Condition): Promise<ReferencesByName[]> {
        if (condition.type === "path") {
            const otherResults = await this.executePathCondition(references, unknown, condition);
            return results.filter(result => otherResults.some(factReferenceEquals(result[unknown.name])));
        }
        else if (condition.type === "existential") {
            const matchingReferences = await filterAsync(results, async result => {
                const matches = await this.executeMatches(result, condition.matches);
                return condition.exists ?
                    matches.length > 0 :
                    matches.length === 0;
            });
            return matchingReferences;
        }
        else {
            const _exhaustiveCheck: never = condition;
            throw new AuthorizationRuleError(`Unknown condition type: ${(_exhaustiveCheck as any).type}`);
        }
    }

    // A fact referenced by a multi-hop rule may live in an earlier flush batch
    // than the one currently being authorized (see GraphDeserializer's
    // flushThreshold). Such a fact is not in `factRecords`, but if it has
    // already been saved to the store, we can load it from there instead of
    // failing the whole authorization.
    private async findFact(reference: FactReference): Promise<FactRecord | null> {
        await this.ensureLoaded([reference]);
        return this.findFactSync(reference);
    }

    private findFactSync(reference: FactReference): FactRecord | null {
        return this.factRecords.find(factReferenceEquals(reference))
            ?? this.loadedRecords.find(factReferenceEquals(reference))
            ?? null;
    }

    // Resolves every reference not already known locally with as few
    // store.load() calls as possible: references still missing after
    // checking `factRecords` and the cache are fetched in a single batched
    // call, and concurrent requests for the same reference share one
    // in-flight load instead of issuing duplicate store reads.
    private async ensureLoaded(references: FactReference[]): Promise<void> {
        const missing = references.filter(r => !this.findFactSync(r));
        if (missing.length === 0) {
            return;
        }

        const pending = missing
            .map(r => this.pendingLoads.get(this.factKeyOf(r)))
            .filter((p): p is Promise<void> => p !== undefined);
        if (pending.length > 0) {
            await Promise.all(pending);
        }

        const toLoad = missing.filter(r => !this.findFactSync(r) && !this.pendingLoads.has(this.factKeyOf(r)));
        if (toLoad.length === 0) {
            return;
        }

        const loadPromise = (async () => {
            const envelopes = await this.store.load(toLoad);
            for (const envelope of envelopes) {
                if (!this.findFactSync(envelope.fact)) {
                    this.loadedRecords.push(envelope.fact);
                }
            }
        })();

        toLoad.forEach(r => this.pendingLoads.set(this.factKeyOf(r), loadPromise));
        try {
            await loadPromise;
        }
        finally {
            toLoad.forEach(r => this.pendingLoads.delete(this.factKeyOf(r)));
        }
    }

    private factKeyOf(reference: FactReference): string {
        return `${reference.type}:${reference.hash}`;
    }
}

interface AuthorizationRule {
    describe(type: string): string;
    isAuthorized(userFact: FactReference | null, fact: FactRecord, graph: FactGraph, store: Storage): Promise<boolean>;
    getAuthorizedPopulation(candidateKeys: string[], envelope: FactEnvelope, graph: FactGraph, store: Storage): Promise<AuthorizationPopulation>;
}

export class AuthorizationRuleAny implements AuthorizationRule {
    describe(type: string) {
        return `    any ${type}\n`;
    }

    isAuthorized(userFact: FactReference | null, fact: FactRecord, graph: FactGraph, store: Storage) {
        return Promise.resolve(true);
    }

    getAuthorizedPopulation(candidateKeys: string[], envelope: FactEnvelope, graph: FactGraph, store: Storage): Promise<AuthorizationPopulation> {
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

    getAuthorizedPopulation(candidateKeys: string[], envelope: FactEnvelope, graph: FactGraph, store: Storage): Promise<AuthorizationPopulation> {
        return Promise.resolve({
            quantifier: 'none'
        });
    }
}

export class AuthorizationRuleSpecification implements AuthorizationRule {
    constructor(
        private specification: Specification
    ) {
        // A rule is stored once and run on every save of the type it governs.
        // Refuse a specification that could never run, at the point it is written.
        validateSpecificationOrThrow(specification, "The specification of an authorization rule");
    }

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
            throw new AuthorizationRuleError('The specification must be given a single fact.');
        }

        // The projection must be a singular label.
        if (this.specification.projection.type !== 'fact') {
            throw new AuthorizationRuleError('The projection must be a singular label.');
        }
        const label = this.specification.projection.label;

        // Split the specification.
        // The head is deterministic, and can be run on the graph.
        // The tail is non-deterministic, and must be run on the store.
        const { head, tail } = splitBeforeFirstSuccessor(this.specification);

        // If there is no head, then the specification is unsatisfiable.
        if (head === undefined) {
            throw new AuthorizationRuleError('The specification must start with a predecessor join. Otherwise, it is unsatisfiable.');
        }

        // Execute the head on the graph.
        if (head.projection.type !== 'fact') {
            throw new AuthorizationRuleError('The head of the specification must project a fact.');
        }
        let results = await graph.executeSpecification(
            head.given[0].label.name,
            head.matches,
            head.projection.label,
            fact);

        // If there is a tail, execute it on the store.
        if (tail !== undefined) {
            if (tail.given.length !== 1) {
                throw new AuthorizationRuleError('The tail of the specification must be given a single fact.');
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

    async getAuthorizedPopulation(candidateKeys: string[], envelope: FactEnvelope, graph: FactGraph, store: Storage): Promise<AuthorizationPopulation> {
        if (candidateKeys.length === 0 && envelope.signatures.length === 0) {
            Trace.warn(`No candidate keys or signatures were given while attempting to authorize ${envelope.fact.type}.`);
            return {
                quantifier: 'none'
            };
        }

        // The specification must be given a single fact.
        if (this.specification.given.length !== 1) {
            throw new AuthorizationRuleError('The specification must be given a single fact.');
        }

        // The projection must be a singular label.
        if (this.specification.projection.type !== 'fact') {
            throw new AuthorizationRuleError('The projection must be a singular label.');
        }

        // Split the specification.
        // The head is deterministic, and can be run on the graph.
        // The tail is non-deterministic, and must be run on the store.
        const { head, tail } = splitBeforeFirstSuccessor(this.specification);

        // If there is no head, then the specification is unsatisfiable.
        if (head === undefined) {
            throw new AuthorizationRuleError('The specification must start with a predecessor join. Otherwise, it is unsatisfiable.');
        }

        // Execute the head on the graph.
        if (head.projection.type !== 'fact') {
            throw new AuthorizationRuleError('The head of the specification must project a fact.');
        }
        const results = await graph.executeSpecification(
            head.given[0].label.name,
            head.matches,
            head.projection.label,
            envelope.fact);

        const publicKeys: string[] = [];
        // If there is a tail, execute it on the store.
        if (tail !== undefined) {
            if (tail.given.length !== 1) {
                throw new AuthorizationRuleError('The tail of the specification must be given a single fact.');
            }
            for (const result of results) {
                const users = await store.read([result], tail);
                publicKeys.push(...users.map(user => user.result.publicKey));
            }
        }
        else {
            for (const result of results) {
                publicKeys.push(await graph.getField(result, 'publicKey'));
            }
        }

        // Find the intersection between the available keys and the public keys.
        const availableKeys = candidateKeys.concat(envelope.signatures.map(s => s.publicKey));
        const authorizedKeys = availableKeys.filter(key => publicKeys.some(publicKey => publicKey === key));

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
            throw new AuthorizationRuleError('The model must be given to define a rule using a specification.');
        }
        const specification = this.model.given(factConstructor).match<unknown>(definition);
        return this.withRule(type, new AuthorizationRuleSpecification(specification.specification));
    }

    private typeFromPredecessorSelector<T>(factConstructor: FactConstructor<T>, predecessorSelector: UserPredecessorSelector<T>): AuthorizationRules {
        const type = factConstructor.Type;
        if (this.model === undefined) {
            throw new AuthorizationRuleError('The model must be given to define a rule using a specification.');
        }
        const specification = this.model.given(factConstructor).match<unknown>((fact, facts) => {
            const label = predecessorSelector(fact);
            const payload = getPayload(label);
            if (payload instanceof Traversal) {
                const traversal = payload as Traversal<LabelOf<User> | LabelOf<Device>>;
                const projection = traversal.projection;
                if (projection.type !== 'fact') {
                    throw new AuthorizationRuleError('Authorization rules must select facts.');
                }
                const label = projection.label;
                const match = traversal.matches.find(m => m.unknown.name === label);
                if (match === undefined) {
                    throw new AuthorizationRuleError(`The traversal must match the label ${label}.`);
                }
                if (match.unknown.type !== User.Type && match.unknown.type !== Device.Type) {
                    throw new AuthorizationRuleError(`The traversal must match a user or device.`);
                }
                return traversal;
            }
            if (payload.type !== 'fact') {
                throw new AuthorizationRuleError('Authorization rules must select facts.');
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
                throw new AuthorizationRuleError(`Authorization rules must select users or devices.`);
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

    async getAuthorizedPopulationForEnvelope(candidateKeys: string[], envelope: FactEnvelope, factEnvelopes: FactEnvelope[], store: Storage): Promise<AuthorizationPopulation> {
        const rules = this.rulesByType[envelope.fact.type];
        if (!rules) {
            return {
                quantifier: 'none'
            };
        }

        const graph = new FactGraph(factEnvelopes.map(e => e.fact), store);
        let authorizedKeys: string[] = [];
        for (const rule of rules) {
            const population = await rule.getAuthorizedPopulation(candidateKeys, envelope, graph, store);
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
        let authorizationRules = AuthorizationRules.empty;
        while (!parser.atEnd()) {
            if (parser.continues("authorization")) {
                authorizationRules = authorizationRules.merge(parser.parseAuthorizationRules());
            }
            else {
                parser.expectEnd();
            }
        }
        return authorizationRules;
    }
}

export function describeAuthorizationRules(model: Model, authorization: (a: AuthorizationRules) => AuthorizationRules) {
    const rules = authorization(new AuthorizationRules(model));
    return rules.saveToDescription();
}