import { Specification, SpecificationGiven, Match, Condition, Projection, NamedComponentProjection, ExistentialCondition } from "./specification";
import { Invalid } from "./specification-parser";

export function alphaTransform(spec: Specification, mapping: Record<string, string>): Specification {
    if (spec === null || spec === undefined) {
        throw new Invalid("Specification is required");
    }
    if (mapping === null || mapping === undefined) {
        throw new Invalid("Mapping is required");
    }

    // Collect all label names in the specification
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

    // Check that all values in the mapping are unique
    const mappedValues = Object.values(mapping);
    const uniqueMappedValues = new Set(mappedValues);
    if (uniqueMappedValues.size !== mappedValues.length) {
        throw new Invalid("Mapping contains duplicate target names");
    }

    // Check that mapped names don't conflict with existing unmapped label names
    const mappedKeys = new Set(Object.keys(mapping));
    for (const label of allLabels) {
        if (!mappedKeys.has(label)) {
            if (uniqueMappedValues.has(label)) {
                throw new Invalid(`Mapped name '${label}' conflicts with existing unmapped label`);
            }
        }
    }

    // Helper function to transform a label name
    const transformLabel = (name: string) => mapping[name] || name;

    // Transform SpecificationGiven
    const transformGiven = (given: SpecificationGiven): SpecificationGiven => ({
        label: { ...given.label, name: transformLabel(given.label.name) },
        conditions: given.conditions.map(transformCondition) as ExistentialCondition[]
    });

    // Transform Match
    const transformMatch = (match: Match): Match => ({
        unknown: { ...match.unknown, name: transformLabel(match.unknown.name) },
        conditions: match.conditions.map(transformCondition)
    });

    // Transform Condition
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

    // Transform Projection
    const transformProjection = (projection: Projection): Projection => {
        if (projection.type === "composite") {
            return {
                ...projection,
                components: projection.components.map(transformComponent)
            };
        } else if (projection.type === "field") {
            return {
                ...projection,
                label: transformLabel(projection.label)
            };
        } else if (projection.type === "hash") {
            return {
                ...projection,
                label: transformLabel(projection.label)
            };
        } else if (projection.type === "fact") {
            return {
                ...projection,
                label: transformLabel(projection.label)
            };
        }
        return projection;
    };

    // Transform NamedComponentProjection
    const transformComponent = (component: NamedComponentProjection): NamedComponentProjection => {
        if (component.type === "specification") {
            return {
                ...component,
                matches: component.matches.map(transformMatch),
                projection: transformProjection(component.projection)
            };
        } else {
            // SingularProjection
            if (component.type === "field") {
                return {
                    ...component,
                    label: transformLabel(component.label)
                };
            } else if (component.type === "hash") {
                return {
                    ...component,
                    label: transformLabel(component.label)
                };
            } else if (component.type === "fact") {
                return {
                    ...component,
                    label: transformLabel(component.label)
                };
            }
        }
        return component;
    };

    return {
        given: spec.given.map(transformGiven),
        matches: spec.matches.map(transformMatch),
        projection: transformProjection(spec.projection)
    };
}