import { ComponentProjection, ExistentialCondition, Label, Match, Specification, SpecificationGiven, emptySpecification, isExistentialCondition, isPathCondition } from "./specification";

/**
 * What a feed continues with once the part of the specification it is
 * following runs out.
 *
 * A negative existential condition branches a feed off the current one. At odd
 * nesting depth that branch is an *excluding* feed: it is evidence that results
 * should be removed, and it stops where it is. At even depth it is a *positive*
 * feed — the *restoring* feed of "The Art of Immutable Architecture" chapter 12
 * — and it must go on to match the rest of the specification, because its
 * tuples contribute results.
 *
 * The branch is produced by a recursive call that only knows the matches of the
 * condition it is following, so the whole remainder travels with it here. That
 * remainder has two parts: the existential conditions still waiting on the
 * match the branch left from, and the matches after that one, at this level and
 * at every enclosing level. Both are carried by one continuation. Carrying only
 * the second left the facts the first reads in no feed at all, because the main
 * path reaches those conditions with the current one already attached as a
 * one-level `!E` that excludes exactly the tuples the branch restored.
 */
interface Continuation {
    pending: PendingConditions | null;
    matches: Match[];
    projectionComponents: ComponentProjection[];
    parent: Continuation | null;
}

/**
 * Existential conditions still waiting on a match the feed already carries.
 * The label names that match, which is how `withCondition` finds it.
 */
interface PendingConditions {
    label: string;
    conditions: ExistentialCondition[];
}

export function buildFeeds(specification: Specification): Specification[] {
    const projectionComponents = specification.projection.type === "composite"
        ? specification.projection.components
        : [];
    const { specifications } = addMatches(emptySpecification, specification.given.map(g => g.label), specification.matches, projectionComponents, 0, null, false);
    return specifications.filter(traversesSuccessors);
}

/**
 * Whether a feed walks at least one successor edge.
 *
 * A feed whose every join walks predecessors delivers nothing: a fact travels
 * with its predecessors, so the subscriber already holds every result. Those
 * feeds are dropped.
 *
 * Only the path conditions of this feed's matches decide. An existential
 * condition says nothing about what this feed delivers, because its own matches
 * travel in a feed of their own.
 */
function traversesSuccessors(specification: Specification): boolean {
    return specification.matches.some(match =>
        match.conditions.some(condition =>
            condition.type === "path" &&
            condition.rolesLeft.length > 0
        )
    );
}

/**
 * Extend a feed with a run of matches, applying each match's own existential
 * conditions as it goes.
 *
 * `inline` says who finishes the feed. When it is false this run is the feed's
 * own: the terminal disposition below applies, and the returned `specification`
 * has already been emitted, continued, or extended with projections. When it is
 * true the matches are being flattened into a feed the *caller* is still
 * building, so the terminal disposition is skipped and the caller goes on with
 * the returned `specification`. Either way `continuation` names the remainder,
 * and branches taken inside this run are handed it.
 */
function addMatches(specification: Specification, unusedGivens: Label[], matches: Match[], projectionComponents: ComponentProjection[], parity: number, continuation: Continuation | null, inline: boolean): { specifications: Specification[]; specification: Specification; unusedGivens: Label[]; } {
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
        // What follows this match's own conditions: the matches after it, and
        // then whatever every enclosing level still has.
        const rest: Continuation = {
            pending: null,
            matches: matches.slice(index + 1),
            projectionComponents,
            parent: continuation
        };
        const { specifications: conditionSpecifications, specification: conditioned, unusedGivens: conditionUnusedGivens } =
            addConditions(specification, unusedGivens, match.unknown.name, match.conditions.filter(isExistentialCondition), projectionComponents, parity, rest);
        specifications.push(...conditionSpecifications);
        specification = conditioned;
        unusedGivens = conditionUnusedGivens;
    }

    if (inline) {
        // These matches were flattened into a feed the caller is still
        // building. It is not finished, so it is neither emitted nor continued
        // here, and its projections are built at the real terminal. The
        // continuation reached the branches above; it must not reach this feed
        // twice.
        return { specifications, specification, unusedGivens };
    }

    if (parity % 2 !== 0) {
        // An excluding feed. It is evidence that results should be removed, so it
        // neither matches the rest of the specification nor carries projections.
        specifications.push(specification);
        return { specifications, specification, unusedGivens };
    }

    if (continuation !== null) {
        // A positive feed with more of the specification still to match.
        const { specifications: continued, unusedGivens: continuedUnusedGivens } = continueWith(specification, unusedGivens, parity, continuation);
        specifications.push(...continued);
        return { specifications, specification, unusedGivens: continuedUnusedGivens };
    }

    // A positive feed with nothing left to match. Emit it, then extend it with
    // the feeds of each projection component.
    specifications.push(specification);
    specifications.push(...addProjections(specification, unusedGivens, projectionComponents));
    return { specifications, specification, unusedGivens };
}

