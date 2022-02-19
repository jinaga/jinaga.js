import { Direction, ExistentialCondition, Join, PropertyCondition, Quantifier, Step } from '../query/steps';
import { FactReference } from '../storage';
import { FactTypeMap, getFactTypeId, getRoleId, RoleMap } from "./maps";

export type SqlQuery = {
    empty: boolean,
    sql: string,
    parameters: any[],
    pathLength: number,
    factTypeNames: string[]
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
    existentialClauses: ExistentialClause[];
};

interface ExistentialClause {
    quantifier: Quantifier;
    priorEdgeJoin: QueryJoinEdge;
    query: QueryParts;
}

interface QueryBuilderStateStart {
    state: 'start';
    typeId: number;
    typeName: string;
}
interface QueryBuilderStatePredecessorType {
    state: 'predecessor-type';
    typeId: number;
    typeName: string;
}
interface QueryBuilderStateSuccessorType {
    state: 'successor-type';
    typeId: number;
    typeName: string;
}
interface QueryBuilderStatePredecessorJoin {
    state: 'predecessor-join';
    position: string;
}
interface QueryBuilderStateSuccessorJoin {
    state: 'successor-join';
    role: string;
}
interface QueryBuilderStateEmpty {
    state: 'empty';
}

type QueryBuilderState =
    QueryBuilderStateStart |
    QueryBuilderStatePredecessorType |
    QueryBuilderStateSuccessorType |
    QueryBuilderStatePredecessorJoin |
    QueryBuilderStateSuccessorJoin |
    QueryBuilderStateEmpty;

class QueryBuilder {
    private nextEdge: number = 1;
    private nextFact: number = 2;
    private shouldEmitFacts: boolean = true;
    private queryParts: QueryParts = {
        joins: [],
        existentialClauses: []
    };
    private roleIds: number[] = [];
    private factTypeNames: string[] = [];

    constructor(private factTypes: FactTypeMap, private roleMap: RoleMap) {
    }

    buildQuery(start: FactReference, steps: Step[]): SqlQuery {
        if (steps.length === 0) {
            return null;
        }

        const startTypeId = getFactTypeId(this.factTypes, start.type);
        const startState: QueryBuilderState = {
            state: 'start',
            typeId: startTypeId,
            typeName: start.type
        };
        const finalState = steps.reduce((state, step) => {
            return this.matchStep(state, step);
        }, startState);
        this.end(finalState);

        if (finalState.state === 'empty') {
            return {
                empty: true,
                sql: '',
                parameters: [],
                pathLength: 0,
                factTypeNames: []
            };
        }

        const factAliases = this.queryParts.joins
            .filter(j => j.table === 'fact')
            .map(j => (j as QueryJoinFact).factAlias);
        const hashes = factAliases.map(a => `f${a}.hash as hash${a}`).join(', ');
        const joins = this.buildJoins(this.queryParts.joins, 'f1.fact_id');
        const whereClause = this.buildWhereClause(this.queryParts.existentialClauses);
        const sql = `SELECT ${hashes} FROM public.fact f1${joins} WHERE f1.fact_type_id = $1 AND f1.hash = $2${whereClause}`;

        return {
            empty: false,
            sql,
            parameters: [startTypeId, start.hash, ...this.roleIds],
            pathLength: factAliases.length,
            factTypeNames: this.factTypeNames
        };
    }

    private buildJoins(joins: QueryJoin[], priorFactId: string) {
        const clauses = joins.reduce((joins, join) => {
            if (join.table === 'edge') {
                if (join.direction === 'successor') {
                    const clause = ` JOIN public.edge e${join.edgeAlias} ` +
                        `ON e${join.edgeAlias}.predecessor_fact_id = ${joins.priorFactId} ` +
                        `AND e${join.edgeAlias}.role_id = $${join.roleParameter}`;
                    return {
                        priorFactId: `e${join.edgeAlias}.successor_fact_id`,
                        clauses: [...joins.clauses, clause]
                    };
                }
                else {
                    const clause = ` JOIN public.edge e${join.edgeAlias} ` +
                        `ON e${join.edgeAlias}.successor_fact_id = ${joins.priorFactId} ` +
                        `AND e${join.edgeAlias}.role_id = $${join.roleParameter}`;
                    return {
                        priorFactId: `e${join.edgeAlias}.predecessor_fact_id`,
                        clauses: [...joins.clauses, clause]
                    };
                }
            } else {
                const clause = ` JOIN public.fact f${join.factAlias} ON f${join.factAlias}.fact_id = ${joins.priorFactId}`;
                return {
                    priorFactId: joins.priorFactId,
                    clauses: [...joins.clauses, clause]
                };
            }
        }, {
            priorFactId,
            clauses: []
        }).clauses;
        return clauses.join('');
    }

