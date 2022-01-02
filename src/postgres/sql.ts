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
}

interface QueryJoinFact {
    table: 'fact';
    factAlias: number;
}

type QueryJoin = QueryJoinEdge | QueryJoinFact;

interface QueryParts {
    joins: QueryJoin[];
};

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
    private queryParts: QueryParts = {
        joins: []
    };
    private roleParameters: number[] = [];

    constructor(private factTypes: FactTypeMap, private roleMap: RoleMap) {
    }

    buildQuery(start: FactReference, steps: Step[]): SqlQuery {
        const startState: QueryBuilderState = {
            state: 'predecessor-type',
            typeId: getFactTypeId(this.factTypes, start.type)
        };
        const finalState = steps.reduce((state, step) => {
            return this.matchStep(state, step);
        }, startState);
        this.end(finalState);

        const hashes = `f2.hash`;
        const joins = this.buildJoins();
        const sql = `SELECT ${hashes} FROM public.fact f1 ${joins} WHERE f1.fact_type_id = $1 AND f1.hash = $2`;

        return {
            sql,
            parameters: [],
            pathLength: 0
        };
    }

    private buildJoins() {
        const clauses = this.queryParts.joins.reduce((joins, join) => {
            if (join.table === 'edge') {
                if (join.direction === 'successor') {
                    const clause = `JOIN public.edge e${join.edgeAlias} ` +
                        `ON e${join.edgeAlias}.predecessor_fact_id = ${joins.priorFactId} ` +
                        `AND e${join.edgeAlias}.role_id = %${join.roleParameter}`;
                    return {
                        priorFactId: `e${join.edgeAlias}.successor_fact_id`,
                        clauses: [...joins.clauses, clause]
                    };
                }
                else {
                    const clause = `JOIN public.edge e${join.edgeAlias} ` +
                        `ON e${join.edgeAlias}.successor_fact_id = ${joins.priorFactId} ` +
                        `AND e${join.edgeAlias}.role_id = %${join.roleParameter}`;
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

    matchStep(state: QueryBuilderState, step: Step): QueryBuilderState {
        switch (state.state) {
            case 'predecessor-type':
                return this.matchStepPredecessorType(state, step);
            case 'successor-join':
                return this.matchStepSuccessorJoin(state, step);
            default:
                throw new Error(`Unknown state ${state.state}`);
        }
    }

    matchStepPredecessorType(state: QueryBuilderStatePredecessorType, step: Step): QueryBuilderState {
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

    matchStepSuccessorJoin(state: QueryBuilderStateSuccessorJoin, step: Step): QueryBuilderState {
        if (step instanceof PropertyCondition) {
            if (step.name !== 'type') {
                throw new Error(`Property condition on non-type property ${step.name}`);
            }
            const typeId = getFactTypeId(this.factTypes, step.value);
            const roleId = getRoleId(this.roleMap, typeId, state.role);
            this.emitEdge('successor', roleId);
            return {
                state: 'successor-type',
                typeId: typeId
            };
        }
        throw new Error(`Cannot yet handle step ${step.constructor.name} from successor join state`);
    }

    end(finalState: QueryBuilderState) {
        if (finalState.state === 'successor-type') {
            this.emitFact();
        }
    }

    emitEdge(direction: 'predecessor' | 'successor', roleId: number) {
        this.roleParameters.push(roleId);
        this.queryParts.joins.push({
            table: 'edge',
            direction: direction,
            edgeAlias: this.queryParts.joins.filter(j => j.table === 'edge').length + 1,
            roleParameter: this.roleParameters.length + 2
        });
    }

    emitFact() {
        this.queryParts.joins.push({
            table: 'fact',
            factAlias: this.queryParts.joins.filter(j => j.table === 'fact').length + 2
        });
    }
}