/**
 * Apply the existential conditions of one match, in order, to the feed that
 * already carries it. Returns the feeds branched off along the way, and the
 * feed the main path continues with.
 *
 * `rest` is what follows these conditions. A branch is handed it with the
 * conditions after the current one prepended, so the whole remainder reaches
 * the branch as one thing.
 */
function addConditions(specification: Specification, unusedGivens: Label[], label: string, conditions: ExistentialCondition[], projectionComponents: ComponentProjection[], parity: number, rest: Continuation): { specifications: Specification[]; specification: Specification; unusedGivens: Label[]; } {
    const specifications: Specification[] = [];
    for (let index = 0; index < conditions.length; index++) {
        const existentialCondition = conditions[index];
        if (existentialCondition.exists) {
            // Include the matches of the existential condition into the current
            // feed. The flattened matches continue inline: the feed they extend
            // is not finished, so `addMatches` hands it back rather than
            // emitting it, and the enclosing loop goes on to apply the
            // conditions after this one.
            //
            // A negative condition on one of those flattened matches still
            // branches, and that branch leaves this feed for good. So it is
            // handed the whole remainder, exactly as a branch on the main path
            // is: the conditions after it within the existential and the
            // existential's later matches, which the flattened run's own `rest`
            // chain carries, and then everything this level still has. Carrying
            // only the first left a restoring branch nested inside a positive
            // existential stopping at the end of that existential, so the facts
            // the outer match's later conditions read were in no feed at all.
            const flattenedContinuation: Continuation = {
                pending: { label, conditions: conditions.slice(index + 1) },
                matches: rest.matches,
                projectionComponents: rest.projectionComponents,
                parent: rest.parent
            };
            const { specifications: newSpecifications, specification: flattened, unusedGivens: newUnusedGivens } = addMatches(specification, unusedGivens, existentialCondition.matches, projectionComponents, parity, flattenedContinuation, true);
            specifications.push(...newSpecifications);
            specification = flattened;
            unusedGivens = newUnusedGivens;
        }
        else {
            // A negative condition on a result branches an excluding feed,
            // and a restoring feed for each way the excluded fact can be
            // cancelled. A negative condition on an excluded fact is one of
            // those ways, and the excluding level that holds it has already
            // built its restoring feeds, so here it only filters.
            const innerParity = parity + 1;
            if (innerParity % 2 !== 0) {
                specifications.push(...addExclusion(specification, unusedGivens, label, conditions.slice(index + 1), existentialCondition.matches, projectionComponents, innerParity, rest));
            }

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
            specification = withCondition(specification, newGivens, newExistentialCondition, label);
            unusedGivens = newUnusedGivens;
        }
    }
    return { specifications, specification, unusedGivens };
}

