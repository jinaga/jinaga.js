import { Match, Projection, Specification, isPathCondition } from "./specification";

/**
 * A match must begin with a path condition. That is the condition that roots the
 * match: it names the label the unknown is reached from. Whether that label is
 * actually in scope is a question about the surrounding specification, not about
 * this match, and is checked where the scope is known --
 * `SpecificationParser.parsePathCondition` while it reads the text, and
 * `SpecificationRunner` when it runs.
 *
 * Rooting is not a stylistic rule. Jinaga reaches facts only by walking edges out
 * of the facts it was given -- `SpecificationRunner.executeMatch` starts a match
 * by following its first path condition, and `skeletonOfSpecification` registers
 * the unknown while it walks one. Neither has an "all facts of this type"
 * operation to fall back on. An existential condition only filters the candidates
 * a path condition produced, so a match that has none names no candidates at all.
 *
 * @param match The match to inspect.
 * @returns A description of the defect, or null if the match is rooted.
 */
export function matchStructureError(match: Match): string | null {
    if (match.conditions.length === 0) {
        return `The match for '${match.unknown.name}' has no conditions. ` +
            `A match must be joined to a given or a prior label by a path condition.`;
    }
    if (!isPathCondition(match.conditions[0])) {
        if (match.conditions.some(isPathCondition)) {
            return `The match for '${match.unknown.name}' begins with an existential condition. ` +
                `A match must begin with a path condition that joins it to a given or a prior label.`;
        }
        return `The match for '${match.unknown.name}' has no path condition. ` +
            `An existential condition can only filter a match, so it cannot be the only condition. ` +
            `Join '${match.unknown.name}' to a given or a prior label with a path condition.`;
    }
    return null;
}

/**
 * Collect the unrooted matches of a specification -- in its matches, in the
 * matches nested in existential conditions, in the conditions on its givens, and
 * in the matches of its projections.
 *
 * Use this at an authoring boundary -- wherever a specification is accepted from
 * outside and stored -- so that a defect is reported where it was written rather
 * than much later, from deep inside feed generation. It answers one question,
 * not every question: `detectDisconnectedSpecification` covers connectedness,
 * which no single match can decide.
 *
 * @param specification The specification to validate.
 * @returns One message per unrooted match, or an empty array if every match is rooted.
 */
export function validateSpecification(specification: Specification): string[] {
    const errors: string[] = [];
    for (const given of specification.given) {
        for (const condition of given.conditions) {
            validateMatches(condition.matches, errors);
        }
    }
    validateMatches(specification.matches, errors);
    validateProjection(specification.projection, errors);
    return errors;
}

/**
 * Validate a specification with {@link validateSpecification}, throwing if any of
 * its matches is unrooted.
 *
 * @param specification The specification to validate.
 * @param description Names the specification in the error message.
 */
export function validateSpecificationOrThrow(specification: Specification, description: string): void {
    const errors = validateSpecification(specification);
    if (errors.length > 0) {
        throw new Error(`${description} is not valid. ${errors.join(" ")}`);
    }
}

function validateMatches(matches: Match[], errors: string[]) {
    for (const match of matches) {
        const error = matchStructureError(match);
        if (error) {
            errors.push(error);
        }
        for (const condition of match.conditions) {
            if (!isPathCondition(condition)) {
                validateMatches(condition.matches, errors);
            }
        }
    }
}

function validateProjection(projection: Projection, errors: string[]) {
    if (projection.type === "composite") {
        for (const component of projection.components) {
            if (component.type === "specification") {
                validateMatches(component.matches, errors);
                validateProjection(component.projection, errors);
            }
        }
    }
}
