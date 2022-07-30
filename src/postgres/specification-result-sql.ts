import { Match, Specification, SpecificationProjection, ChildProjections, ResultProjection, SingularProjection, ElementProjection } from "../specification/specification";
import { FactReference } from "../storage";
import { FactTypeMap, getFactTypeId, RoleMap } from "./maps";
import { FactDescription, InputDescription, QueryDescription, SpecificationSqlQuery } from "./query-description";
import { QueryDescriptionBuilder } from "./query-description-builder";

export type FactByIdentifier = {
    [identifier: string]: FactDescription;
};

interface ResultDescription {
    queryDescription: QueryDescription;
    resultProjection: ResultProjection;
    childResultDescriptions: NamedResultDescription[];
}

interface NamedResultDescription extends ResultDescription {
    name: string;
}

interface IdentifiedResults {
    factIds: number[];
    result: any;
}

interface ChildResults {
    parentFactIds: number[];
    results: any[];
}

export interface SqlQueryTree {
    sqlQuery: SpecificationSqlQuery;
    childQueries: NamedSqlQueryTree[];
}

interface NamedSqlQueryTree extends SqlQueryTree {
    name: string;
}

export interface ResultSetTree {
    resultSet: any[];
    childResultSets: NamedResultSetTree[];
}

interface NamedResultSetTree extends ResultSetTree {
    name: string;
}

export class ResultComposer {
    constructor(
        private readonly sqlQuery: SpecificationSqlQuery,
        private readonly resultProjection: ResultProjection,
        private readonly parentFactIdLength: number,
        private readonly childResultComposers: NamedResultComposer[]
    ) { }

    public getSqlQueries(): SqlQueryTree {
        const childQueries: NamedSqlQueryTree[] = [];
        for (const childResultComposer of this.childResultComposers) {
            childQueries.push(({
                name: childResultComposer.name,
                ...childResultComposer.resultComposer.getSqlQueries()
            }));
        }
        return {
            sqlQuery: this.sqlQuery,
            childQueries
        };
    }

    public compose(
        resultSets: ResultSetTree
    ): any[] {
        const childResults = this.composeInternal(resultSets);
        if (childResults.length === 0) {
            return [];
        }
        else {
            return childResults[0].results;
        }
    }

