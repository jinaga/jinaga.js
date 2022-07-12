import { FieldProjection, Label, Match, PathCondition, Specification } from "../specification/specification";
import { FactReference } from "../storage";
import { FactTypeMap, getFactTypeId, getRoleId, RoleMap } from "./maps";
import { FactDescription, InputDescription, QueryDescription, SpecificationSqlQuery } from "./query-description";

type FactByIdentifier = {
    [identifier: string]: FactDescription;
};

interface ResultDescription {
    queryDescription: QueryDescription;
    childResultDescriptions: NamedResultDescription[];
}

interface NamedResultDescription extends ResultDescription {
    name: string;
}

interface ChildResults {
    parentFactIds: number[];
    results: {}[];
}

export class ResultComposer {
    constructor(
        private readonly sqlQuery: SpecificationSqlQuery,
        private readonly fieldProjections: FieldProjection[],
        private readonly parentFactIdLength: number
    ) { }

    public getSqlQueries() {
        return [ this.sqlQuery ];
    }

    public compose(
        resultSets: any[][]
    ): {}[] {
        const childResults = this.composeInternal(resultSets);
        if (childResults.length === 0) {
            return [];
        }
        else {
            return childResults[0].results;
        }
    }

    private composeInternal(
        resultSets: any[][]
    ): ChildResults[] {
        const rows = resultSets[0];
        if (rows.length === 0) {
            return [];
        }
        const childResults: ChildResults[] = [];
        let parentFactIds: number[] = this.identifierOf(rows[0]).slice(0, this.parentFactIdLength);
        let results: {}[] = [ this.projectionOf(rows[0]) ];
        for (const row of rows.slice(1)) {
            const childFactIds = this.identifierOf(row);
            const nextParentFactIds = childFactIds.slice(0, this.parentFactIdLength);
            if (nextParentFactIds.every((value, index) => value === parentFactIds[index])) {
                results.push(this.projectionOf(row));
            }
            else {
                childResults.push({
                    parentFactIds,
                    results
                });
                parentFactIds = childFactIds;
                results = [ this.projectionOf(row) ];
            }
        }
        childResults.push({
            parentFactIds,
            results
        });
        return childResults;
    }

    private identifierOf(row: any): number[] {
        return this.sqlQuery.labels.map(label => row[`id${label.index}`]);
    }

    private projectionOf(row: any): {} {
        if (this.fieldProjections.length === 0) {
            return this.sqlQuery.labels.reduce((acc, label) => ({
                ...acc,
                [label.name]: row[`data${label.index}`].fields
            }), {})
        }
        else {
            return this.fieldProjections.reduce((acc, fieldProjection) => ({
                ...acc,
                [fieldProjection.name]: this.fieldValue(fieldProjection, row)
            }), {});
        }
    }

    private fieldValue(fieldProjection: FieldProjection, row: any): any {
        const label = this.sqlQuery.labels.find(label => label.name === fieldProjection.label);
        if (!label) {
            throw new Error(`Label ${fieldProjection.label} not found. Known labels: ${this.sqlQuery.labels.map(label => label.name).join(", ")}`);
        }
        return row[`data${label.index}`].fields[fieldProjection.field];
    }
}

class ResultDescriptionBuilder {
    constructor(
        private factTypes: FactTypeMap,
        private roleMap: RoleMap
    ) { }

    buildDescription(start: FactReference[], specification: Specification): ResultDescription {
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

        // Allocate a fact table for each given.
        // While the fact type and hash parameters are zero, the join will not be written.
        const inputs: InputDescription[] = specification.given
            .map((label, i) => ({
                label: label.name,
                factIndex: i+1,
                factTypeId: getFactTypeId(this.factTypes, label.type),
                factHash: start[i].hash,
                factTypeParameter: 0,
                factHashParameter: 0
            }));
        const facts: FactDescription[] = specification.given
            .map((label, i) => ({
                factIndex: i+1,
                type: label.type
            }));
        const givenFacts = specification.given.reduce((knownFacts, label, i) => ({
            ...knownFacts,
            [label.name]: facts[i]
        }), {} as FactByIdentifier);

        // The QueryDescription is an immutable data type.
        // Initialize it with the inputs and facts.
        // The DescriptionBuilder will branch at various points, and
        // build on the current query description along each branch.
        const initialQueryDescription = new QueryDescription(inputs, [], [], facts, [], []);
        const { resultDescription, knownFacts } = this.addEdges(initialQueryDescription, givenFacts, [], "", specification.matches);
        return resultDescription;
    }

    private addEdges(queryDescription: QueryDescription, knownFacts: FactByIdentifier, path: number[], prefix: string, matches: Match[]): { resultDescription: ResultDescription, knownFacts: FactByIdentifier } {
        for (const match of matches) {
            for (const condition of match.conditions) {
                if (condition.type === "path") {
                    ({queryDescription, knownFacts} = this.addPathCondition(queryDescription, knownFacts, path, match.unknown, prefix, condition));
                }
            }
        }
        return {
            resultDescription: {
                queryDescription,
                childResultDescriptions: []
            },
            knownFacts
        };
    }

