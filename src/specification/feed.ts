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

export interface Feed {
    facts: FactDescription[];
    inputs: InputDescription[];
    edges: EdgeDescription[];
}

export const emptyFeed: Feed = {
    facts: [],
    inputs: [],
    edges: []
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
    const edgeIndex = feed.edges.length + 1;
    const edge: EdgeDescription = {
        edgeIndex,
        predecessorFactIndex,
        successorFactIndex,
        roleName
    };
    return {
        ...feed,
        edges: [...feed.edges, edge]
    };
}
