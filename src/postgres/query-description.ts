import { FactBookmark } from "../storage";

export interface SpecificationLabel {
    name: string;
    type: string;
    index: number;
}

export type SpecificationSqlQuery = {
    sql: string;
    parameters: (string | number | number[])[];
    labels: SpecificationLabel[];
    bookmark: string;
};
export interface InputDescription {
    label: string;
    factIndex: number;
    factTypeId: number;
    factHash: string;
    factTypeParameter: number;
    factHashParameter: number;
}
interface OutputDescription {
    label: string;
    type: string;
    factIndex: number;
}
export interface FactDescription {
    type: string;
    factIndex: number;
}
interface EdgeDescription {
    edgeIndex: number;
    predecessorFactIndex: number;
    successorFactIndex: number;
    roleParameter: number;
}
interface NotExistsConditionDescription {
    edges: EdgeDescription[];
    notExistsConditions: NotExistsConditionDescription[];
}
function notExistsWithEdge(notExistsConditions: NotExistsConditionDescription[], edge: { edgeIndex: number; predecessorFactIndex: number; successorFactIndex: number; roleParameter: number; }, path: number[]): NotExistsConditionDescription[] {
    if (path.length === 1) {
        return notExistsConditions.map((c, i) => i === path[0] ?
            {
                edges: [...c.edges, edge],
                notExistsConditions: c.notExistsConditions
            } :
            c
        );
    }
    else {
        return notExistsConditions.map((c, i) => i === path[0] ?
            {
                edges: c.edges,
                notExistsConditions: notExistsWithEdge(c.notExistsConditions, edge, path.slice(1))
            } :
            c
        );
    }
}
function notExistsWithCondition(notExistsConditions: NotExistsConditionDescription[], path: number[]): { notExistsConditions: NotExistsConditionDescription[]; path: number[]; } {
    if (path.length === 0) {
        path = [notExistsConditions.length];
        notExistsConditions = [
            ...notExistsConditions,
            {
                edges: [],
                notExistsConditions: []
            }
        ];
        return { notExistsConditions, path };
    }
    else {
        const { notExistsConditions: newNotExistsConditions, path: newPath } = notExistsWithCondition(notExistsConditions[path[0]].notExistsConditions, path.slice(1));
        notExistsConditions = notExistsConditions.map((c, i) => i === path[0] ?
            {
                edges: c.edges,
                notExistsConditions: newNotExistsConditions
            } :
            c
        );
        path = [path[0], ...newPath];
        return { notExistsConditions, path };
    }
}
function countEdges(notExistsConditions: NotExistsConditionDescription[]): number {
    return notExistsConditions.reduce((count, c) => count + c.edges.length + countEdges(c.notExistsConditions),
        0);
}
export class QueryDescription {
    // An unsatisfiable query description will produce no results.
    static unsatisfiable: QueryDescription = new QueryDescription(
        [], [], [], [], [], []
    );

    constructor(
        private readonly inputs: InputDescription[],
        private readonly parameters: (string | number)[],
        private readonly outputs: OutputDescription[],
        private readonly facts: FactDescription[],
        private readonly edges: EdgeDescription[],
        private readonly notExistsConditions: NotExistsConditionDescription[] = []
    ) {}

    public withParameter(parameter: string | number): { query: QueryDescription; parameterIndex: number; } {
        const parameterIndex = this.parameters.length + 1;
        const query = new QueryDescription(
            this.inputs,
            this.parameters.concat(parameter),
            this.outputs,
            this.facts,
            this.edges,
            this.notExistsConditions
        );
        return { query, parameterIndex };
    }

    public withInputParameter(label: string): QueryDescription {
        const factTypeParameter = this.parameters.length + 1;
        const factHashParameter = factTypeParameter + 1;
        const input = this.inputs.find(i => i.label === label);
        const inputs = this.inputs.map(input => input.label === label
            ? { ...input, factTypeParameter, factHashParameter }
            : input
        );
        return new QueryDescription(
            inputs,
            this.parameters.concat(input.factTypeId, input.factHash),
            this.outputs,
            this.facts,
            this.edges,
            this.notExistsConditions
        );
    }

    public withFact(type: string): { query: QueryDescription; factIndex: number; } {
        const factIndex = this.facts.length + 1;
        const fact = { factIndex, type };
        const query = new QueryDescription(
            this.inputs,
            this.parameters,
            this.outputs,
            this.facts.concat(fact),
            this.edges,
            this.notExistsConditions
        );
        return { query, factIndex };
    }

    public withOutput(label: string, type: string, factIndex: number): QueryDescription {
        const output = { label, type, factIndex };
        const query = new QueryDescription(
            this.inputs,
            this.parameters,
            this.outputs.concat(output),
            this.facts,
            this.edges,
            this.notExistsConditions
        );
        return query;
    }

