import { Label, Match, PathCondition, Specification } from "./specification";

export interface FactDescription {
    factType: string;
    factIndex: number;
}
export interface InputDescription {
    factIndex: number;
    inputIndex: number;
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

export interface Skeleton {
    facts: FactDescription[];
    inputs: InputDescription[];
    edges: EdgeDescription[];
    notExistsConditions: NotExistsConditionDescription[];
    outputs: OutputDescription[];
}

export const emptySkeleton: Skeleton = {
    facts: [],
    inputs: [],
    edges: [],
    notExistsConditions: [],
    outputs: []
};

function withFact(skeleton: Skeleton, factType: string): { skeleton: Skeleton, factIndex: number } {
    const factIndex = skeleton.facts.length + 1;
    const fact: FactDescription = {
        factIndex,
        factType
    };
    skeleton = {
        ...skeleton,
        facts: [...skeleton.facts, fact]
    };

    return { skeleton, factIndex };
}

function withInput(skeleton: Skeleton, factName: string, factType: string, inputIndex: number): Skeleton {
    const { skeleton: skeletonWithFact, factIndex } = withFact(skeleton, factType);
    const input: InputDescription = {
        factIndex,
        inputIndex
    };
    return {
        ...skeletonWithFact,
        inputs: [...skeletonWithFact.inputs, input]
    };
}

function withEdge(skeleton: Skeleton, predecessorFactIndex: number, successorFactIndex: number, roleName: string, path: number[]): Skeleton {
    const edgeIndex = skeleton.edges.length + countEdges(skeleton.notExistsConditions) + 1;
    const edge: EdgeDescription = {
        edgeIndex,
        predecessorFactIndex,
        successorFactIndex,
        roleName
    };
    if (path.length === 0) {
        return {
            ...skeleton,
            edges: [...skeleton.edges, edge]
        };
    }
    else {
        const notExistsConditions = notExistsWithEdge(skeleton.notExistsConditions, edge, path);
        return {
            ...skeleton,
            notExistsConditions
        };
    }
}

function withOutput(skeleton: Skeleton, factIndex: number): Skeleton {
    const output: OutputDescription = {
        factIndex
    };
    return {
        ...skeleton,
        outputs: [...skeleton.outputs, output]
    };
}

function withNotExistsCondition(skeleton: Skeleton, path: number[]): { skeleton: Skeleton; path: number[]; } {
    const { notExistsConditions: newNotExistsConditions, path: newPath } = notExistsWithCondition(skeleton.notExistsConditions, path);
    const newSkeleton = {
        ...skeleton,
        notExistsConditions: newNotExistsConditions
    };
    return { skeleton: newSkeleton, path: newPath };
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

type FactByIdentifier = {
    [identifier: string]: FactDescription;
};

type InputByIdentifier = {
    [identifier: string]: {
        type: string;
        inputIndex: number;
    };
};

export function skeletonOfSpecification(specification: Specification): Skeleton {
    const givenFacts: InputByIdentifier = specification.given.reduce((acc, given, i) => ({
        ...acc,
        [given.label.name]: {
            type: given.label.type,
            inputIndex: i
        }
    }), {} as InputByIdentifier);

    const { skeleton } = addEdges(emptySkeleton, givenFacts, {}, [], specification.matches);
    return skeleton;
}

function addEdges(skeleton: Skeleton, givenFacts: InputByIdentifier, knownFacts: FactByIdentifier, path: number[], matches: Match[]): { skeleton: Skeleton; knownFacts: FactByIdentifier; } {
    for (const match of matches) {
        for (const condition of match.conditions) {
            if (condition.type === "path") {
                ({skeleton, knownFacts} = addPathCondition(skeleton, givenFacts, knownFacts, path, match.unknown, condition));
            }
            else if (condition.type === "existential") {
                if (condition.exists) {
                    // Include the edges of the existential condition into the current skeleton.
                    const { skeleton: newSkeleton } = addEdges(skeleton, givenFacts, knownFacts, path, condition.matches);
                    skeleton = newSkeleton;
                }
                else {
                    // Apply the where clause and continue with the tuple where it is true.
                    const { skeleton: skeletonWithNotExist, path: conditionalPath } = withNotExistsCondition(skeleton, path);
                    const { skeleton: newSkeletonWithNotExists } = addEdges(skeletonWithNotExist, givenFacts, knownFacts, conditionalPath, condition.matches);
                    skeleton = newSkeletonWithNotExists;
                }
            }
        }
    }
    return { skeleton, knownFacts };
}

function addPathCondition(skeleton: Skeleton, givenFacts: InputByIdentifier, knownFacts: FactByIdentifier, path: number[], unknown: Label, condition: PathCondition): { skeleton: Skeleton; knownFacts: FactByIdentifier; } {
    const given = givenFacts[condition.labelRight];
    if (given) {
        // If the right-hand side is a given, and not yet a known fact,
        // then add it to the feed.
        if (!knownFacts[condition.labelRight]) {
            skeleton = withInput(skeleton, condition.labelRight, given.type, given.inputIndex);
            knownFacts = {
                ...knownFacts,
                [condition.labelRight]: {
                    factIndex: skeleton.facts.length,
                    factType: given.type
                }
            };
        }
    }

    // Determine whether we have already written the output.
    const knownFact = knownFacts[unknown.name];
    const roleCount = condition.rolesLeft.length + condition.rolesRight.length;

    // Walk up the right-hand side.
    // This generates predecessor joins from a given or prior label.
    const fact = knownFacts[condition.labelRight];
    if (!fact) {
        throw new Error(`Label ${condition.labelRight} not found. Known labels: ${Object.keys(knownFacts).join(", ")}`);
    }
    let factType = fact.factType;
    let factIndex = fact.factIndex;
    for (let i = 0; i < condition.rolesRight.length; i++) {
        const role = condition.rolesRight[i];
        if (i === roleCount - 1 && knownFact) {
            // If we have already written the output, we can use the fact index.
            skeleton = withEdge(skeleton, knownFact.factIndex, factIndex, role.name, path);
            factIndex = knownFact.factIndex;
        }
        else {
            // If we have not written the fact, we need to write it now.
            const { skeleton: skeletonWithFact, factIndex: predecessorFactIndex } = withFact(skeleton, role.predecessorType);
            skeleton = withEdge(skeletonWithFact, predecessorFactIndex, factIndex, role.name, path);
            factIndex = predecessorFactIndex;
        }
        factType = role.predecessorType;
    }

    const rightType = factType;

    // Walk up the left-hand side.
    // We will need to reverse this walk to generate successor joins.
    factType = unknown.type;
    const newEdges: {
        roleName: string;
        successorType: string;
    }[] = [];
    for (const role of condition.rolesLeft) {
        newEdges.push({
            roleName: role.name,
            successorType: factType
        });
        factType = role.predecessorType;
    }

    if (factType !== rightType) {
        throw new Error(`Type mismatch: ${factType} is compared to ${rightType}`);
    }

    newEdges.reverse().forEach(({ roleName, successorType }, i) => {
        if (condition.rolesRight.length + i === roleCount - 1 && knownFact) {
            skeleton = withEdge(skeleton, factIndex, knownFact.factIndex, roleName, path);
            factIndex = knownFact.factIndex;
        }
        else {
            const { skeleton: skeletonWithFact, factIndex: successorFactIndex } = withFact(skeleton, successorType);
            skeleton = withEdge(skeletonWithFact, factIndex, successorFactIndex, roleName, path);
            factIndex = successorFactIndex;
        }
    });

    // If we have not captured the known fact, add it now.
    if (!knownFact) {
        knownFacts = { ...knownFacts, [unknown.name]: { factIndex, factType: unknown.type } };
        // If we have not written the output, write it now.
        // Only write the output if we are not inside of an existential condition.
        if (path.length === 0) {
            skeleton = withOutput(skeleton, factIndex);
        }
    }

    return { skeleton, knownFacts };
}