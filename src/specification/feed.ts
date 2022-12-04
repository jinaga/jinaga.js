import { distinct } from "../util/fn";

export interface FactDescription {
    factType: string;
    factIndex: number;
}
export interface InputDescription {
    factIndex: number;
    factHash: string;
}
export interface EdgeDescription {
    edgeIndex: number;
    predecessorFactIndex: number;
    successorFactIndex: number;
    roleName: string;
}
export interface NotExistsConditionDescription {
    edges: EdgeDescription[];
    notExistsConditions: NotExistsConditionDescription[];
}
export interface OutputDescription {
    factIndex: number;
}

export interface Feed {
    facts: FactDescription[];
    inputs: InputDescription[];
    edges: EdgeDescription[];
    notExistsConditions: NotExistsConditionDescription[];
    outputs: OutputDescription[];
}

export const emptyFeed: Feed = {
    facts: [],
    inputs: [],
    edges: [],
    notExistsConditions: [],
    outputs: []
};

export function withFact(feed: Feed, factType: string): { feed: Feed, factIndex: number } {
    const factIndex = feed.facts.length + 1;
    const fact: FactDescription = {
        factIndex,
        factType
    };
    feed = {
        ...feed,
        facts: [...feed.facts, fact]
    };

    return { feed, factIndex };
}

export function withInput(feed: Feed, factType: string, factHash: string): Feed {
    const { feed: feedWithFact, factIndex } = withFact(feed, factType);
    const input: InputDescription = {
        factIndex,
        factHash
    };
    return {
        ...feedWithFact,
        inputs: [...feedWithFact.inputs, input]
    };
}

export function withEdge(feed: Feed, predecessorFactIndex: number, successorFactIndex: number, roleName: string, path: number[]): Feed {
    const edgeIndex = feed.edges.length + countEdges(feed.notExistsConditions) + 1;
    const edge: EdgeDescription = {
        edgeIndex,
        predecessorFactIndex,
        successorFactIndex,
        roleName
    };
    if (path.length === 0) {
        return {
            ...feed,
            edges: [...feed.edges, edge]
        };
    }
    else {
        const notExistsConditions = notExistsWithEdge(feed.notExistsConditions, edge, path);
        return {
            ...feed,
            notExistsConditions
        };
    }
}

export function withOutput(feed: Feed, factIndex: number): Feed {
    const output: OutputDescription = {
        factIndex
    };
    return {
        ...feed,
        outputs: [...feed.outputs, output]
    };
}

export function withNotExistsCondition(feed: Feed, path: number[]): { feed: Feed; path: number[]; } {
    const { notExistsConditions: newNotExistsConditions, path: newPath } = notExistsWithCondition(feed.notExistsConditions, path);
    const newFeed = {
        ...feed,
        notExistsConditions: newNotExistsConditions
    };
    return { feed: newFeed, path: newPath };
}

function notExistsWithEdge(notExistsConditions: NotExistsConditionDescription[], edge: EdgeDescription, path: number[]): NotExistsConditionDescription[] {
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

export function getAllFactTypesFromFeed(feed: Feed): string[] {
    return feed.facts.map(f => f.factType).filter(distinct);
}

interface RoleDescription {
    successorType: string;
    name: string;
    predecessorType: string;
}

function getFactTypeFromIndex(feed: Feed, factIndex: number): string {
    const fact = feed.facts.find(f => f.factIndex === factIndex);
    if (!fact) {
        throw new Error(`Fact with index ${factIndex} not found`);
    }
    return fact.factType;
}

function getAllRolesFromEdges(feed: Feed, edges: EdgeDescription[]): RoleDescription[] {
    return edges.map(e => ({
        successorType: getFactTypeFromIndex(feed, e.successorFactIndex),
        name: e.roleName,
        predecessorType: getFactTypeFromIndex(feed, e.predecessorFactIndex)
    }));
}

function getAllRolesFromConditions(feed: Feed, conditions: NotExistsConditionDescription[]): RoleDescription[] {
    return conditions.reduce((roles, c) => [
        ...roles,
        ...getAllRolesFromEdges(feed, c.edges),
        ...getAllRolesFromConditions(feed, c.notExistsConditions)],
        [] as RoleDescription[]);
}

export function getAllRolesFromFeed(feed: Feed): RoleDescription[] {
    const edgeRoles = getAllRolesFromEdges(feed, feed.edges);
    const conditionRoles = getAllRolesFromConditions(feed, feed.notExistsConditions);
    return [...edgeRoles, ...conditionRoles];
}