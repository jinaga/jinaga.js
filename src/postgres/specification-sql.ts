import { PathCondition, Specification } from "../specification/specification";
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

class QueryDescription {
    constructor(
        private readonly inputs: InputDescription[],
        private readonly parameters: (string | number)[],
        private readonly outputs: OutputDescription[]
    ) {}
    
    generateSqlQuery(): SpecificationSqlQuery {
        const hashes = this.outputs
            .map(output => `f${output.factIndex}.hash as hash${output.factIndex}`)
            .join(" ");
        const tables = this.inputs
            .map(input => `public.fact f${input.factIndex}`)
            .join(", ");
        const sql = `SELECT ${hashes} FROM ${tables}`;
        return {
            sql,
            parameters: this.parameters,
            labels: this.inputs.map(input => input.label)
        };
    }
}

namespace TupleSql {
    export interface Input {
        label: string;
        factIndex: number;
        factTypeParameter: number;
        factHashParameter: number;
    }

    export interface Join {
        label?: string;
        edgeIndex: number;
        predecessorFactIndex: number;
        successorFactIndex: number;
        roleParameter: number;
        roleId: number;
    }

    export interface Query {
        inputs: Input[];
        joins: Join[];
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
        const outputs: OutputDescription[] = specification.matches
            .map((match, i) => ({
                label: match.unknown.name,
                factIndex: i+1 + inputs.length
            }));
        const specificationSql = new QueryDescription(inputs, parameters, outputs);
        return [specificationSql];
    }
}

export function sqlFromSpecification(start: FactReference[], specification: Specification, factTypes: Map<string, number>, roleMap: Map<number, Map<string, number>>): SpecificationSqlQuery[] {
    const descriptionBuilder = new DescriptionBuilder(factTypes, roleMap);
    const descriptions = descriptionBuilder.buildDescriptions(start, specification);
    return descriptions.map(description => description.generateSqlQuery());
}
