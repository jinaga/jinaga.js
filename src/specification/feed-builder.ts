import { ComponentProjection, ExistentialCondition, Label, Match, PathCondition, Specification, emptySpecification } from "./specification";

interface FactDescription {
    factType: string;
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

function withGiven(specification: Specification, factName: string, factType: string): Specification {
    return {
        ...specification,
        given: [...specification.given, { name: factName, type: factType }]
    };
}

export function buildFeeds(specification: Specification): Specification[] {
    const givenFacts: InputByIdentifier = specification.given.reduce((acc, label, i) => ({
        ...acc,
        [label.name]: {
            type: label.type,
            inputIndex: i
        }
    }), {} as InputByIdentifier);

    // The feed builder will branch at various points, and
    // build on the current specification along each branch.
    const { specifications: feeds, knownFacts } = addEdges(emptySpecification, givenFacts, {}, specification.matches);

    // The final feed represents the complete tuple.
    // Build projections onto that one.
    const finalFeed = feeds[feeds.length - 1];
    if (specification.projection.type === "composite") {
        const feedsWithProjections = addProjections(finalFeed, givenFacts, knownFacts, specification.projection.components);
        return [ ...feeds, ...feedsWithProjections ];
    }
    else {
        return feeds;
    }
}

function addEdges(specification: Specification, givenFacts: InputByIdentifier, knownFacts: FactByIdentifier, matches: Match[]): { specifications: Specification[]; knownFacts: FactByIdentifier; } {
    const specifications: Specification[] = [];
    for (const match of matches) {
        specification = withMatch(specification, match);
        for (const condition of match.conditions) {
            if (condition.type === "path") {
                ({specification, knownFacts} = addPathCondition(specification, givenFacts, knownFacts, match.unknown, condition));
            }
            else if (condition.type === "existential") {
                if (condition.exists) {
                    // Include the edges of the existential condition into the current feed.
                    const { specifications: newSpecifications } = addEdges(specification, givenFacts, knownFacts, condition.matches);
                    const last = newSpecifications.length - 1;
                    specifications.push(...newSpecifications.slice(0, last));
                    specification = newSpecifications[last];
                }
                else {
                    // Branch from the current feed and follow the
                    // edges of the existential condition.
                    // This will produce tuples that prove the condition false.
                    const { specifications: newSpecifications } = addEdges(specification, givenFacts, knownFacts, condition.matches);
                    
                    // Then apply the existential condition and continue with the tuple where it is true.
                    const specificationWithCondition = specificationWithNotExistsCondition(specification, condition);
                    const { specifications: newSpecificationsWithNotExists } = addEdges(specificationWithCondition, givenFacts, knownFacts, condition.matches);
                    const last = newSpecificationsWithNotExists.length - 1;
                    const specificationConditional = newSpecificationsWithNotExists[last];

                    specifications.push(...newSpecifications);
                    specifications.push(...newSpecificationsWithNotExists.slice(0, last));
                    specification = specificationConditional;
                }
            }
        }
    }
    specifications.push(specification);
    return { specifications: specifications, knownFacts };
}

function addPathCondition(specification: Specification, givenFacts: InputByIdentifier, knownFacts: FactByIdentifier, unknown: Label, condition: PathCondition): { specification: Specification; knownFacts: FactByIdentifier; } {
    const given = givenFacts[condition.labelRight];
    if (given) {
        // If the right-hand side is a given, and not yet a known fact,
        // then add it to the feed.
        if (!knownFacts[condition.labelRight]) {
            specification = withGiven(specification, condition.labelRight, given.type);
            knownFacts = {
                ...knownFacts,
                [condition.labelRight]: {
                    factType: given.type
                }
            };
        }
    }
    return { specification, knownFacts };
}

function addProjections(specification: Specification, givenFacts: InputByIdentifier, knownFacts: FactByIdentifier, components: ComponentProjection[]): Specification[] {
    const specifications: Specification[] = [];
    components.forEach(component => {
        if (component.type === "specification") {
            // Produce more facts in the tuple.
            const { specifications: feedsWithEdges, knownFacts: knownFactsWithEdges } = addEdges(specification, givenFacts, knownFacts, component.matches);
            specifications.push(...feedsWithEdges);

            // Recursively build child projections.
            const finalFeed = feedsWithEdges[feedsWithEdges.length - 1];
            if (component.projection.type === "composite") {
                const feedsWithProjections = addProjections(finalFeed, givenFacts, knownFactsWithEdges, component.projection.components);
                specifications.push(...feedsWithProjections);
            }
        }
    });
    return specifications;
}

function withMatch(specification: Specification, match: Match): Specification {
    const pathConditions = match.conditions.filter(condition => condition.type === "path");
    return {
        ...specification,
        matches: [...specification.matches, {
            ...match,
            conditions: pathConditions
        }]
    };
}

function specificationWithNotExistsCondition(specification: Specification, condition: ExistentialCondition) {
    const lastMatch = specification.matches[specification.matches.length - 1];
    const lastMatchWithExistential = {
        ...lastMatch,
        conditions: [
            ...lastMatch.conditions,
            condition
        ]
    };
    const replacedLastMatch = [
        ...specification.matches.slice(0, specification.matches.length - 1),
        lastMatchWithExistential
    ];
    const specificationWithCondition: Specification = {
        ...specification,
        matches: replacedLastMatch
    };
    return specificationWithCondition;
}