import { ExistentialCondition, Label, Match, PathCondition, Specification } from "../specification/specification";
import { FactBookmark, FactReference } from "../storage";
import { FactTypeMap, getFactTypeId, getRoleId, RoleMap } from "./maps";

function enforceGetFactTypeId(factTypes: FactTypeMap, factType: string): number {
    const factTypeId = getFactTypeId(factTypes, factType);
    if (factTypeId === undefined) {
        throw new Error(`Fact type ${factType} does not exist`);
    }
    return factTypeId;
}

function enforceGetRoleId(roleMap: RoleMap, factTypeId: number, role: string): number {
    const roleId = getRoleId(roleMap, factTypeId, role);
    if (roleId === undefined) {
        throw new Error(`Role ${role} does not exist`);
    }
    return roleId;
}

export interface SpecificationLabel {
    name: string;
    type: string;
    column: string;
}

export type SpecificationSqlQuery = {
    sql: string,
    parameters: (string | number)[],
    labels: SpecificationLabel[],
    bookmark: string
};

interface InputDescription {
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

interface FactDescription {
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
        return notExistsConditions.map((c, i) =>
            i === path[0] ?
                {
                    edges: [...c.edges, edge],
                    notExistsConditions: c.notExistsConditions
                } :
                c
        );
    }
    else {
        return notExistsConditions.map((c, i) =>
            i === path[0] ?
                {
                    edges: c.edges,
                    notExistsConditions: notExistsWithEdge(c.notExistsConditions, edge, path.slice(1))
                } :
                c
        );
    }
}

function notExistsWithCondition(notExistsConditions: NotExistsConditionDescription[], path: number[]) : { notExistsConditions: NotExistsConditionDescription[], path: number[] } {
    if (path.length === 0) {
        path = [ notExistsConditions.length ];
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
        notExistsConditions = notExistsConditions.map((c, i) =>
            i === path[0] ?
                {
                    edges: c.edges,
                    notExistsConditions: newNotExistsConditions
                } :
                c
        );
        path = [ path[0], ...newPath ];
        return { notExistsConditions, path };
    }
}

function countEdges(notExistsConditions: NotExistsConditionDescription[]): number {
    return notExistsConditions.reduce((count, c) =>
        count + c.edges.length + countEdges(c.notExistsConditions),
        0);
}

class QueryDescription {
    constructor(
        private readonly inputs: InputDescription[],
        private readonly parameters: (string | number)[],
        private readonly outputs: OutputDescription[],
        private readonly facts: FactDescription[],
        private readonly edges: EdgeDescription[],
        private readonly notExistsConditions: NotExistsConditionDescription[] = []
    ) {}

