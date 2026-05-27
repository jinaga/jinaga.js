import { User } from "../model/user";
import {
    Condition,
    ExistentialCondition,
    Match,
    NamedComponentProjection,
    Projection,
    Specification,
    SpecificationGiven
} from "./specification";
import { Invalid } from "./specification-parser";

/**
 * Rename labels in a specification according to a mapping.
 *
 * The transformation is "alpha" in the lambda-calculus sense — it preserves
 * meaning by renaming bound names consistently. Used by intersection to avoid
 * label collisions when merging a distribution rule's user spec into the
 * caller's spec.
 */
export function alphaTransform(spec: Specification, mapping: Record<string, string>): Specification {
    if (spec === null || spec === undefined) {
        throw new Invalid("Specification is required");
    }
    if (mapping === null || mapping === undefined) {
        throw new Invalid("Mapping is required");
    }

    const allLabels = new Set<string>();
    function collectLabels(spec: Specification) {
        spec.given.forEach(g => {
            allLabels.add(g.label.name);
            g.conditions.forEach(c => collectConditionLabels(c));
        });
        spec.matches.forEach(m => {
            allLabels.add(m.unknown.name);
            m.conditions.forEach(c => collectConditionLabels(c));
        });
        collectProjectionLabels(spec.projection);
    }
    function collectConditionLabels(condition: Condition) {
        if (condition.type === "path") {
            allLabels.add(condition.labelRight);
        } else if (condition.type === "existential") {
            condition.matches.forEach(m => {
                allLabels.add(m.unknown.name);
                m.conditions.forEach(c => collectConditionLabels(c));
            });
        }
    }
    function collectProjectionLabels(projection: Projection) {
        if (projection.type === "composite") {
            projection.components.forEach(c => collectComponentLabels(c));
        } else if (projection.type === "field" || projection.type === "hash" || projection.type === "fact") {
            allLabels.add(projection.label);
        }
    }
    function collectComponentLabels(component: NamedComponentProjection) {
        if (component.type === "specification") {
            component.matches.forEach(m => {
                allLabels.add(m.unknown.name);
                m.conditions.forEach(c => collectConditionLabels(c));
            });
            collectProjectionLabels(component.projection);
        } else if (component.type === "field" || component.type === "hash" || component.type === "fact") {
            allLabels.add(component.label);
        }
    }
    collectLabels(spec);

    const mappedValues = Object.values(mapping);
    const uniqueMappedValues = new Set(mappedValues);
    if (uniqueMappedValues.size !== mappedValues.length) {
        throw new Invalid("Mapping contains duplicate target names");
    }

    const mappedKeys = new Set(Object.keys(mapping));
    for (const label of allLabels) {
        if (!mappedKeys.has(label)) {
            if (uniqueMappedValues.has(label)) {
                throw new Invalid(`Mapped name '${label}' conflicts with existing unmapped label`);
            }
        }
    }

    const transformLabel = (name: string) => mapping[name] || name;

    const transformGiven = (given: SpecificationGiven): SpecificationGiven => ({
        label: { ...given.label, name: transformLabel(given.label.name) },
        conditions: given.conditions.map(transformCondition) as ExistentialCondition[]
    });

    const transformMatch = (match: Match): Match => ({
        unknown: { ...match.unknown, name: transformLabel(match.unknown.name) },
        conditions: match.conditions.map(transformCondition)
    });

    const transformCondition = (condition: Condition): Condition => {
        if (condition.type === "path") {
            return {
                ...condition,
                labelRight: transformLabel(condition.labelRight)
            };
        } else if (condition.type === "existential") {
            return {
                ...condition,
                matches: condition.matches.map(transformMatch)
            };
        }
        return condition;
    };

    const transformProjection = (projection: Projection): Projection => {
        if (projection.type === "composite") {
            return {
                ...projection,
                components: projection.components.map(transformComponent)
            };
        } else if (projection.type === "field" || projection.type === "hash" || projection.type === "fact") {
            return {
                ...projection,
                label: transformLabel(projection.label)
            };
        }
        return projection;
    };

    const transformComponent = (component: NamedComponentProjection): NamedComponentProjection => {
        if (component.type === "specification") {
            return {
                ...component,
                matches: component.matches.map(transformMatch),
                projection: transformProjection(component.projection)
            };
        } else if (component.type === "field" || component.type === "hash" || component.type === "fact") {
            return {
                ...component,
                label: transformLabel(component.label)
            };
        }
        return component;
    };

    return {
        given: spec.given.map(transformGiven),
        matches: spec.matches.map(transformMatch),
        projection: transformProjection(spec.projection)
    };
}