    private addPathCondition(queryDescription: QueryDescription, knownFacts: FactByIdentifier, path: number[], unknown: Label, prefix: string, condition: PathCondition): { queryDescription: QueryDescription, knownFacts: FactByIdentifier } {
        // If no input parameter has been allocated, allocate one now.
        const input = queryDescription.inputByLabel(condition.labelRight);
        if (input && input.factTypeParameter === 0) {
            queryDescription = queryDescription.withInputParameter(input.label);
        }

        // Determine whether we have already written the output.
        const knownFact = knownFacts[unknown.name];
        const roleCount = condition.rolesLeft.length + condition.rolesRight.length;

        // Walk up the right-hand side.
        // This generates predecessor joins from a given or prior label.
        let fact = knownFacts[condition.labelRight];
        let type = fact.type;
        let factIndex = fact.factIndex;
        for (const [i, role] of condition.rolesRight.entries()) {
            // If the type or role is not known, then no facts matching the condition can
            // exist. The query is unsatisfiable.
            const typeId = getFactTypeId(this.factTypes, type);
            if (!typeId) {
                return { queryDescription: QueryDescription.unsatisfiable, knownFacts };
            }
            const roleId = getRoleId(this.roleMap, typeId, role.name);
            if (!roleId) {
                return { queryDescription: QueryDescription.unsatisfiable, knownFacts };
            }

            const { query: queryWithParameter, parameterIndex: roleParameter } = queryDescription.withParameter(roleId);
            if (i === roleCount - 1 && knownFact) {
                // If we have already written the output, we can use the fact index.
                queryDescription = queryWithParameter.withEdge(knownFact.factIndex, factIndex, roleParameter, path);
                factIndex = knownFact.factIndex;
            }
            else {
                // If we have not written the fact, we need to write it now.
                const { query, factIndex: predecessorFactIndex } = queryWithParameter.withFact(role.targetType);
                queryDescription = query.withEdge(predecessorFactIndex, factIndex, roleParameter, path);
                factIndex = predecessorFactIndex;
            }
            type = role.targetType;
        }

        // Walk up the left-hand side.
        // We will need to reverse this walk to generate successor joins.
        type = unknown.type;
        const newEdges: {
            roleId: number,
            declaringType: string,
        }[] = [];
        for (const role of condition.rolesLeft) {
            // If the type or role is not known, then no facts matching the condition can
            // exist. The query is unsatisfiable.
            const typeId = getFactTypeId(this.factTypes, type);
            if (!typeId) {
                return { queryDescription: QueryDescription.unsatisfiable, knownFacts };
            }
            const roleId = getRoleId(this.roleMap, typeId, role.name);
            if (!roleId) {
                return { queryDescription: QueryDescription.unsatisfiable, knownFacts };
            }

            newEdges.push({
                roleId,
                declaringType: type
            });
            type = role.targetType;
        }
        newEdges.reverse().forEach(({ roleId, declaringType }, i) => {
            const { query: queryWithParameter, parameterIndex: roleParameter } = queryDescription.withParameter(roleId);
            if (condition.rolesRight.length + i === roleCount - 1 && knownFact) {
                queryDescription = queryWithParameter.withEdge(factIndex, knownFact.factIndex, roleParameter, path);
                factIndex = knownFact.factIndex;
            }
            else {
                const { query: queryWithFact, factIndex: successorFactIndex } = queryWithParameter.withFact(declaringType);
                queryDescription = queryWithFact.withEdge(factIndex, successorFactIndex, roleParameter, path);
                factIndex = successorFactIndex;
            }
        });

        // If we have not captured the known fact, add it now.
        if (!knownFact) {
            knownFacts = { ...knownFacts, [unknown.name]: { factIndex, type: unknown.type } };
            // If we have not written the output, write it now.
            // Only write the output if we are not inside of an existential condition.
            // Use the prefix, which will be set for projections.
            if (path.length === 0) {
                queryDescription = queryDescription.withOutput(prefix + unknown.name, unknown.type, factIndex);
            }
        }
        return { queryDescription, knownFacts };
    }
}

export function resultSqlFromSpecification(start: FactReference[], specification: Specification, factTypes: FactTypeMap, roleMap: RoleMap): ResultComposer {
    const descriptionBuilder = new ResultDescriptionBuilder(factTypes, roleMap);
    const description = descriptionBuilder.buildDescription(start, specification);

    const sqlQuery = description.queryDescription.generateResultSqlQuery();
    const fieldProjections = specification.projections
        .filter(projection => projection.type === "field") as FieldProjection[];
    return new ResultComposer(sqlQuery, fieldProjections, 0);
}
