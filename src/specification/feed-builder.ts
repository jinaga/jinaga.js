import { ComponentProjection, ExistentialCondition, Label, Match, Specification, SpecificationGiven, emptySpecification, isExistentialCondition, isPathCondition, specificationIsNotDeterministic } from "./specification";

/**
 * What a feed continues with once the match list it is following runs out.
 *
 * A negative existential condition branches a feed off the current one. At odd
 * nesting depth that branch is an *excluding* feed: it is evidence that results
 * should be removed, and it stops where it is. At even depth it is a *positive*
 * feed — the *restoring* feed of "The Art of Immutable Architecture" chapter 12
 * — and it must go on to match the rest of the specification, because its
 * tuples contribute results.
 *
 * The branch is produced by a recursive call that only knows the matches of the
 * condition it is following, so the remainder of every enclosing level travels
 * with it in this list.
 */
interface Continuation {
    matches: Match[];
    projectionComponents: ComponentProjection[];
    parent: Continuation | null;
}

export function buildFeeds(specification: Specification): Specification[] {
    const projectionComponents = specification.projection.type === "composite"
        ? specification.projection.components
        : [];
    const { specifications } = addMatches(emptySpecification, specification.given.map(g => g.label), specification.matches, projectionComponents, 0, null);
    return specifications.filter(specificationIsNotDeterministic);
}

function addMatches(specification: Specification, unusedGivens: Label[], matches: Match[], projectionComponents: ComponentProjection[], parity: number, continuation: Continuation | null): { specifications: Specification[]; unusedGivens: Label[]; } {
    const specifications: Specification[] = [];
    for (let index = 0; index < matches.length; index++) {
        const match = matches[index];
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
                // The flattened matches continue inline, so they carry neither a
                // continuation nor the projection components: the feed they extend is
                // not finished, and its projections are built at the real terminal.
                const { specifications: newSpecifications, unusedGivens: newUnusedGivens } = addMatches(specification, unusedGivens, existentialCondition.matches, [], parity, null);
                const last = newSpecifications.length - 1;
                specifications.push(...newSpecifications.slice(0, last));
                specification = newSpecifications[last];
                unusedGivens = newUnusedGivens;
            }
            else {
                // Branch from the current feed and follow the matches of the existential condition.
                // This will produce tuples that prove the condition false.
                //
                // Hand the branch everything still unmatched at this level and at
                // every enclosing level. If the branch lands on even parity it is a
                // restoring feed, and it will match that remainder so that its
                // tuples carry the facts the results are built from. An excluding
                // feed (odd parity) discards the continuation and stops.
                const innerParity = parity + 1;
                const innerContinuation: Continuation = {
                    matches: matches.slice(index + 1),
                    projectionComponents,
                    parent: continuation
                };
                const { specifications: negatingSpecifications } = addMatches(specification, unusedGivens, existentialCondition.matches, projectionComponents, innerParity, innerContinuation);
                specifications.push(...negatingSpecifications);

                // Then apply the existential condition and continue with the tuple.
                const { existentialCondition: newExistentialCondition, givens: newGivens, unusedGivens: newUnusedGivens } = buildExistentialCondition({
                    type: "existential",
                    exists: false,
                    matches: []
                }, existentialCondition.matches, specification.given, unusedGivens);
                // Attach the condition to the match it actually belongs to. A
                // preceding positive existential may have flattened its own
                // matches onto the end of the feed, so the current match is no
                // longer guaranteed to be the last one.
                specification = withCondition(specification, newGivens, newExistentialCondition, match.unknown.name);
                unusedGivens = newUnusedGivens;
            }
        }
    }

    if (parity % 2 !== 0) {
        // An excluding feed. It is evidence that results should be removed, so it
        // neither matches the rest of the specification nor carries projections.
        specifications.push(specification);
        return { specifications, unusedGivens };
    }

    if (continuation !== null) {
        // A positive feed with more of the specification still to match. Parity
        // stays where it is: a negative condition among the remaining matches is
        // the *first* level of negation relative to this feed.
        const { specifications: continued, unusedGivens: continuedUnusedGivens } = addMatches(specification, unusedGivens, continuation.matches, continuation.projectionComponents, parity, continuation.parent);
        specifications.push(...continued);
        return { specifications, unusedGivens: continuedUnusedGivens };
    }

    // A positive feed with nothing left to match. Emit it, then extend it with
    // the feeds of each projection component.
    specifications.push(specification);
    specifications.push(...addProjections(specification, unusedGivens, projectionComponents));
    return { specifications, unusedGivens };
}

function buildExistentialCondition(existentialCondition: ExistentialCondition, matches: Match[], givens: SpecificationGiven[], unusedGivens: Label[]): { existentialCondition: ExistentialCondition, givens: SpecificationGiven[], unusedGivens: Label[] } {
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
                givens = [...givens, { label: reference, conditions: [] }];
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
            // Each component branches from the same feed. Its own projection
            // components ride along, so `addMatches` extends the component's
            // positive feeds with them in turn.
            const childComponents = component.projection.type === "composite" ? component.projection.components : [];
            const { specifications: componentFeeds } = addMatches(specification, unusedGivens, component.matches, childComponents, 0, null);
            specifications.push(...componentFeeds);
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
        given: [...specification.given, { label, conditions: [] }]
    };
}

function withCondition(specification: Specification, newGivens: SpecificationGiven[], newExistentialCondition: ExistentialCondition, targetLabel: string) {
    // Find the match that owns this condition by its label name. Scan
    // backwards so the most recently added match with that name (the one
    // currently being built) wins.
    let targetIndex = -1;
    for (let index = specification.matches.length - 1; index >= 0; index--) {
        if (specification.matches[index].unknown.name === targetLabel) {
            targetIndex = index;
            break;
        }
    }
    if (targetIndex < 0) {
        throw new Error(`Label ${targetLabel} not found when attaching existential condition`);
    }
    return {
        ...specification,
        given: newGivens,
        matches: specification.matches.map((match, index) => index === targetIndex ? {
            ...match,
            conditions: [...match.conditions, newExistentialCondition]
        } : match)
    };
}