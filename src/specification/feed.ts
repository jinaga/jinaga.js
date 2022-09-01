export interface FactDescription {
    factType: string;
    factIndex: number;
}
export interface InputDescription {
    factIndex: number;
    factHash: string;
}

export interface Feed {
    facts: FactDescription[];
    inputs: InputDescription[];
}

export const emptyFeed: Feed = {
    facts: [],
    inputs: []
};

export function withInput(feed: Feed, factType: string, factHash: string): Feed {
    const factIndex = feed.facts.length + 1;
    const fact: FactDescription = {
        factIndex,
        factType
    };
    const input: InputDescription = {
        factIndex,
        factHash
    };
    return {
        facts: [...feed.facts, fact],
        inputs: [...feed.inputs, input]
    };
}