    buildWhereClause(existentialClauses: ExistentialClause[]): string {
        if (existentialClauses.length === 0) {
            return '';
        }

        const clauses = existentialClauses.map(clause => {
            const quantifierSql = clause.quantifier === Quantifier.Exists ? 'EXISTS' : 'NOT EXISTS';
            const [first, ...rest] : QueryJoinEdge[] = clause.query.joins as QueryJoinEdge[];
            const firstHeadFactId = first.direction === 'predecessor'
                ? `e${first.edgeAlias}.predecessor_fact_id`
                : `e${first.edgeAlias}.successor_fact_id`;
            const firstTailFactId = first.direction === 'predecessor'
                ? `e${first.edgeAlias}.successor_fact_id`
                : `e${first.edgeAlias}.predecessor_fact_id`;
            const joins = this.buildJoins(rest, firstHeadFactId);
            const priorFactId = clause.priorEdgeJoin.direction === 'predecessor'
                ? `e${clause.priorEdgeJoin.edgeAlias}.predecessor_fact_id`
                : `e${clause.priorEdgeJoin.edgeAlias}.successor_fact_id`;
            const whereClause = this.buildWhereClause(clause.query.existentialClauses);
            return ` AND ${quantifierSql} (SELECT 1 FROM public.edge e${first.edgeAlias}${joins} ` +
                `WHERE ${firstTailFactId} = ${priorFactId} ` +
                `AND e${first.edgeAlias}.role_id = $${first.roleParameter}${whereClause})`;
        });
        return clauses.join('');
    }

    buildNestedSql(typeId: number, typeName: string, steps: Step[]): QueryParts | null {
        // Push a new query to the stack.
        const parentQuery = this.queryParts;
        const parentShouldEmitFact = this.shouldEmitFacts;
        this.shouldEmitFacts = false;
        this.queryParts = {
            joins: [],
            existentialClauses: []
        };

        const startState: QueryBuilderState = {
            state: 'predecessor-type',
            typeId: typeId,
            typeName: typeName
        };
        const finalState = steps.reduce((state, step) => {
            return this.matchStep(state, step);
        }, startState);
        this.end(finalState);

        // Pop the stack and return the nested query.
        const nestedQuery = this.queryParts;
        this.shouldEmitFacts = parentShouldEmitFact;
        this.queryParts = parentQuery;

        // If the nested query cannot match any results, return null.
        if (finalState.state === 'empty') {
            return null;
        }
        return nestedQuery;
    }

    private matchStep(state: QueryBuilderState, step: Step): QueryBuilderState {
        switch (state.state) {
            case 'start':
                return this.matchStepStart(state, step);
            case 'predecessor-type':
                return this.matchStepPredecessorType(state, step);
            case 'predecessor-join':
                return this.matchStepPredecessorJoin(state, step);
            case 'successor-join':
                return this.matchStepSuccessorJoin(state, step);
            case 'successor-type':
                return this.matchStepSuccessorType(state, step);
            case 'empty':
                return state;
            default:
                throw new Error(`Unknown state: ${(state as any).state}`);
        }
    }