    public withParameter(parameter: string | number): { query: QueryDescription, parameterIndex: number } {
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
        const inputs = this.inputs.map(input =>
            input.label === label
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

    public withFact(type: string): { query: QueryDescription, factIndex: number } {
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

    public withNotExistsCondition(path: number[]): { query: QueryDescription, path: number[] } {
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

    hasOutput(label: string) {
        return this.outputs.some(o => o.label === label);
    }

    inputByLabel(label: string): InputDescription | undefined {
        return this.inputs.find(i => i.label === label);
    }

    factByLabel(label: string): FactDescription {
        const input = this.inputs.find(input => input.label === label);
        if (input === undefined) {
            const output = this.outputs.find(output => output.label === label);
            if (output === undefined) {
                const inputLabels = this.inputs.map(input => input.label);
                const outputLabels = this.outputs.map(output => output.label);
                const knownLabels = inputLabels.concat(outputLabels).join(", ");
                throw new Error(`Label ${label} not found. Known labels: ${knownLabels}`);
            }
            return this.facts.find(fact => fact.factIndex === output.factIndex)!;
        }
        return this.facts.find(fact => fact.factIndex === input.factIndex)!;
    }
    
    generateSqlQuery(limit: number): SpecificationSqlQuery {
        const hashes = this.outputs
            .map(output => `f${output.factIndex}.hash as hash${output.factIndex}`)
            .join(", ");
        const factIds = this.outputs
            .map(output => `f${output.factIndex}.fact_id`)
            .join(", ");
        const firstFactId = this.inputs[0].factIndex;
        const writtenFactIndexes = new Set<number>().add(firstFactId);
        const joins: string[] = generateJoins(this.edges, writtenFactIndexes);
        const inputWhereClauses = this.inputs
            .filter(input => input.factTypeParameter !== 0)
            .map(input => `f${input.factIndex}.fact_type_id = $${input.factTypeParameter} AND f${input.factIndex}.hash = $${input.factHashParameter}`)
            .join(" AND ");
        const notExistsWhereClauses = this.notExistsConditions
            .map(notExistsWhereClause => ` AND NOT EXISTS (${generateNotExistsWhereClause(notExistsWhereClause, writtenFactIndexes)})`)
            .join("");
        const limitParameter = this.parameters.length + 1;
        const sql = `SELECT ${hashes}, sort(array[${factIds}], 'desc') as bookmark FROM public.fact f${firstFactId}${joins.join("")} WHERE ${inputWhereClauses}${notExistsWhereClauses} ORDER BY bookmark ASC LIMIT $${limitParameter}`;
        return {
            sql,
            parameters: [ ...this.parameters, limit ],
            labels: this.outputs.map(output => ({
                name: output.label,
                type: output.type,
                column: `hash${output.factIndex}`
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
                )
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

class DescriptionBuilder {
    constructor(
        private factTypes: Map<string, number>,
        private roleMap: Map<number, Map<string, number>>) { }

    public buildDescriptions(start: FactReference[], specification: Specification): QueryDescription[] {
        // Verify that the number of start facts equals the number of inputs
        if (start.length !== specification.given.length) {
            throw new Error(`The number of start facts (${start.length}) does not equal the number of inputs (${specification.given.length})`);
        }
        // Verify that the input type matches the start fact type
        for (let i = 0; i < start.length; i++) {
            if (start[i].type !== specification.given[i].type) {
                throw new Error(`The type of start fact ${i} (${start[i].type}) does not match the type of input ${i} (${specification.given[i].type})`);
            }
        }

        const inputs: InputDescription[] = specification.given
            .map((label, i) => ({
                label: label.name,
                factIndex: i+1,
                factTypeId: enforceGetFactTypeId(this.factTypes, label.type),
                factHash: start[i].hash,
                factTypeParameter: 0,
                factHashParameter: 0
            }));
        const facts: FactDescription[] = specification.given
            .map((label, i) => ({
                factIndex: i+1,
                type: label.type
            }));
        const initialQueryDescription = new QueryDescription(inputs, [], [], facts, [], []);
        const queryDescriptions = this.addEdges(initialQueryDescription, [], specification.matches);
        return queryDescriptions;
    }

    private addEdges(queryDescription: QueryDescription, path: number[], matches: Match[]): QueryDescription[] {
        const queryDescriptions: QueryDescription[] = [];
        matches.forEach(match => {
            match.conditions.forEach(condition => {
                if (condition.type === "path") {
                    queryDescription = this.addPathCondition(queryDescription, path, match.unknown, condition);
                }
                else if (condition.type === "existential") {
                    if (condition.exists) {
                        const newQueryDescriptions = this.addEdges(queryDescription, path, condition.matches);
                        const last = newQueryDescriptions.length - 1;
                        queryDescriptions.push(...newQueryDescriptions.slice(0, last));
                        queryDescription = newQueryDescriptions[last];
                    }
                    else {
                        const newQueryDescriptions = this.addEdges(queryDescription, path, condition.matches);
                        queryDescriptions.push(...newQueryDescriptions);
                        const { query: queryDescriptionWithNotExist, path: conditionalPath } = queryDescription.withNotExistsCondition(path);
                        const newQueryDescriptionsWithNotExists = this.addEdges(queryDescriptionWithNotExist, conditionalPath, condition.matches);
                        const last = newQueryDescriptionsWithNotExists.length - 1;
                        queryDescriptions.push(...newQueryDescriptionsWithNotExists.slice(0, last));
                        queryDescription = newQueryDescriptionsWithNotExists[last];
                    }
                }
            });
        });
        queryDescriptions.push(queryDescription);
        return queryDescriptions;
    }

    addPathCondition(queryDescription: QueryDescription, path: number[], unknown: Label, condition: PathCondition): QueryDescription {
        const input = queryDescription.inputByLabel(condition.labelRight);
        if (input && input.factTypeParameter === 0) {
            queryDescription = queryDescription.withInputParameter(input.label);
        }

        const knownFact = queryDescription.hasOutput(unknown.name) ? queryDescription.factByLabel(unknown.name) : null;
        const roleCount = condition.rolesLeft.length + condition.rolesRight.length;

        let fact = queryDescription.factByLabel(condition.labelRight);
        let type = fact.type;
        let factIndex = fact.factIndex;
        condition.rolesRight.forEach((role, i) => {
            const typeId = enforceGetFactTypeId(this.factTypes, type);
            const roleId = enforceGetRoleId(this.roleMap, typeId, role.name);
            const { query: queryWithParameter, parameterIndex: roleParameter } = queryDescription.withParameter(roleId);
            if (i === roleCount && knownFact) {
                queryDescription = queryWithParameter.withEdge(knownFact.factIndex, factIndex, roleParameter, path);
                factIndex = knownFact.factIndex;
            }
            else {
                const { query, factIndex: predecessorFactIndex } = queryWithParameter.withFact(role.targetType);
                queryDescription = query.withEdge(predecessorFactIndex, factIndex, roleParameter, path);
                factIndex = predecessorFactIndex;
            }
            type = role.targetType;
        });

        type = unknown.type;
        const newEdges: {
            roleId: number,
            declaringType: string,
        }[] = [];
        condition.rolesLeft.forEach(role => {
            const typeId = enforceGetFactTypeId(this.factTypes, type);
            const roleId = enforceGetRoleId(this.roleMap, typeId, role.name);
            newEdges.push({
                roleId,
                declaringType: type
            });
            type = role.targetType;
        });
        newEdges.reverse().forEach(({ roleId, declaringType }, i) => {
            const { query: queryWithParameter, parameterIndex: roleParameter } = queryDescription.withParameter(roleId);
            if (condition.rolesLeft.length + i === roleCount && knownFact) {
                queryDescription = queryWithParameter.withEdge(factIndex, knownFact.factIndex, roleParameter, path);
                factIndex = knownFact.factIndex;
            }
            else {
                const { query: queryWithFact, factIndex: successorFactIndex } = queryWithParameter.withFact(declaringType);
                queryDescription = queryWithFact.withEdge(factIndex, successorFactIndex, roleParameter, path);
                factIndex = successorFactIndex;
            }
        });

        if (path.length === 0 && !knownFact) {
            queryDescription = queryDescription.withOutput(unknown.name, unknown.type, factIndex);
        }
        return queryDescription;
    }
}

export function sqlFromSpecification(start: FactReference[], bookmarks: FactBookmark[], limit: number, specification: Specification, factTypes: Map<string, number>, roleMap: Map<number, Map<string, number>>): SpecificationSqlQuery[] {
    const descriptionBuilder = new DescriptionBuilder(factTypes, roleMap);
    const descriptions = descriptionBuilder.buildDescriptions(start, specification);
    return descriptions.map(description => description.generateSqlQuery(limit));
}