    public withEdge(predecessorFactIndex: number, successorFactIndex: number, roleParameter: number, path: number[]) {
        const edge = {
            edgeIndex: this.edges.length + countEdges(this.notExistsConditions) + 1,
            predecessorFactIndex,
            successorFactIndex,
            roleParameter
        };
        const query = (path.length === 0)
            ? new QueryDescription(
                this.inputs,
                this.parameters,
                this.outputs,
                this.facts,
                this.edges.concat(edge),
                this.notExistsConditions
            )
            : new QueryDescription(
                this.inputs,
                this.parameters,
                this.outputs,
                this.facts,
                this.edges,
                notExistsWithEdge(this.notExistsConditions, edge, path)
            );
        return query;
    }

    public withNotExistsCondition(path: number[]): { query: QueryDescription; path: number[]; } {
        const { notExistsConditions: newNotExistsConditions, path: newPath } = notExistsWithCondition(this.notExistsConditions, path);
        const query = new QueryDescription(
            this.inputs,
            this.parameters,
            this.outputs,
            this.facts,
            this.edges,
            newNotExistsConditions
        );
        return { query, path: newPath };
    }

    isSatisfiable() {
        return this.inputs.length > 0;
    }

    hasOutput(label: string) {
        return this.outputs.some(o => o.label === label);
    }

    inputByLabel(label: string): InputDescription | undefined {
        return this.inputs.find(i => i.label === label);
    }

    generateSqlQuery(bookmarks: FactBookmark[], limit: number): SpecificationSqlQuery {
        const hashes = this.outputs
            .map(output => `f${output.factIndex}.hash as hash${output.factIndex}`)
            .join(", ");
        const factIds = this.outputs
            .map(output => `f${output.factIndex}.fact_id`)
            .join(", ");
        const firstEdge = this.edges[0];
        const predecessorFact = this.inputs.find(i => i.factIndex === firstEdge.predecessorFactIndex);
        const successorFact = this.inputs.find(i => i.factIndex === firstEdge.successorFactIndex);
        const firstFactIndex = predecessorFact ? predecessorFact.factIndex : successorFact.factIndex;
        const writtenFactIndexes = new Set<number>().add(firstFactIndex);
        const joins: string[] = generateJoins(this.edges, writtenFactIndexes);
        const inputWhereClauses = this.inputs
            .filter(input => input.factTypeParameter !== 0)
            .map(input => `f${input.factIndex}.fact_type_id = $${input.factTypeParameter} AND f${input.factIndex}.hash = $${input.factHashParameter}`)
            .join(" AND ");
        const notExistsWhereClauses = this.notExistsConditions
            .map(notExistsWhereClause => ` AND NOT EXISTS (${generateNotExistsWhereClause(notExistsWhereClause, writtenFactIndexes)})`)
            .join("");
        const bookmarkParameter = this.parameters.length + 1;
        const limitParameter = bookmarkParameter + 1;
        const bookmark = bookmarks.find(bookmark =>
            bookmark.labels.length === this.outputs.length &&
            bookmark.labels.every((label, index) => label === this.outputs[index].label)
        );
        const sql = `SELECT ${hashes}, sort(array[${factIds}], 'desc') as bookmark FROM public.fact f${firstFactIndex}${joins.join("")} WHERE ${inputWhereClauses}${notExistsWhereClauses} AND sort(array[${factIds}], 'desc') > $${bookmarkParameter} ORDER BY bookmark ASC LIMIT $${limitParameter}`;
        const bookmarkValue: number[] = parseBookmark(bookmark);
        return {
            sql,
            parameters: [...this.parameters, bookmarkValue, limit],
            labels: this.outputs.map(output => ({
                name: output.label,
                type: output.type,
                index: output.factIndex
            })),
            bookmark: "[]"
        };
    }

    generateResultSqlQuery(): SpecificationSqlQuery {
        const hashes = this.outputs
            .map(output => `f${output.factIndex}.hash as hash${output.factIndex}, f${output.factIndex}.data as data${output.factIndex}`)
            .join(", ");
        const firstEdge = this.edges[0];
        const predecessorFact = this.inputs.find(i => i.factIndex === firstEdge.predecessorFactIndex);
        const successorFact = this.inputs.find(i => i.factIndex === firstEdge.successorFactIndex);
        const firstFactIndex = predecessorFact ? predecessorFact.factIndex : successorFact.factIndex;
        const writtenFactIndexes = new Set<number>().add(firstFactIndex);
        const joins: string[] = generateJoins(this.edges, writtenFactIndexes);
        const inputWhereClauses = this.inputs
            .filter(input => input.factTypeParameter !== 0)
            .map(input => `f${input.factIndex}.fact_type_id = $${input.factTypeParameter} AND f${input.factIndex}.hash = $${input.factHashParameter}`)
            .join(" AND ");
        const notExistsWhereClauses = this.notExistsConditions
            .map(notExistsWhereClause => ` AND NOT EXISTS (${generateNotExistsWhereClause(notExistsWhereClause, writtenFactIndexes)})`)
            .join("");
        const sql = `SELECT ${hashes} FROM public.fact f${firstFactIndex}${joins.join("")} WHERE ${inputWhereClauses}${notExistsWhereClauses}`;
        return {
            sql,
            parameters: this.parameters,
            labels: this.outputs.map(output => ({
                name: output.label,
                type: output.type,
                index: output.factIndex
            })),
            bookmark: "[]"
        };
    }
}