    private matchStepStart(state: QueryBuilderStateStart, step: Step): QueryBuilderState {
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
                if (!roleId) {
                    return {
                        state: 'empty'
                    };
                }
                this.emitEdge('predecessor', roleId);
                return {
                    state: 'predecessor-join',
                    position: `${state.typeName}.${step.role}`
                }
            }
            if (step.direction === Direction.Successor) {
                return {
                    state: 'successor-join',
                    role: step.role
                }
            }
        }
        else if (step instanceof ExistentialCondition) {
            return this.pushExistentialCondition(state.typeId, state.typeName, state, step);
        }
        else {
            throw new Error(`Unknown step ${step.constructor.name}`);
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
        else if (step instanceof Join) {
            if (step.direction === Direction.Predecessor) {
                const roleId = getRoleId(this.roleMap, state.typeId, step.role);
                if (!roleId) {
                    return {
                        state: 'empty'
                    };
                }
                this.emitFact(state.typeName);
                this.emitEdge('predecessor', roleId);
                return {
                    state: 'predecessor-join',
                    position: `${state.typeName}.${step.role}`
                }
            }
            if (step.direction === Direction.Successor) {
                this.emitFact(state.typeName);
                return {
                    state: 'successor-join',
                    role: step.role
                }
            }
        }
        else if (step instanceof ExistentialCondition) {
            return this.pushExistentialCondition(state.typeId, state.typeName, state, step);
        }
        else {
            throw new Error(`Unknown step ${step.constructor.name}`);
        }
    }

    private matchStepPredecessorJoin(state: QueryBuilderStatePredecessorJoin, step: Step): QueryBuilderState {
        if (step instanceof PropertyCondition) {
            if (step.name !== 'type') {
                throw new Error(`Property condition on non-type property ${step.name}`);
            }
            const typeId = getFactTypeId(this.factTypes, step.value);
            if (!typeId) {
                return {
                    state: 'empty'
                };
            }
            return {
                state: 'predecessor-type',
                typeId,
                typeName: step.value
            };
        }
        else {
            throw new Error(`Missing type of "${state.position}"`);
        }
    }

    private matchStepSuccessorJoin(state: QueryBuilderStateSuccessorJoin, step: Step): QueryBuilderState {
        if (step instanceof PropertyCondition) {
            if (step.name !== 'type') {
                throw new Error(`Property condition on non-type property ${step.name}`);
            }
            const typeId = getFactTypeId(this.factTypes, step.value);
            if (!typeId) {
                return {
                    state: 'empty'
                };
            }
            const roleId = getRoleId(this.roleMap, typeId, state.role);
            if (!roleId) {
                return {
                    state: 'empty'
                };
            }
            this.emitEdge('successor', roleId);
            return {
                state: 'successor-type',
                typeId: typeId,
                typeName: step.value
            };
        }
        else {
            throw new Error(`Missing type for role ${state.role}`);
        }
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
                if (!roleId) {
                    return {
                        state: 'empty'
                    };
                }
                this.emitFact(state.typeName);
                this.emitEdge('predecessor', roleId);
                return {
                    state: 'predecessor-join',
                    position: `${state.typeName}.${step.role}`
                };
            }
            else {
                this.emitFact(state.typeName);
                return {
                    state: 'successor-join',
                    role: step.role
                };
            }
        }
        else if (step instanceof ExistentialCondition) {
            return this.pushExistentialCondition(state.typeId, state.typeName, state, step);
        }
        else {
            throw new Error(`Unknown step ${step.constructor.name}`);
        }
    }

    private end(finalState: QueryBuilderState) {
        if (finalState.state === 'successor-join') {
            throw new Error(`Missing type for role ${finalState.role}`);
        }
        else if (finalState.state === 'predecessor-join') {
            throw new Error(`Missing type of "${finalState.position}"`);
        }
        else if (finalState.state === 'predecessor-type' || finalState.state === 'successor-type') {
            this.emitFact(finalState.typeName);
        }
    }

    private emitEdge(direction: 'predecessor' | 'successor', roleId: number) {
        const edgeAlias = this.nextEdge++;
        this.roleIds.push(roleId);
        this.queryParts.joins.push({
            table: 'edge',
            direction: direction,
            edgeAlias: edgeAlias,
            roleParameter: edgeAlias + 2
        });
    }

    private emitFact(factTypeName: string) {
        if (this.shouldEmitFacts) {
            const factAlias = this.nextFact++;
            this.queryParts.joins.push({
                table: 'fact',
                factAlias: factAlias
            });
            this.factTypeNames.push(factTypeName);
        }
    }

    private pushExistentialCondition(typeId: number, typeName: string, state: QueryBuilderState, step: ExistentialCondition): QueryBuilderState {
        const nested = this.buildNestedSql(typeId, typeName, step.steps);
        if (!nested) {
            if (step.quantifier === Quantifier.Exists) {
                // An empty positive existential condition cannot match any facts.
                return {
                    state: 'empty'
                };
            }
            else {
                // An empty negative existential condition cannot exclude any facts.
                return state;
            }
        }
        const lastJoin = this.queryParts.joins[this.queryParts.joins.length - 1];
        if (lastJoin.table !== 'edge') {
            throw new Error(`Existential condition on non-edge table ${lastJoin.table}`);
        }
        this.queryParts.existentialClauses.push({
            quantifier: step.quantifier,
            priorEdgeJoin: lastJoin,
            query: nested
        });
        return state;
    }
}
