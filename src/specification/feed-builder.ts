import { ComponentProjection, ExistentialCondition, Label, Match, Specification, emptySpecification, isExistentialCondition, isPathCondition, specificationIsNotDeterministic } from "./specification";

export function buildFeeds(specification: Specification): Specification[] {
    const { specifications, unusedGivens } = addMatches(emptySpecification, specification.given, specification.matches);

    // The final feed represents the complete tuple.
    // Build projections onto that one.
    const finalFeed = specifications[specifications.length - 1];
    if (specification.projection.type === "composite") {
        const feedsWithProjections = addProjections(finalFeed, unusedGivens, specification.projection.components);
        return [ ...specifications, ...feedsWithProjections ].filter(specificationIsNotDeterministic);
    }
    else {
        return specifications.filter(specificationIsNotDeterministic);
    }
}

function addMatches(specification: Specification, unusedGivens: Label[], matches: Match[]): { specifications: Specification[]; unusedGivens: Label[]; } {
    const specifications: Specification[] = [];
    for (const match of matches) {
        specification = withMatch(specification, match);
        for (const pathCondition of match.conditions.filter(isPathCondition)) {
            // If the right-hand side is a given, then add it to the feed parameters.
            const reference = unusedGivens.find(given => given.name === pathCondition.labelRight);
            if (reference) {
                specification = withGiven(specification, reference);
                unusedGivens = unusedGivens.filter(given => given.name !== reference.name);
            }
        }
        for (const existentialCondition of match.conditions.filter(isExistentialCondition)) {
            if (existentialCondition.exists) {
                // Include the matches of the existential condition into the current feed.
                const { specifications: newSpecifications, unusedGivens: newUnusedGivens } = addMatches(specification, unusedGivens, existentialCondition.matches);
                const last = newSpecifications.length - 1;
                specifications.push(...newSpecifications.slice(0, last));
                specification = newSpecifications[last];
                unusedGivens = newUnusedGivens;
            }
            else {
                // Branch from the current feed and follow the matches of the existential condition.
                // This will produce tuples that prove the condition false.
                const { specifications: negatingSpecifications } = addMatches(specification, unusedGivens, existentialCondition.matches);
                specifications.push(...negatingSpecifications);

                // Then apply the existential condition and continue with the tuple.
                const { existentialCondition: newExistentialCondition, givens: newGivens, unusedGivens: newUnusedGivens } = buildExistentialCondition({
                    type: "existential",
                    exists: false,
                    matches: []
                }, existentialCondition.matches, specification.given, unusedGivens);
                specification = withCondition(specification, newGivens, newExistentialCondition);
                unusedGivens = newUnusedGivens;
            }
        }
    }
    specifications.push(specification);
    return { specifications, unusedGivens };
}

function buildExistentialCondition(existentialCondition: ExistentialCondition, matches: Match[], givens: Label[], unusedGivens: Label[]): { existentialCondition: ExistentialCondition, givens: Label[], unusedGivens: Label[] } {
    for (const match of matches) {
        existentialCondition = {
            ...existentialCondition,
            matches: [...existentialCondition.matches, {
                ...match,
                conditions: match.conditions.filter(isPathCondition)
            }]
        };
        for (const pathCondition of match.conditions.filter(isPathCondition)) {
            // If the right-hand side is a given, then add it to the feed parameters.
            const reference = unusedGivens.find(given => given.name === pathCondition.labelRight);
            if (reference) {
                givens = [...givens, reference];
                unusedGivens = unusedGivens.filter(given => given.name !== reference.name);
            }
        }
        for (const innerExistentialCondition of match.conditions.filter(isExistentialCondition)) {
            if (innerExistentialCondition.exists) {
                // Include the matches of the existential condition into the current condition.
                const { existentialCondition: newExistentialCondition, givens: newGivens, unusedGivens: newUnusedGivens } = buildExistentialCondition(innerExistentialCondition, innerExistentialCondition.matches, givens, unusedGivens);
                existentialCondition = newExistentialCondition;
                givens = newGivens;
                unusedGivens = newUnusedGivens;
            }
        }
    }
    return { existentialCondition, givens, unusedGivens };
}

function addProjections(specification: Specification, unusedGivens: Label[], components: ComponentProjection[]): Specification[] {
    const specifications: Specification[] = [];
    components.forEach(component => {
        if (component.type === "specification") {
            // Produce more facts in the tuple.
            const { specifications: feedsWithMatches, unusedGivens: newUnusedGivens } = addMatches(specification, unusedGivens, component.matches);
            specifications.push(...feedsWithMatches);

            // Recursively build child projections.
            const finalFeed = feedsWithMatches[feedsWithMatches.length - 1];
            if (component.projection.type === "composite") {
                const feedsWithProjections = addProjections(finalFeed, unusedGivens, component.projection.components);
                specifications.push(...feedsWithProjections);
            }
        }
    });
    return specifications;
}

function withMatch(specification: Specification, match: Match): Specification {
    const pathConditions = match.conditions.filter(isPathCondition);
    return {
        ...specification,
        matches: [...specification.matches, {
            ...match,
            conditions: pathConditions
        }]
    };
}

function withGiven(specification: Specification, label: Label): Specification {
    return {
        ...specification,
        given: [...specification.given, label]
    };
}

function withCondition(specification: Specification, newGivens: Label[], newExistentialCondition: ExistentialCondition) {
    return {
        ...specification,
        given: newGivens,
        matches: [...specification.matches.slice(0, specification.matches.length - 1), {
            ...specification.matches[specification.matches.length - 1],
            conditions: [...specification.matches[specification.matches.length - 1].conditions, newExistentialCondition]
        }]
    };
}