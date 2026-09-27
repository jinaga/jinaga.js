export interface Label {
    name: string;
    type: string;
}

export interface SpecificationGiven {
    label: Label;
    conditions: ExistentialCondition[];
}

export interface Role {
    name: string;
    predecessorType: string;
}

export interface PathCondition {
    type: "path",
    rolesLeft: Role[],
    labelRight: string,
    rolesRight: Role[]
}

export interface ExistentialCondition {
    type: "existential",
    exists: boolean,
    matches: Match[]
}

export type Condition = PathCondition | ExistentialCondition;

export function isPathCondition(condition: Condition): condition is PathCondition {
    return condition.type === "path";
}

/**
 * Type guard that checks if the given condition is an existential condition.
 * @param condition The condition to check.
 * @returns True if the condition is an ExistentialCondition, false otherwise.
 * @example
 * const condition: Condition = { type: "existential", exists: true, matches: [] };
 * if (isExistentialCondition(condition)) {
 *     // condition is now typed as ExistentialCondition
 *     console.log(condition.exists);
 * }
 */
export function isExistentialCondition(condition: Condition): condition is ExistentialCondition {
    return condition.type === "existential";
}

export interface SpecificationProjection {
    type: "specification",
    matches: Match[],
    projection: Projection
}

export interface FieldProjection {
    type: "field",
    label: string,
    field: string
}

export interface HashProjection {
    type: "hash",
    label: string
}

export interface TimeProjection {
    type: "time",
    label: string
}

export interface FactProjection {
    type: "fact",
    label: string
}

export interface CompositeProjection {
    type: "composite",
    components: NamedComponentProjection[]
}

export type NamedComponentProjection = { name: string } & ComponentProjection;
export type ComponentProjection = SpecificationProjection | SingularProjection;
export type SingularProjection = FieldProjection | HashProjection | TimeProjection | FactProjection;
export type Projection = CompositeProjection | SingularProjection;

export interface Match {
    unknown: Label;
    conditions: Condition[];
}

export interface Specification {
    given: SpecificationGiven[];
    matches: Match[];
    projection: Projection;
}

declare const wellFormed: unique symbol;

/**
 * A specification that `assertWellFormed` accepted: every label a path condition
 * names is in scope, no match declares a label already in scope or one reserved
 * for the split, and the projection names only labels the specification declares. Only that function
 * makes one, so a function that takes one relies on those properties and does
 * not check them.
 */
export type WellFormedSpecification = Specification & { readonly [wellFormed]: true };

export const emptySpecification: Specification = {
    given: [],
    matches: [],
    projection: { type: "composite", components: [] }
};

export function getAllFactTypes(specification: Specification): string[] {
    const factTypes: string[] = [];
    for (const given of specification.given) {
        factTypes.push(given.label.type);
        // Add fact types from existential conditions on givens
        for (const condition of given.conditions) {
            factTypes.push(...getAllFactTypesFromMatches(condition.matches));
        }
    }
    factTypes.push(...getAllFactTypesFromMatches(specification.matches));
    if (specification.projection.type === "composite") {
        factTypes.push(...getAllFactTypesFromProjection(specification.projection));
    }
    const distinctFactTypes = Array.from(new Set(factTypes));
    return distinctFactTypes;
}

function getAllFactTypesFromMatches(matches: Match[]): string[] {
    const factTypes: string[] = [];
    for (const match of matches) {
        factTypes.push(match.unknown.type);
        for (const condition of match.conditions) {
            if (condition.type === "path") {
                for (const role of condition.rolesLeft) {
                    factTypes.push(role.predecessorType);
                }
            }
            else if (condition.type === "existential") {
                factTypes.push(...getAllFactTypesFromMatches(condition.matches));
            }
        }
    }
    return factTypes;
}

function getAllFactTypesFromProjection(projection: CompositeProjection) {
    const factTypes: string[] = [];
    for (const component of projection.components) {
        if (component.type === "specification") {
            factTypes.push(...getAllFactTypesFromMatches(component.matches));
            if (component.projection.type === "composite") {
                factTypes.push(...getAllFactTypesFromProjection(component.projection));
            }
        }
    }
    return factTypes;
}

interface RoleDescription {
    successorType: string;
    name: string;
    predecessorType: string;
}

type TypeByLabel = {
    [label: string]: string;
};

