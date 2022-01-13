import { Direction, ExistentialCondition, Join, PropertyCondition, Quantifier, Step } from '../query/steps';
import { FactReference, factReferenceEquals } from '../storage';
import { FactTypeMap, getFactTypeId, getRoleId, RoleMap } from "./maps";

export type SqlQuery = {
    sql: string,
    parameters: any[],
    pathLength: number
};

export function sqlFromSteps(start: FactReference, steps: Step[], factTypes: FactTypeMap, roleMap: RoleMap) : SqlQuery {
    const builder = new QueryBuilder(factTypes, roleMap);

    return builder.buildQuery(start, steps);
}

interface QueryJoinEdge {
    table: 'edge';
    direction: 'predecessor' | 'successor';
    edgeAlias: number;
    roleParameter: number;
    roleId: number;
}

interface QueryJoinFact {
    table: 'fact';
    factAlias: number;
}

type QueryJoin = QueryJoinEdge | QueryJoinFact;

interface QueryParts {
    joins: QueryJoin[];
    existentialClauses: ExistentialClause[];
};

interface ExistentialClause {
    quantifier: Quantifier;
    query: QueryParts;
}

interface QueryBuilderStatePredecessorType {
    state: 'predecessor-type';
    typeId: number;
}
interface QueryBuilderStateSuccessorType {
    state: 'successor-type';
    typeId: number;
}
interface QueryBuilderStatePredecessorJoin {
    state: 'predecessor-join';
}
interface QueryBuilderStateSuccessorJoin {
    state: 'successor-join';
    role: string;
}

type QueryBuilderState =
    QueryBuilderStatePredecessorType |
    QueryBuilderStateSuccessorType |
    QueryBuilderStatePredecessorJoin |
    QueryBuilderStateSuccessorJoin;

class QueryBuilder {
    private nextEdge: number = 1;
    private nextFact: number = 2;
    private queryParts: QueryParts = {
        joins: [],
        existentialClauses: []
    };

    constructor(private factTypes: FactTypeMap, private roleMap: RoleMap) {
    }

    buildQuery(start: FactReference, steps: Step[]): SqlQuery {
        if (steps.length === 0) {
            return null;
        }

        const startTypeId = getFactTypeId(this.factTypes, start.type);
        const startState: QueryBuilderState = {
            state: 'predecessor-type',
            typeId: startTypeId
        };
        const finalState = steps.reduce((state, step) => {
            return this.matchStep(state, step);
        }, startState);
        this.end(finalState);

        const factAliases = this.queryParts.joins
            .filter(j => j.table === 'fact')
            .map(j => (j as QueryJoinFact).factAlias);
        const hashes = factAliases.map(a => `f${a}.hash`).join(', ');
        const joins = this.buildJoins();
        const sql = `SELECT ${hashes} FROM public.fact f1 ${joins} WHERE f1.fact_type_id = $1 AND f1.hash = $2`;

        const roleIds = this.queryParts.joins
            .filter(j => j.table === 'edge')
            .map(j => (j as QueryJoinEdge).roleId);
        return {
            sql,
            parameters: [startTypeId, start.hash, ...roleIds],
            pathLength: factAliases.length
        };
    }

    private buildJoins() {
        const clauses = this.queryParts.joins.reduce((joins, join) => {
            if (join.table === 'edge') {
                if (join.direction === 'successor') {
                    const clause = `JOIN public.edge e${join.edgeAlias} ` +
                        `ON e${join.edgeAlias}.predecessor_fact_id = ${joins.priorFactId} ` +
                        `AND e${join.edgeAlias}.role_id = $${join.roleParameter}`;
                    return {
                        priorFactId: `e${join.edgeAlias}.successor_fact_id`,
                        clauses: [...joins.clauses, clause]
                    };
                }
                else {
                    const clause = `JOIN public.edge e${join.edgeAlias} ` +
                        `ON e${join.edgeAlias}.successor_fact_id = ${joins.priorFactId} ` +
                        `AND e${join.edgeAlias}.role_id = $${join.roleParameter}`;
                    return {
                        priorFactId: `e${join.edgeAlias}.predecessor_fact_id`,
                        clauses: [...joins.clauses, clause]
                    };
                }
            } else {
                const clause = `JOIN public.fact f${join.factAlias} ON f${join.factAlias}.fact_id = ${joins.priorFactId}`;
                return {
                    priorFactId: joins.priorFactId,
                    clauses: [...joins.clauses, clause]
                };
            }
        }, {
            priorFactId: 'f1.fact_id',
            clauses: []
        }).clauses;
        return clauses.join(' ');
    }
    
    buildNestedSql(typeId: number, steps: Step[]): QueryParts {
        // Push a new query to the stack.
        const parentQuery = this.queryParts;
        this.queryParts = {
            joins: [],
            existentialClauses: []
        };

        const startState: QueryBuilderState = {
            state: 'predecessor-type',
            typeId: typeId
        };
        const finalState = steps.reduce((state, step) => {
            return this.matchStep(state, step);
        }, startState);
        this.end(finalState);

        // Pop the stack and return the nested query.
        const nestedQuery = this.queryParts;
        this.queryParts = parentQuery;
        return nestedQuery;
    }

