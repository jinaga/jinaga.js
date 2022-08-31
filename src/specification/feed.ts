export interface InputDescription {
    label: string;
    factIndex: number;
    factType: string;
    factHash: string;
    factTypeParameter: number;
    factHashParameter: number;
}
export interface FactDescription {
    type: string;
    factIndex: number;
}

export interface Feed {
    inputs: InputDescription[];
    facts: FactDescription[];
}

export function newFeed(inputs: InputDescription[], facts: FactDescription[]): Feed {
    return {
        inputs,
        facts
    };
}