export function getAllRoles(specification: Specification): RoleDescription[] {
    const labels = specification.given
        .reduce((labels, given) => ({
            ...labels,
            [given.label.name]: given.label.type
        }),
        {} as TypeByLabel);

    let rolesFromGivenConditions: RoleDescription[] = [];
    for (const given of specification.given) {
        for (const condition of given.conditions) {
            const { roles } = getAllRolesFromMatches(labels, condition.matches);
            rolesFromGivenConditions.push(...roles);
        }
    }

    const { roles: rolesFromMatches, labels: labelsFromMatches } = getAllRolesFromMatches(labels, specification.matches);
    const components = specification.projection.type === "composite" ? specification.projection.components : [];
    const rolesFromComponents = getAllRolesFromComponents(labelsFromMatches, components);
    const roles: RoleDescription[] = [ ...rolesFromGivenConditions, ...rolesFromMatches, ...rolesFromComponents ];
    const distinctRoles = roles.filter((value, index, array) => {
        return array.findIndex(r =>
            r.successorType === value.successorType &&
            r.name === value.name) === index;
    });
    return distinctRoles;
}

function getAllRolesFromMatches(labels: TypeByLabel, matches: Match[]): { roles: RoleDescription[], labels: TypeByLabel } {
    const roles: RoleDescription[] = [];
    for (const match of matches) {
        labels = {
            ...labels,
            [match.unknown.name]: match.unknown.type
        };
        for (const condition of match.conditions) {
            if (condition.type === "path") {
                let type = match.unknown.type;
                for (const role of condition.rolesLeft) {
                    roles.push({ successorType: type, name: role.name, predecessorType: role.predecessorType });
                    type = role.predecessorType;
                }
                type = labels[condition.labelRight];
                if (!type) {
                    throw new Error(`Label ${condition.labelRight} not found`);
                }
                for (const role of condition.rolesRight) {
                    roles.push({ successorType: type, name: role.name, predecessorType: role.predecessorType });
                    type = role.predecessorType;
                }
            }
            else if (condition.type === "existential") {
                const { roles: newRoleDescriptions } = getAllRolesFromMatches(labels, condition.matches);
                roles.push(...newRoleDescriptions);
            }
        }
    }
    return { roles, labels };
}

function getAllRolesFromComponents(labels: TypeByLabel, components: ComponentProjection[]): RoleDescription[] {
    const roles: RoleDescription[] = [];
    for (const component of components) {
        if (component.type === "specification") {
            const { roles: rolesFromMatches, labels: labelsFromMatches } = getAllRolesFromMatches(labels, component.matches);
            roles.push(...rolesFromMatches);
            if (component.projection.type === "composite") {
                roles.push(...getAllRolesFromComponents(labelsFromMatches, component.projection.components));
            }
        }
    }
    return roles;
}

export function matchIsDeterministic(match: Match): boolean {
    return match.conditions.every(condition =>
        condition.type === "path" &&
        condition.rolesLeft.length === 0
    );
}

export function specificationIsDeterministic(specification: Specification): boolean {
    return specification.matches.every(matchIsDeterministic);
}

export function specificationIsNotDeterministic(specification: Specification): boolean {
    return specification.matches.some(match => !matchIsDeterministic(match));
}

export function splitBeforeFirstSuccessor(specification: WellFormedSpecification): { head: Specification, tail: Specification | undefined } {
    // Find the first match (if any) that the graph cannot run: one that seeks
    // successors or has an existential condition.
    const pivotIndex = specification.matches.findIndex(match => !matchIsDeterministic(match));
    if (pivotIndex === -1) {
        // No match seeks successors, so the whole specification is the head.
        return { head: specification, tail: undefined };
    }

    // The head runs the matches before the pivot. It also walks, on the tail's
    // behalf, every predecessor path that the tail takes from a label in scope
    // at the pivot: a given, or an unknown of a match before it. Each such walk
    // becomes a head match binding a split label, and the tail joins to that
    // label instead. The walk may sit in the pivot, in a later match, or in an
    // existential condition at any depth, but not beneath a negative
    // existential condition. There the tail would test the facts the walk
    // reaches one at a time, and a solution that one of them excludes would
    // still be admitted by another. See `hoist` and `hoist_correct` in
    // https://github.com/jinaga/jinaga-spec.
    const before = specification.matches.slice(0, pivotIndex);
    const scope = specification.given.map(given => given.label.name).concat(before.map(match => match.unknown.name));
    const hoisted: Match[] = [];
    const tailMatches = hoistMatches(specification.matches.slice(pivotIndex), true, scope, hoisted);
    const headMatches = before.concat(hoisted);

    // The tail is given the labels in scope at the pivot that it uses,
    // and the head projects them.
    const inScope: SpecificationGiven[] = specification.given.concat(headMatches.map(match => ({ label: match.unknown, conditions: [] })));
    const tailGiven = referencedLabels(tailMatches, inScope, specification.projection);
    return {
        head: {
            given: specification.given,
            matches: headMatches,
            projection: {
                type: "composite",
                components: tailGiven.map(given => ({ type: "fact", name: given.label.name, label: given.label.name }))
            }
        },
        tail: { given: tailGiven, matches: tailMatches, projection: specification.projection }
    };
}