    private matchStep(state: QueryBuilderState, step: Step): QueryBuilderState {
        switch (state.state) {
            case 'predecessor-type':
                return this.matchStepPredecessorType(state, step);
            case 'predecessor-join':
                return this.matchStepPredecessorJoin(state, step);
            case 'successor-join':
                return this.matchStepSuccessorJoin(state, step);
            case 'successor-type':
                return this.matchStepSuccessorType(state, step);
        }
    }

    private matchStepPredecessorType(state: QueryBuilderStatePredecessorType, step: Step): QueryBuilderState {
        if (step instanceof PropertyCondition) {
            if (step.name !== 'type') {
                throw new Error(`Property condition on non-type property ${step.name}`);
            }
            const typeId = getFactTypeId(this.factTypes, step.value);
            if (typeId !== state.typeId) {
                throw new Error(`Two property conditions in a row on different types, ending in ${step.value}`);
            }
            return state;
        }
        if (step instanceof Join) {
            if (step.direction === Direction.Predecessor) {
                const roleId = getRoleId(this.roleMap, state.typeId, step.role);
                if (!roleId) {
                    throw new Error(`Role ${step.role} not found in type id ${state.typeId}`);
                }
                this.emitEdge('predecessor', roleId);
                return {
                    state: 'predecessor-join'
                }
            }
            if (step.direction === Direction.Successor) {
                return {
                    state: 'successor-join',
                    role: step.role
                }
            }
        }
        throw new Error(`Cannot yet handle step ${step.constructor.name} from predecessor type state`);
    }

    private matchStepPredecessorJoin(state: QueryBuilderStatePredecessorJoin, step: Step): QueryBuilderState {
        if (step instanceof PropertyCondition) {
            if (step.name !== 'type') {
                throw new Error(`Property condition on non-type property ${step.name}`);
            }
            const typeId = getFactTypeId(this.factTypes, step.value);
            return {
                state: 'predecessor-type',
                typeId
            };
        }
        throw new Error(`Cannot yet handle step ${step.constructor.name} from predecessor join state`);
    }

    private matchStepSuccessorJoin(state: QueryBuilderStateSuccessorJoin, step: Step): QueryBuilderState {
        if (step instanceof PropertyCondition) {
            if (step.name !== 'type') {
                throw new Error(`Property condition on non-type property ${step.name}`);
            }
            const typeId = getFactTypeId(this.factTypes, step.value);
            if (!typeId) {
                throw new Error(`Unknown type ${step.value}`);
            }
            const roleId = getRoleId(this.roleMap, typeId, state.role);
            if (!roleId) {
                throw new Error(`Role ${state.role} not found in type ${step.value}`);
            }
            this.emitEdge('successor', roleId);
            return {
                state: 'successor-type',
                typeId: typeId
            };
        }
        throw new Error(`Cannot yet handle step ${step.constructor.name} from successor join state`);
    }

    private matchStepSuccessorType(state: QueryBuilderStateSuccessorType, step: Step): QueryBuilderState {
        if (step instanceof PropertyCondition) {
            if (step.name !== 'type') {
                throw new Error(`Property condition on non-type property ${step.name}`);
            }
            const typeId = getFactTypeId(this.factTypes, step.value);
            if (typeId !== state.typeId) {
                throw new Error(`Two property conditions in a row on different types, ending in ${step.value}`);
            }
            return state;
        }
        else if (step instanceof Join) {
            if (step.direction === Direction.Predecessor) {
                const roleId = getRoleId(this.roleMap, state.typeId, step.role);
                this.emitFact();
                this.emitEdge('predecessor', roleId);
                return {
                    state: 'predecessor-join'
                };
            }
            else {
                return {
                    state: 'successor-join',
                    role: step.role
                };
            }
        }
        else if (step instanceof ExistentialCondition) {
            const nested: QueryParts = this.buildNestedSql(state.typeId, step.steps);
            this.queryParts.existentialClauses.push({ quantifier: step.quantifier, query: nested });
            return state;
        }
        throw new Error(`Cannot yet handle step ${step.constructor.name} from successor type state`);
    }

    private end(finalState: QueryBuilderState) {
        if (finalState.state === 'successor-join') {
            throw new Error(`Missing type for role ${finalState.role}`);
        }
        else {
            this.emitFact();
        }
    }

    private emitEdge(direction: 'predecessor' | 'successor', roleId: number) {
        const edgeAlias = this.nextEdge++;
        this.queryParts.joins.push({
            table: 'edge',
            direction: direction,
            edgeAlias: edgeAlias,
            roleParameter: edgeAlias + 2,
            roleId
        });
    }

    private emitFact() {
        const factAlias = this.nextFact++;
        this.queryParts.joins.push({
            table: 'fact',
            factAlias: factAlias
        });
    }
}
