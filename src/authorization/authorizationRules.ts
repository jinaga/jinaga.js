import { getPredecessors } from '../memory/memory-store';
import { Query } from '../query/query';
import { Preposition } from '../query/query-parser';
import { Direction, Join, PropertyCondition, Step } from '../query/steps';
import { FactRecord, FactReference, factReferenceEquals, Storage } from '../storage';
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

class AuthorizationRuleBy implements AuthorizationRule {
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

export class AuthorizationRules {
    private rulesByType: {[type: string]: AuthorizationRule[]} = {};

    with(rules: (r: AuthorizationRules) => AuthorizationRules) {
        return rules(this);
    }

    no(type: string) {
        return this.withRule(type, new AuthorizationRuleNone());
    }

    any(type: string) {
        return this.withRule(type, new AuthorizationRuleAny());
    }

    type<T, U>(type: string, preposition: Preposition<T, U>) {
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
        return this.withRule(type, new AuthorizationRuleBy(head, tail));
    }

    private withRule(type: string, rule: AuthorizationRule) {
        const oldRules = this.rulesByType[type] || [];
        const newRules = [...oldRules, rule];
        const newRulesByType = { ...this.rulesByType, [type]: newRules };
        const result = new AuthorizationRules();
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