/**
 * Name of the synthetic given that the intersection introduces. It binds to
 * the user fact whose authorization the spec is being filtered for, so the
 * intersected spec returns empty when that user isn't authorized and fills
 * in when they are.
 */
export const DISTRIBUTION_USER_LABEL = "distributionUser";

/**
 * Intersect a specification with a distribution rule's user specification,
 * producing a specification whose result set is gated by the rule.
 *
 * Mechanic: add a synthetic `distributionUser` given (a `Jinaga.User`), then
 * lift the rule's user-spec matches into the target spec as top-level
 * matches (alpha-renamed to avoid collisions). Pin the rule's projected
 * user label to `distributionUser` with an extra path condition; if the
 * rule projects a given directly, synthesize an in-spec equality match.
 *
 * Lifting into top-level matches (rather than wrapping in an existential
 * on a synthetic anchor) gives every new label a path condition into the
 * spec graph — so the connectivity check and `shakeTree` in the inverter
 * walk it the same way they walk any other spec. The inverter then
 * naturally produces inverses for the authorizing fact pattern, and a
 * subscriber sees results materialize the moment the auth fact arrives —
 * no client-side retry, no observer.loaded().catch() guard.
 *
 * For typical "share with admin" rules each (start, distributionUser) tuple
 * admits at most one authorizing path, so lifted matches don't multiply
 * the output. Specs that authorize via multiple distinct paths (e.g., user
 * is both creator and administrator) may see duplicated rows; observer-
 * level dedup is the safety net there.
 */