function generateJoins(edges: EdgeDescription[], writtenFactIndexes: Set<number>) {
    const joins: string[] = [];
    edges.forEach(edge => {
        if (writtenFactIndexes.has(edge.predecessorFactIndex)) {
            if (writtenFactIndexes.has(edge.successorFactIndex)) {
                joins.push(
                    ` JOIN public.edge e${edge.edgeIndex}` +
                    ` ON e${edge.edgeIndex}.predecessor_fact_id = f${edge.predecessorFactIndex}.fact_id` +
                    ` AND e${edge.edgeIndex}.successor_fact_id = f${edge.successorFactIndex}.fact_id` +
                    ` AND e${edge.edgeIndex}.role_id = $${edge.roleParameter}`
                );
            }
            else {
                joins.push(
                    ` JOIN public.edge e${edge.edgeIndex}` +
                    ` ON e${edge.edgeIndex}.predecessor_fact_id = f${edge.predecessorFactIndex}.fact_id` +
                    ` AND e${edge.edgeIndex}.role_id = $${edge.roleParameter}`
                );
                joins.push(
                    ` JOIN public.fact f${edge.successorFactIndex}` +
                    ` ON f${edge.successorFactIndex}.fact_id = e${edge.edgeIndex}.successor_fact_id`
                );
                writtenFactIndexes.add(edge.successorFactIndex);
            }
        }
        else if (writtenFactIndexes.has(edge.successorFactIndex)) {
            joins.push(
                ` JOIN public.edge e${edge.edgeIndex}` +
                ` ON e${edge.edgeIndex}.successor_fact_id = f${edge.successorFactIndex}.fact_id` +
                ` AND e${edge.edgeIndex}.role_id = $${edge.roleParameter}`
            );
            joins.push(
                ` JOIN public.fact f${edge.predecessorFactIndex}` +
                ` ON f${edge.predecessorFactIndex}.fact_id = e${edge.edgeIndex}.predecessor_fact_id`
            );
            writtenFactIndexes.add(edge.predecessorFactIndex);
        }
        else {
            throw new Error("Neither predecessor nor successor fact has been written");
        }
    });
    return joins;
}

function generateNotExistsWhereClause(notExistsWhereClause: NotExistsConditionDescription, outerFactIndexes: Set<number>): string {
    const firstEdge = notExistsWhereClause.edges[0];
    const writtenFactIndexes = new Set<number>(outerFactIndexes);
    const firstJoin: string[] = [];
    const whereClause: string[] = [];
    if (writtenFactIndexes.has(firstEdge.predecessorFactIndex)) {
        if (writtenFactIndexes.has(firstEdge.successorFactIndex)) {
            throw new Error("Not yet implemented");
        }
        else {
            whereClause.push(
                `e${firstEdge.edgeIndex}.predecessor_fact_id = f${firstEdge.predecessorFactIndex}.fact_id` +
                ` AND e${firstEdge.edgeIndex}.role_id = $${firstEdge.roleParameter}`
            );
            firstJoin.push(
                ` JOIN public.fact f${firstEdge.successorFactIndex}` +
                ` ON f${firstEdge.successorFactIndex}.fact_id = e${firstEdge.edgeIndex}.successor_fact_id`
            );
            writtenFactIndexes.add(firstEdge.successorFactIndex);
        }
    }
    else if (writtenFactIndexes.has(firstEdge.successorFactIndex)) {
        whereClause.push(
            `e${firstEdge.edgeIndex}.successor_fact_id = f${firstEdge.successorFactIndex}.fact_id` +
            ` AND e${firstEdge.edgeIndex}.role_id = $${firstEdge.roleParameter}`
        );
        firstJoin.push(
            ` JOIN public.fact f${firstEdge.predecessorFactIndex}` +
            ` ON f${firstEdge.predecessorFactIndex}.fact_id = e${firstEdge.edgeIndex}.predecessor_fact_id`
        );
        writtenFactIndexes.add(firstEdge.predecessorFactIndex);
    }
    else {
        throw new Error("Neither predecessor nor successor fact has been written");
    }
    const tailJoins: string[] = generateJoins(notExistsWhereClause.edges.slice(1), writtenFactIndexes);
    const joins = firstJoin.concat(tailJoins);
    return `SELECT 1 FROM public.edge e${firstEdge.edgeIndex}${joins.join("")} WHERE ${whereClause.join(" AND ")}`;
}

function parseBookmark(bookmark: FactBookmark): number[] {
    if (bookmark === undefined || bookmark === null || bookmark.bookmark === "") {
        return [];
    }
    else {
        return bookmark.bookmark.split(".").map(str => parseInt(str));
    }
}
