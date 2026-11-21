import { Condition, Match, Projection, Specification, reservedLabelPrefix } from "./specification";

/**
 * The specification with its repeated declarations renamed, so that each of its
 * descendants declares every label once.
 *
 * A descendant is the specification's matches, at every depth of condition,
 * followed by the matches of one child specification at each level down to it.
 * Lexical scope lets two declarations in one descendant share a name when
 * neither is in scope of the other: sibling existential conditions, or a
 * condition and a later match or child. `buildFeeds` joins a descendant's
 * matches into one feed, where both would then be in scope.
 *
 * Walking each descendant in declaration order, a match that declares a name
 * already declared earlier in that descendant takes the first of `name2`,
 * `name3`, … that appears nowhere in the specification, and every reference to
 * it within its scope follows. A new name never begins with the reserved
 * prefix, which a repeated `__` name loses first. Givens keep their names, because a caller's
 * start facts are found by them. Sibling children are separate descendants, so
 * they may keep a shared label.
 *
 * A specification that repeats no label in any descendant is returned as is.
 */
export function withDistinctLabels(specification: Specification): Specification {
    const taken = new Set<string>(labelsOf(specification));
    let renamed = false;

    function fresh(name: string): string {
        const base = name.startsWith(reservedLabelPrefix) ? name.replace(/^_+/, "") || "label" : name;
        for (let suffix = 2; ; suffix++) {
            const candidate = `${base}${suffix}`;
            if (!taken.has(candidate)) {
                taken.add(candidate);
                return candidate;
            }
        }
    }

    // `scope` maps each name in lexical scope to its new name. `declared` holds
    // the names this descendant has declared so far, and is shared by every
    // depth of condition.
    function renameMatches(matches: Match[], scope: Map<string, string>, declared: Set<string>): { matches: Match[]; scope: Map<string, string> } {
        const result = matches.map(match => {
            const original = match.unknown.name;
            const name = declared.has(original) ? fresh(original) : original;
            renamed = renamed || name !== original;
            declared.add(name);
            const inner = new Map(scope).set(original, name);
            const conditions = match.conditions.map((condition): Condition => condition.type === "path"
                ? { ...condition, labelRight: scope.get(condition.labelRight) ?? condition.labelRight }
                : { ...condition, matches: renameMatches(condition.matches, inner, declared).matches });
            scope = inner;
            return { ...match, unknown: { ...match.unknown, name }, conditions };
        });
        return { matches: result, scope };
    }

    function renameProjection(projection: Projection, scope: Map<string, string>, declared: Set<string>): Projection {
        if (projection.type !== "composite") {
            return { ...projection, label: scope.get(projection.label) ?? projection.label };
        }
        return {
            ...projection,
            components: projection.components.map(component => {
                if (component.type !== "specification") {
                    return { ...component, label: scope.get(component.label) ?? component.label };
                }
                // Each child begins a descendant of its own.
                const childDeclared = new Set(declared);
                const child = renameMatches(component.matches, scope, childDeclared);
                return { ...component, matches: child.matches, projection: renameProjection(component.projection, child.scope, childDeclared) };
            })
        };
    }

    const givens = specification.given.map(given => given.label.name);
    const declared = new Set(givens);
    const top = renameMatches(specification.matches, new Map(givens.map(name => [name, name])), declared);
    const projection = renameProjection(specification.projection, top.scope, declared);
    return renamed ? { ...specification, matches: top.matches, projection } : specification;
}

/** Every label the specification declares, anywhere. */
function labelsOf(specification: Specification): string[] {
    const ofMatches = (matches: Match[]): string[] => matches.flatMap(match => [
        match.unknown.name,
        ...match.conditions.flatMap(condition => condition.type === "path" ? [] : ofMatches(condition.matches))
    ]);
    const ofProjection = (projection: Projection): string[] => projection.type !== "composite" ? [] :
        projection.components.flatMap(component => component.type === "specification"
            ? [...ofMatches(component.matches), ...ofProjection(component.projection)]
            : []);
    return [
        ...specification.given.flatMap(given => [given.label.name, ...given.conditions.flatMap(condition => ofMatches(condition.matches))]),
        ...ofMatches(specification.matches),
        ...ofProjection(specification.projection)
    ];
}