export function intersectSpecificationWithDistributionRule(
    specification: Specification,
    ruleSpecification: Specification
): Specification {
    if (specification === null || specification === undefined) {
        throw new Error("Specification is required");
    }
    if (ruleSpecification === null || ruleSpecification === undefined) {
        throw new Error("Rule specification is required");
    }
    if (specification.given.length !== ruleSpecification.given.length) {
        throw new Error("The number of givens in the rule specification must match the number of givens in the original specification.");
    }
    for (let i = 0; i < specification.given.length; i++) {
        const given = specification.given[i];
        const ruleGiven = ruleSpecification.given[i];
        if (given.label.type !== ruleGiven.label.type) {
            throw new Error("The givens in the rule specification must have the same types as the givens in the original specification.");
        }
    }

    const ruleProjection = ruleSpecification.projection;
    if (ruleProjection.type !== "fact") {
        throw new Error("Distribution rule specification must have a fact projection.");
    }
    const projectedLabel = ruleProjection.label;

    // The user can come from either an unknown match or directly from a given.
    const distributionUserMatch = ruleSpecification.matches.find(m => m.unknown.name === projectedLabel);
    const projectedFromGiven = ruleSpecification.given.find(g => g.label.name === projectedLabel);
    if (!distributionUserMatch && !projectedFromGiven) {
        throw new Error("Distribution rule specification must have a match or given for the projected user fact.");
    }
    const projectedType = distributionUserMatch ? distributionUserMatch.unknown.type : projectedFromGiven!.label.type;
    if (projectedType !== User.Type) {
        throw new Error("Distribution rule specification must project a user fact.");
    }

    // Collect every label name that already exists in either spec so we can
    // pick non-colliding names for the rule's unknowns. The new synthetic
    // given is also reserved.
    const originalLabels = new Set<string>();
    function collectAllLabels(spec: Specification) {
        spec.given.forEach(g => originalLabels.add(g.label.name));
        function visitMatches(matches: Match[]) {
            matches.forEach(m => {
                originalLabels.add(m.unknown.name);
                m.conditions.forEach(c => {
                    if (c.type === "existential") visitMatches(c.matches);
                });
            });
        }
        visitMatches(spec.matches);
        if (spec.projection.type === "fact" || spec.projection.type === "field" || spec.projection.type === "hash") {
            originalLabels.add(spec.projection.label);
        } else if (spec.projection.type === "composite") {
            spec.projection.components.forEach(c => {
                if (c.type === "fact" || c.type === "field" || c.type === "hash") {
                    originalLabels.add(c.label);
                }
            });
        }
    }
    collectAllLabels(specification);
    collectAllLabels(ruleSpecification);
    originalLabels.add(DISTRIBUTION_USER_LABEL);

    // Rename every rule unknown to a non-colliding dist_-prefixed name. The
    // shared given names stay the same so the rule's path conditions still
    // reference the original givens.
    const ruleUnknowns = new Set<string>();
    ruleSpecification.matches.forEach(m => {
        if (!ruleSpecification.given.some(g => g.label.name === m.unknown.name)) {
            ruleUnknowns.add(m.unknown.name);
        }
    });
    const mapping: Record<string, string> = {};
    for (const unknown of ruleUnknowns) {
        let newName = "dist_" + unknown;
        let counter = 1;
        while (originalLabels.has(newName)) {
            newName = "dist_" + unknown + counter;
            counter++;
        }
        mapping[unknown] = newName;
        originalLabels.add(newName);
    }

    const transformedRuleSpec = alphaTransform(ruleSpecification, mapping);
    if (transformedRuleSpec.projection.type !== "fact") {
        throw new Error("Transformed rule specification must have a fact projection.");
    }
    const transformedProjectedLabel = transformedRuleSpec.projection.label;

    // Lift the rule's matches into top-level matches with the projected
    // user pinned to the new `distributionUser` given.
    let liftedMatches: Match[];
    if (transformedRuleSpec.matches.find(m => m.unknown.name === transformedProjectedLabel)) {
        liftedMatches = transformedRuleSpec.matches.map(match => {
            if (match.unknown.name === transformedProjectedLabel) {
                return {
                    ...match,
                    conditions: [
                        ...match.conditions,
                        {
                            type: "path",
                            labelRight: DISTRIBUTION_USER_LABEL,
                            rolesLeft: [],
                            rolesRight: []
                        }
                    ]
                };
            }
            return match;
        });
    } else {
        // The rule projects a given directly (e.g., `select(user => user)`).
        // Synthesize an identity match that ties that given to the new
        // `distributionUser` given.
        const givenProjected = transformedRuleSpec.given.find(g => g.label.name === transformedProjectedLabel);
        if (!givenProjected) {
            throw new Error("Transformed rule specification must have a match or given for the projected user fact.");
        }
        const synthName = `dist_${transformedProjectedLabel}`;
        let candidate = synthName;
        let counter = 1;
        while (originalLabels.has(candidate)) {
            candidate = synthName + counter;
            counter++;
        }
        originalLabels.add(candidate);
        liftedMatches = [
            ...transformedRuleSpec.matches,
            {
                unknown: { name: candidate, type: User.Type },
                conditions: [
                    {
                        type: "path",
                        labelRight: transformedProjectedLabel,
                        rolesLeft: [],
                        rolesRight: []
                    },
                    {
                        type: "path",
                        labelRight: DISTRIBUTION_USER_LABEL,
                        rolesLeft: [],
                        rolesRight: []
                    }
                ]
            }
        ];
    }

    const distributionUserGiven: SpecificationGiven = {
        label: {
            name: DISTRIBUTION_USER_LABEL,
            type: User.Type
        },
        conditions: []
    };

    return {
        given: [
            ...specification.given,
            distributionUserGiven
        ],
        // Lifted matches go before the original spec matches so the auth
        // path is established and connected before the spec's own matches
        // produce candidates.
        matches: [...liftedMatches, ...specification.matches],
        projection: specification.projection
    };
}

/**
 * True if `specification` carries the synthetic `distributionUser` given —
 * i.e., it has the surface shape an intersected spec would have.
 *
 * **Not a security boundary.** The shape is trivially forgeable by a caller
 * (anyone can author a spec with a given named `distributionUser` of type
 * `Jinaga.User`), so this MUST NOT be used to bypass authorization checks.
 * The bypass for intersected feeds lives in `NetworkDistribution` as
 * runtime state populated only by the engine's own intersection — that
 * marker is unforgeable and is the one to trust. Keep this helper for
 * diagnostic/serialization purposes only.
 */
export function specificationHasIntersection(specification: Specification): boolean {
    return specification.given.some(g =>
        g.label.name === DISTRIBUTION_USER_LABEL && g.label.type === User.Type
    );
}
