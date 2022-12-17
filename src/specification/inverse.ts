import { Condition, ExistentialCondition, Label, Match, PathCondition, Projection, Specification } from "./specification";

type InverseOperation = "add" | "remove" | "maybeAdd" | "maybeRemove";

export interface SpecificationInverse {
    inverseSpecification: Specification;
    operation: InverseOperation;
    givenSubset: string[];
    parentSubset: string[];
    path: string;
};

export function invertSpecification(specification: Specification): SpecificationInverse[] {
    // Turn each given into a match.
    const emptyMatches: Match[] = specification.given.map(g => ({
        unknown: g,
        conditions: []
    }));
    const matches: Match[] = [...emptyMatches, ...specification.matches];

    const labels: Label[] = specification.matches.map(m => m.unknown);
    const givenSubset: string[] = specification.given.map(g => g.name);
    const inverses: SpecificationInverse[] = invertMatches(matches, labels, "", givenSubset, givenSubset, specification.projection);
    const resultSubset: string[] = [ ...givenSubset, ...specification.matches.map(m => m.unknown.name) ];
    const projectionInverses: SpecificationInverse[] = invertProjection(matches, "", givenSubset, resultSubset, specification.projection);
    return [ ...inverses, ...projectionInverses ];
}

function invertMatches(matches: Match[], labels: Label[], path: string, givenSubset: string[], parentSubset: string[], projection: Projection): SpecificationInverse[] {
    const inverses: SpecificationInverse[] = [];

    // Produce an inverse for each unknown in the original specification.
    for (const label of labels) {
        matches = shakeTree(matches, label.name);
        // The given will not have any successors.
        // Simplify the matches by removing any conditions that cannot be satisfied.
        const simplified: Match[] | null = simplifyMatches(matches, label.name);
        if (simplified === null) {
            continue;
        }

        const inverseSpecification: Specification = {
            given: [label],
            matches: simplified.slice(1),
            projection: projection
        };
        const inverse: SpecificationInverse = {
            inverseSpecification: inverseSpecification,
            operation: "add",
            givenSubset: givenSubset,
            parentSubset: parentSubset,
            path: path
        };

        inverses.push(inverse);

        const existentialInverses: SpecificationInverse[] = invertExistentialConditions(matches, projection, matches[0].conditions, "add", "", givenSubset);
        inverses.push(...existentialInverses);
    }

    return inverses;
}

function shakeTree(matches: Match[], label: string): Match[] {
    // Find the match for the given label.
    const match: Match = findMatch(matches, label);

    // Move the match to the beginning of the list.
    matches = [ match, ...matches.filter(m => m !== match) ];

    // Invert all path conditions in the match and move them to the tagged match.
    for (const condition of match.conditions) {
        if (condition.type === "path") {
            matches = invertAndMovePathCondition(matches, label, condition);
        }
    }

    // Move any other matches with no paths down.
    for (let i = 1; i < matches.length; i++) {
        const otherMatch: Match = matches[i];
        if (!otherMatch.conditions.some(c => c.type === "path")) {
            // Find all matches beyond this point that tag this one.
            for (let j = i + 1; j < matches.length; j++) {
                const taggedMatch: Match = matches[j];
                // Move their path conditions to the other match.
                for (const taggedCondition of taggedMatch.conditions) {
                    if (taggedCondition.type === "path" &&
                        taggedCondition.labelRight === otherMatch.unknown.name) {
                        matches = invertAndMovePathCondition(matches, taggedMatch.unknown.name, taggedCondition);
                    }
                }
            }

            // Move the other match to the bottom of the list.
            matches = [ ...matches.slice(0, i), ...matches.slice(i + 1), matches[i] ];
        }
    }

    return matches;
}

function invertAndMovePathCondition(matches: Match[], label: string, pathCondition: PathCondition): Match[] {
    // Find the match for the given label.
    const match: Match = findMatch(matches, label);

    // Find the match for the target label.
    const targetMatch: Match = findMatch(matches, pathCondition.labelRight);

    // Invert the path condition.
    const invertedPathCondition: PathCondition = {
        type: "path",
        labelRight: match.unknown.name,
        rolesRight: pathCondition.rolesLeft,
        rolesLeft: pathCondition.rolesRight
    };

    // Remove the path condition from the match.
    const newMatch: Match = {
        unknown: match.unknown,
        conditions: match.conditions.filter(c => c !== pathCondition)
    };
    const matchIndex = matches.indexOf(match);
    matches = [ ...matches.slice(0, matchIndex), newMatch, ...matches.slice(matchIndex + 1) ];

    // Add the inverted path condition to the target match.
    const newTargetMatch: Match = {
        unknown: targetMatch.unknown,
        conditions: [ invertedPathCondition, ...targetMatch.conditions ]
    };
    const targetMatchIndex = matches.indexOf(targetMatch);
    matches = [ ...matches.slice(0, targetMatchIndex), newTargetMatch, ...matches.slice(targetMatchIndex + 1) ];

    return matches;
}

