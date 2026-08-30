import { Match, Projection, Specification, isPathCondition } from "./specification";

/**
 * Every match must be *rooted*: its first condition has to be a path condition
 * that joins the unknown to a given or to a label bound by an earlier match.
 *
 * That is not a stylistic rule. Jinaga reaches facts only by walking edges out
 * of the facts it was given -- `SpecificationRunner.executeMatch` starts a match
 * by following its first path condition, and `skeletonOfSpecification` registers
 * the unknown while it walks one. There is no "all facts of this type"
 * operation for either of them to fall back on. An existential condition can
 * only filter the candidates a path condition produced; on its own it names no
 * candidates at all, even though `SpecificationParser` is happy to parse a match
 * whose sole condition is one.
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
 * Collect the structural defects that would keep a specification from being
 * executed or decomposed into feeds.
 *
 * Use this at an authoring boundary -- wherever a specification is accepted from
 * outside and stored -- so that a defect is reported where it was written rather
 * than much later, from deep inside feed generation.
 *
 * @param specification The specification to validate.
 * @returns One message per defect, or an empty array if the specification is sound.
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
 * Validate a specification, throwing if it has any structural defect.
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