/**
 * The feeds of a negative condition on a result: one excluding feed, and one
 * restoring feed for each negative condition inside the excluded level.
 *
 * The excluding feed is the current feed followed by the condition's matches,
 * emitted after the restoring feeds. It is evidence that results should be
 * removed, so it stops there.
 *
 * An excluded fact is cancelled when any one of its negative conditions fails,
 * wherever in its level that condition is written: on the fact itself, or on a
 * match a positive condition joined to it. So each restoring feed starts from
 * the whole excluded level with path conditions only, follows the matches of
 * one canceller, and then goes on to the remainder. It carries none of the
 * level's other negative conditions, the ones written before it or after it.
 * Keeping them left a fact cancelled twice over in no restoring feed at all
 * (#427). The remainder does carry the conditions still waiting on the result
 * (`pending`), because they filter the result the feed restores (#368).
 */
function addExclusion(specification: Specification, unusedGivens: Label[], label: string, pending: ExistentialCondition[], matches: Match[], projectionComponents: ComponentProjection[], parity: number, rest: Continuation): Specification[] {
    const specifications: Specification[] = [];
    const level = flattenLevel(matches);
    const { specification: levelFeed, unusedGivens: levelUnusedGivens } = addMatches(specification, unusedGivens,
        level.map(match => ({ ...match, conditions: match.conditions.filter(isPathCondition) })),
        projectionComponents, parity, null, true);
    const continuation: Continuation = {
        pending: { label, conditions: pending },
        matches: rest.matches,
        projectionComponents: rest.projectionComponents,
        parent: rest.parent
    };
    const cancellers = level.flatMap(match => match.conditions
        .filter(isExistentialCondition)
        .filter(condition => !condition.exists));
    for (const canceller of cancellers) {
        const { specifications: restoring } = addMatches(levelFeed, levelUnusedGivens, canceller.matches, projectionComponents, parity + 1, continuation, false);
        specifications.push(...restoring);
    }
    const { specifications: excluding } = addMatches(specification, unusedGivens, matches, projectionComponents, parity, null, false);
    specifications.push(...excluding);
    return specifications;
}

/**
 * A level's matches with every positive condition's matches joined in, each
 * right after the match that holds it. What remains on each match is its path
 * conditions and its negative conditions.
 */
function flattenLevel(matches: Match[]): Match[] {
    return matches.flatMap(match => [
        { ...match, conditions: match.conditions.filter(condition => isPathCondition(condition) || !condition.exists) },
        ...flattenLevel(match.conditions
            .filter(isExistentialCondition)
            .filter(condition => condition.exists)
            .flatMap(condition => condition.matches))
    ]);
}

/**
 * Match the remainder a continuation carries: first the conditions still
 * waiting on a match this feed already holds, then the matches after it.
 *
 * Parity stays where it is. A negative condition anywhere in the remainder is
 * the *first* level of negation relative to this feed.
 */
function continueWith(specification: Specification, unusedGivens: Label[], parity: number, continuation: Continuation): { specifications: Specification[]; unusedGivens: Label[]; } {
    const specifications: Specification[] = [];
    if (continuation.pending !== null) {
        const rest: Continuation = {
            pending: null,
            matches: continuation.matches,
            projectionComponents: continuation.projectionComponents,
            parent: continuation.parent
        };
        const { specifications: conditionSpecifications, specification: conditioned, unusedGivens: conditionUnusedGivens } =
            addConditions(specification, unusedGivens, continuation.pending.label, continuation.pending.conditions, continuation.projectionComponents, parity, rest);
        specifications.push(...conditionSpecifications);
        specification = conditioned;
        unusedGivens = conditionUnusedGivens;
    }
    const { specifications: continued, unusedGivens: continuedUnusedGivens } = addMatches(specification, unusedGivens, continuation.matches, continuation.projectionComponents, parity, continuation.parent, false);
    specifications.push(...continued);
    return { specifications, unusedGivens: continuedUnusedGivens };
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
                // They join this condition's level, so they accumulate onto it:
                // the inner condition is not the accumulator, or its matches
                // would be added twice and its polarity would replace this one's.
                const { existentialCondition: newExistentialCondition, givens: newGivens, unusedGivens: newUnusedGivens } = buildExistentialCondition(existentialCondition, innerExistentialCondition.matches, givens, unusedGivens);
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
            const { specifications: componentFeeds } = addMatches(specification, unusedGivens, component.matches, childComponents, 0, null, false);
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