function findMatch(matches: Match[], label: string): Match {
    for (const match of matches) {
        if (match.unknown.name === label) {
            return match;
        }
    }

    throw new Error(`Label ${label} not found`);
}

function invertExistentialConditions(outerMatches: Match[], projection: Projection, conditions: Condition[], parentOperation: InverseOperation, parentPath: string, givenSubset: string[]): SpecificationInverse[] {
    const inverses: SpecificationInverse[] = [];

    // Produce inverses for each existential condition in the match.
    for (const condition of conditions) {
        if (condition.type === "existential") {
            let matches = [ ...outerMatches, ...condition.matches ];
            for (const match of condition.matches) {
                matches = shakeTree(matches, match.unknown.name);
                const matchesWithoutCondition: Match[] = removeCondition(matches.slice(1), condition);
                const inverseSpecification: Specification = {
                    given: [match.unknown],
                    matches: matchesWithoutCondition,
                    projection: projection
                };
                const parentSubset = outerMatches.map(m => m.unknown.name);
                const path = parentPath + "." + match.unknown.name;
                const inverse: SpecificationInverse = {
                    inverseSpecification: inverseSpecification,
                    operation: inferOperation(parentOperation, condition.exists),
                    givenSubset: givenSubset,
                    parentSubset: parentSubset,
                    path: path
                };

                inverses.push(inverse);
            }
        }
    }

    return inverses;
}

function removeCondition(matches: Match[], condition: ExistentialCondition): Match[] {
    return matches.map(match =>
        match.conditions.includes(condition) ?
            {
                unknown: match.unknown,
                conditions: match.conditions.filter(c => c !== condition)
            } :
            match
    );
}

function inferOperation(parentOperation: InverseOperation, exists: boolean): InverseOperation {
    if (parentOperation === "add") {
        return exists ? "maybeAdd" : "remove";
    }
    else {
        throw new Error(`Cannot infer operation from ${parentOperation}, ${exists ? "exists" : "not exists"}`);
    }
}

function invertProjection(matches: Match[], parentPath: string, givenSubset: string[], parentSubset: string[], projection: Projection): SpecificationInverse[] {
    const inverses: SpecificationInverse[] = [];

    // Produce inverses for all collections in the projection.
    if (projection.type === "composite") {
        for (const component of projection.components) {
            if (component.type === "specification") {
                const componentMatches = [ ...matches, ...component.matches ];
                const componentLabels = component.matches.map(m => m.unknown);
                const path = parentPath + "." + component.name;
                const matchInverses = invertMatches(componentMatches, componentLabels, path, givenSubset, parentSubset, component.projection);
                const resultSubset = [ ...parentSubset, ...componentLabels.map(l => l.name) ];
                const projectionInverses = invertProjection(componentMatches, path, givenSubset, resultSubset, component.projection);
                inverses.push(...matchInverses, ...projectionInverses);
            }
        }
    }

    return inverses;
}

function simplifyMatches(matches: Match[], given: string): Match[] | null {
    const simplifiedMatches: Match[] = [];

    for (const match of matches) {
        const simplifiedMatch: Match | null = simplifyMatch(match, given);
        if (simplifiedMatch === null) {
            return null;
        }
        else {
            simplifiedMatches.push(simplifiedMatch);
        }
    }

    return simplifiedMatches;
}

function simplifyMatch(match: Match, given: string): Match | null {
    const simplifiedConditions: Condition[] = [];

    for (const condition of match.conditions) {
        if (condition.type === "path" &&
            condition.labelRight === given &&
            condition.rolesRight.length === 0 &&
            condition.rolesLeft.length > 0) {
            // This path condition matches successors of the given.
            // There are no successors yet, so the condition is unsatisfiable.
            return null;
        }
        // TODO: Handle existential conditions.

        simplifiedConditions.push(condition);
    }

    return {
        unknown: match.unknown,
        conditions: simplifiedConditions
    };
}