    private composeInternal(
        resultSets: ResultSetTree
    ): ChildResults[] {
        const rows = resultSets.resultSet;
        if (rows.length === 0) {
            return [];
        }

        // Project all rows and their identifiers
        const identifiedResults: IdentifiedResults[] = rows.map(row => ({
            factIds: this.identifierOf(row),
            result: this.projectionOf(row)
        }));

        // Compose child results
        for (const childResultComposer of this.childResultComposers) {
            const childResultSet = resultSets.childResultSets.find(childResultSet =>
                childResultSet.name === childResultComposer.name);
            if (!childResultSet) {
                const availableNames = resultSets.childResultSets.map(childResultSet => childResultSet.name);
                throw new Error(`Child result set ${childResultComposer.name} not found in (${availableNames.join(", ")})`);
            }
            const composedResults = childResultComposer.resultComposer.composeInternal(childResultSet);

            // Add the child results
            let index = 0;
            for (const identifiedResult of identifiedResults) {
                let results: any[] = [];
                if (index < composedResults.length && idsEqual(identifiedResult.factIds, composedResults[index].parentFactIds)) {
                    results = composedResults[index].results;
                    index++;
                }
                identifiedResult.result = {
                    ...identifiedResult.result,
                    [childResultComposer.name]: results
                };
            }
        }

        // Group the results by their parent identifiers
        const childResults: ChildResults[] = [];
        let parentFactIds: number[] = identifiedResults[0].factIds.slice(0, this.parentFactIdLength);
        let results: any[] = [ identifiedResults[0].result ];
        for (const identifiedResult of identifiedResults.slice(1)) {
            const nextParentFactIds = identifiedResult.factIds.slice(0, this.parentFactIdLength);
            if (idsEqual(nextParentFactIds, parentFactIds)) {
                results.push(identifiedResult.result);
            }
            else {
                childResults.push({
                    parentFactIds,
                    results
                });
                parentFactIds = nextParentFactIds;
                results = [ identifiedResult.result ];
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

    private projectionOf(row: any): any {
        if (!Array.isArray(this.resultProjection)) {
            return this.singularValue(this.resultProjection, row);
        }
        else if (this.resultProjection.length === 0 && this.childResultComposers.length === 0) {
            return this.sqlQuery.labels
                .slice(this.parentFactIdLength)
                .reduce((acc, label) => ({
                    ...acc,
                    [label.name]: row[`data${label.index}`].fields
                }), {})
        }
        else {
            return this.resultProjection.reduce((acc, elementProjection) => ({
                ...acc,
                [elementProjection.name]: this.elementValue(elementProjection, row)
            }), {});
        }
    }

    private elementValue(projection: ElementProjection, row: any): any {
        const label = this.getLabel(projection.label);
        if (projection.type === "field") {
            return row[`data${label.index}`].fields[projection.field];
        }
        else if (projection.type === "hash") {
            return row[`hash${label.index}`];
        }
    }

    private singularValue(projection: SingularProjection, row: any): any {
        const label = this.getLabel(projection.label);
        return row[`data${label.index}`].fields[projection.field];
    }

    private getLabel(name: string) {
        const label = this.sqlQuery.labels.find(label => label.name === name);
        if (!label) {
            throw new Error(`Label ${name} not found. Known labels: ${this.sqlQuery.labels.map(label => label.name).join(", ")}`);
        }
        return label;
    }
}

interface NamedResultComposer {
    name: string;
    resultComposer: ResultComposer;
}

class ResultDescriptionBuilder extends QueryDescriptionBuilder {
    constructor(
        factTypes: FactTypeMap,
        roleMap: RoleMap
    ) {
        super(factTypes, roleMap);
    }

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
        return this.createResultDescription(initialQueryDescription, specification.matches, specification.childProjections, givenFacts, []);
    }

    private createResultDescription(queryDescription: QueryDescription, matches: Match[], childProjections: ChildProjections, knownFacts: FactByIdentifier, path: number[]): ResultDescription {
        ({ queryDescription, knownFacts } = this.addEdges(queryDescription, knownFacts, path, matches));
        if (!queryDescription.isSatisfiable()) {
            // Abort the branch if the query is not satisfiable
            return {
                queryDescription,
                resultProjection: [],
                childResultDescriptions: []
            }
        }
        const childResultDescriptions: NamedResultDescription[] = [];
        if (Array.isArray(childProjections)) {
            const specificationProjections = childProjections
                .filter(projection => projection.type === "specification") as SpecificationProjection[];
            const elementProjections = childProjections
                .filter(projection => projection.type === "field" || projection.type === "hash") as ElementProjection[];
            for (const child of specificationProjections) {
                const childResultDescription = this.createResultDescription(queryDescription, child.matches, child.childProjections, knownFacts, []);
                childResultDescriptions.push({
                    name: child.name,
                    ...childResultDescription
                });
            }
            return {
                queryDescription,
                resultProjection: elementProjections,
                childResultDescriptions
            };
        }
        else {
            return {
                queryDescription,
                resultProjection: childProjections,
                childResultDescriptions: []
            }
        }
    }

    private addEdges(queryDescription: QueryDescription, knownFacts: FactByIdentifier, path: number[], matches: Match[]): { queryDescription: QueryDescription, knownFacts: FactByIdentifier } {
        for (const match of matches) {
            for (const condition of match.conditions) {
                if (condition.type === "path") {
                    ({queryDescription, knownFacts} = this.addPathCondition(queryDescription, knownFacts, path, match.unknown, "", condition));
                }
                else if (condition.type === "existential") {
                    if (condition.exists) {
                        // Include the edges of the existential condition into the current
                        // query description.
                        ({ queryDescription } = this.addEdges(queryDescription, knownFacts, path, condition.matches));
                    }
                    else {
                        // Apply the where clause and continue with the tuple where it is true.
                        // The path describes which not-exists condition we are currently building on.
                        // Because the path is not empty, labeled facts will be included in the output.
                        const { query: queryDescriptionWithNotExist, path: conditionalPath } = queryDescription.withNotExistsCondition(path);
                        const { queryDescription: queryDescriptionConditional } = this.addEdges(queryDescriptionWithNotExist, knownFacts, conditionalPath, condition.matches);

                        // If the negative existential condition is not satisfiable, then
                        // that means that the condition will always be true.
                        // We can therefore skip the branch for the negative existential condition.
                        if (queryDescriptionConditional.isSatisfiable()) {
                            queryDescription = queryDescriptionConditional;
                        }
                    }
                }
                if (!queryDescription.isSatisfiable()) {
                    break;
                }
            }
            if (!queryDescription.isSatisfiable()) {
                break;
            }
        }
        return {
            queryDescription,
            knownFacts
        };
    }
}

function idsEqual(a: number[], b: number[]) {
    return a.every((value, index) => value === b[index]);
}

export function resultSqlFromSpecification(start: FactReference[], specification: Specification, factTypes: FactTypeMap, roleMap: RoleMap): ResultComposer {
    const descriptionBuilder = new ResultDescriptionBuilder(factTypes, roleMap);
    const description = descriptionBuilder.buildDescription(start, specification);

    if (!description.queryDescription.isSatisfiable()) {
        return null;
    }
    return createResultComposer(description, 0);
}

function createResultComposer(description: ResultDescription, parentFactIdLength: number): ResultComposer {
    const sqlQuery = description.queryDescription.generateResultSqlQuery();
    const resultProjection = description.resultProjection;
    const childResultComposers = description.childResultDescriptions
        .filter(child => child.queryDescription.isSatisfiable())
        .map(child => ({
            name: child.name,
            resultComposer: createResultComposer(child, description.queryDescription.outputLength())
        }));
    return new ResultComposer(sqlQuery, resultProjection, parentFactIdLength, childResultComposers);
}
