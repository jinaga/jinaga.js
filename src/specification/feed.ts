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
    const edgeIndex = feed.edges.length + 1;
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
