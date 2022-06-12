import { Match, PathCondition, Specification } from "../specification/specification";
import { FactReference } from "../storage";
import { getFactTypeId, getRoleId } from "./maps";

export type SpecificationSqlQuery = {
    sql: string,
    parameters: (string | number)[],
    labels: string[]
};

interface InputDescription {
    label: string;
    factIndex: number;
    factTypeParameter: number;
    factHashParameter: number;
}

interface OutputDescription {
    label: string;
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

class QueryDescription {
    constructor(
        private readonly inputs: InputDescription[],
        private readonly parameters: (string | number)[],
        private readonly outputs: OutputDescription[],
        private readonly facts: FactDescription[],
        private readonly edges: EdgeDescription[]
    ) {}

    public withParameter(parameter: string | number): { query: QueryDescription, parameterIndex: number } {
        const parameterIndex = this.parameters.length + 1;
        const query = new QueryDescription(
            this.inputs,
            this.parameters.concat(parameter),
            this.outputs,
            this.facts,
            this.edges
        );
        return { query, parameterIndex };
    }

    public withFact(type: string): { query: QueryDescription, factIndex: number } {
        const factIndex = this.facts.length + 1;
        const fact = { factIndex, type };
        const query = new QueryDescription(
            this.inputs,
            this.parameters,
            this.outputs,
            this.facts.concat(fact),
            this.edges
        );
        return { query, factIndex };
    }

    public withOutput(label: string, factIndex: number): QueryDescription {
        const output = { label, factIndex };
        const query = new QueryDescription(
            this.inputs,
            this.parameters,
            this.outputs.concat(output),
            this.facts,
            this.edges
        );
        return query;
    }

    public withEdge(predecessorFactIndex: number, successorFactIndex: number, roleParameter: number) {
        const edge = {
            edgeIndex: this.edges.length + 1,
            predecessorFactIndex,
            successorFactIndex,
            roleParameter
        };
        const query = new QueryDescription(
            this.inputs,
            this.parameters,
            this.outputs,
            this.facts,
            this.edges.concat(edge)
        );
        return query;
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
    
    generateSqlQuery(): SpecificationSqlQuery {
        const hashes = this.outputs
            .map(output => `f${output.factIndex}.hash as hash${output.factIndex}`)
            .join(" ");
        const tables = this.inputs
            .map(input => `public.fact f${input.factIndex}`)
            .join(", ");
        const joins: string[] = [];
        const writtenFactIndexes = new Set<number>(this.inputs.map(input => input.factIndex));
        this.edges.forEach(edge => {
            if (writtenFactIndexes.has(edge.predecessorFactIndex)) {
                if (writtenFactIndexes.has(edge.successorFactIndex)) {
                    throw new Error("Not yet implemented");
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
        const sql = `SELECT ${hashes} FROM ${tables}${joins.join("")}`;
        return {
            sql,
            parameters: this.parameters,
            labels: this.inputs.map(input => input.label)
        };
    }
}

class DescriptionBuilder {
    constructor(
        private factTypes: Map<string, number>,
        private roleMap: Map<number, Map<string, number>>) { }

    public buildDescriptions(start: FactReference[], specification: Specification): QueryDescription[] {
        // TODO: Verify that the number of start facts equals the number of inputs
        const inputs: InputDescription[] = specification.given
            .map((label, i) => ({
                label: label.name,
                factIndex: i+1,
                factTypeParameter: i*2 + 1,
                factHashParameter: i*2 + 2
            }));
        const parameters: (string | number)[] = specification.given
            .flatMap((label, i) => [
                // TODO: Verify that the input type matches the start fact type
                getFactTypeId(this.factTypes, label.type),
                start[i].hash
            ]);
        const facts: FactDescription[] = specification.given
            .map((label, i) => ({
                factIndex: i+1,
                type: label.type
            }));
        const initialQueryDescription = new QueryDescription(inputs, parameters, [], facts, []);
        const queryDescriptions = this.addEdges(initialQueryDescription, specification.matches);
        return queryDescriptions;
    }

    private addEdges(queryDescription: QueryDescription, matches: Match[]): QueryDescription[] {
        const queryDescriptions: QueryDescription[] = [];
        matches.forEach(match => {
            match.conditions.forEach(condition => {
                if (condition.type === "path") {
                    let fact = queryDescription.factByLabel(condition.labelRight);
                    let type = fact.type;
                    let factIndex = fact.factIndex;
                    condition.rolesRight.forEach(role => {
                        const typeId = getFactTypeId(this.factTypes, type);
                        const roleId = getRoleId(this.roleMap, typeId, role.name);
                        const { query: queryWithParameter, parameterIndex: roleParameter } = queryDescription.withParameter(roleId);
                        const { query, factIndex: predecessorFactIndex } = queryWithParameter.withFact(role.targetType);
                        queryDescription = query.withEdge(predecessorFactIndex, factIndex, roleParameter);
                        type = role.targetType;
                        factIndex = predecessorFactIndex;
                    });

                    type = match.unknown.type;
                    const newEdges: {
                        roleId: number,
                        declaringType: string,
                    }[] = [];
                    condition.rolesLeft.forEach(role => {
                        const typeId = getFactTypeId(this.factTypes, type);
                        const roleId = getRoleId(this.roleMap, typeId, role.name);
                        newEdges.push({
                            roleId,
                            declaringType: type
                        });
                        type = role.targetType;
                    });
                    newEdges.reverse().forEach(({ roleId, declaringType }) => {
                        const { query: queryWithParameter, parameterIndex: roleParameter } = queryDescription.withParameter(roleId);
                        const { query: queryWithFact, factIndex: successorFactIndex } = queryWithParameter.withFact(declaringType);
                        queryDescription = queryWithFact.withEdge(factIndex, successorFactIndex, roleParameter);
                        factIndex = successorFactIndex;
                    });

                    queryDescription = queryDescription.withOutput(match.unknown.name, factIndex);
                }
            });
        });
        queryDescriptions.push(queryDescription);
        return queryDescriptions;
    }
}

export function sqlFromSpecification(start: FactReference[], specification: Specification, factTypes: Map<string, number>, roleMap: Map<number, Map<string, number>>): SpecificationSqlQuery[] {
    const descriptionBuilder = new DescriptionBuilder(factTypes, roleMap);
    const descriptions = descriptionBuilder.buildDescriptions(start, specification);
    return descriptions.map(description => description.generateSqlQuery());
}