// Rewrite the matches for the tail, moving each predecessor walk that the head
// can take into `hoisted`. `positive` is false beneath a negative existential
// condition, and stays false however many conditions are nested inside it.
function hoistMatches(matches: Match[], positive: boolean, scope: string[], hoisted: Match[]): Match[] {
    return matches.map(match => ({
        unknown: match.unknown,
        conditions: match.conditions.map(condition => hoistCondition(condition, positive, scope, hoisted))
    }));
}

function hoistCondition(condition: Condition, positive: boolean, scope: string[], hoisted: Match[]): Condition {
    if (condition.type === "existential") {
        return { type: "existential", exists: condition.exists, matches: hoistMatches(condition.matches, positive && condition.exists, scope, hoisted) };
    }
    if (!positive || condition.rolesRight.length === 0 || !scope.includes(condition.labelRight)) {
        return condition;
    }
    const label = splitLabel(hoisted.length);
    hoisted.push({
        unknown: { name: label, type: condition.rolesRight[condition.rolesRight.length - 1].predecessorType },
        conditions: [{ type: "path", labelRight: condition.labelRight, rolesLeft: [], rolesRight: condition.rolesRight }]
    });
    return { type: "path", labelRight: label, rolesLeft: condition.rolesLeft, rolesRight: [] };
}

/**
 * The label the split gives the fact that the head walks to for the `index`th
 * predecessor walk it takes on the tail's behalf. It begins with the reserved
 * prefix, so it cannot collide with a label a well-formed specification declares.
 */
function splitLabel(index: number): string {
    return `${reservedLabelPrefix}s${index}`;
}

export const reservedLabelPrefix = "__";

// The labels, in scope order, that the matches and the projection use. A nested
// specification's own labels are included, which is harmless: `labels` holds
// only labels declared outside it, and a well-formed specification does not
// declare the same label twice.
function referencedLabels(matches: Match[], labels: SpecificationGiven[], projection: Projection): SpecificationGiven[] {
    const used = matches.flatMap(labelsInMatch).concat(labelsInProjection(projection));
    return labels.filter(given => used.includes(given.label.name));
}

function labelsInMatch(match: Match): string[] {
    return match.conditions.flatMap(labelsInCondition);
}

function labelsInCondition(condition: Condition): string[] {
    return condition.type === "path" ? [condition.labelRight] : condition.matches.flatMap(labelsInMatch);
}

function labelsInProjection(projection: Projection | ComponentProjection): string[] {
    if (projection.type === "composite") {
        return projection.components.flatMap(labelsInProjection);
    }
    else if (projection.type === "specification") {
        return projection.matches.flatMap(labelsInMatch).concat(labelsInProjection(projection.projection));
    }
    else {
        // Fact, field, hash and time projections each name a single label.
        return [ projection.label ];
    }
}

export function specificationIsIdentity(specification: Specification) {
    return specification.matches.every(match =>
        match.conditions.every(condition =>
            condition.type === "path" &&
            condition.rolesLeft.length === 0 &&
            condition.rolesRight.length === 0
        )
    );
}

export function reduceSpecification(specification: Specification): Specification {
    // Remove all projections except for specification projections.
    return {
        given: specification.given,
        matches: specification.matches,
        projection: reduceProjection(specification.projection)
    };
}

function reduceProjection(projection: Projection): Projection {
    if (projection.type === "composite") {
        const reducedComponents = projection.components
            .map(reduceComponent)
            .filter((component): component is NamedComponentProjection => component !== null);
        return {
            type: "composite",
            components: reducedComponents
        };
    }
    else {
        return {
            type: "composite",
            components: []
        };
    }
}

function reduceComponent(component: NamedComponentProjection): NamedComponentProjection | null {
    if (component.type === "specification") {
        return {
            type: "specification",
            name: component.name,
            matches: component.matches,
            projection: reduceProjection(component.projection)
        };
    }
    else {
        return null;
    }
}
