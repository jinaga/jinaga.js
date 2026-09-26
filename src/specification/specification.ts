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

export function splitBeforeFirstSuccessor(specification: Specification): { head: Specification | undefined, tail: Specification | undefined } {
    // Find the first match (if any) that the graph cannot run: one that seeks
    // successors or has an existential condition.
    const firstMatchWithSuccessor = specification.matches.findIndex(match => !matchIsDeterministic(match));

    if (firstMatchWithSuccessor === -1) {
        // No match seeks successors, so the whole specification is deterministic
        return {
            head: specification,
            tail: undefined
        };
    }

    // Split the pivot -- the first match the graph cannot run -- condition by
    // condition. Each of its path conditions walks predecessors of a label the
    // head can reach, and then successors that only the store can follow. The
    // predecessor walk becomes a head match binding a split label, and the
    // condition is rewritten in the tail to join to that label instead.
    const pivot = specification.matches[firstMatchWithSuccessor];
    const pathConditions = pivot.conditions.filter(isPathCondition);
    const existentialConditions = pivot.conditions.filter(isExistentialCondition);
    const splitLabelNames = allocateLabels(specification, pathConditions.filter(
        condition => condition.rolesRight.length > 0).length);

    const splitMatches: Match[] = [];
    const tailConditions: Condition[] = [];
    for (const condition of pathConditions) {
        if (condition.rolesRight.length === 0) {
            // The condition walks no predecessors, so the label it joins to is
            // already one the head binds. The tail joins to it directly.
            tailConditions.push(condition);
            continue;
        }
        const splitLabel: Label = {
            name: splitLabelNames[splitMatches.length],
            type: condition.rolesRight[condition.rolesRight.length - 1].predecessorType
        };
        splitMatches.push({
            unknown: splitLabel,
            conditions: [
                <PathCondition>{
                    type: "path",
                    labelRight: condition.labelRight,
                    rolesLeft: [],
                    rolesRight: condition.rolesRight
                }
            ]
        });
        tailConditions.push(<PathCondition>{
            type: "path",
            labelRight: splitLabel.name,
            rolesLeft: condition.rolesLeft,
            rolesRight: []
        });
    }

    const headMatches = specification.matches.slice(0, firstMatchWithSuccessor).concat(splitMatches);
    if (headMatches.length === 0) {
        // Nothing precedes the pivot and none of its conditions walks a
        // predecessor, so there is nothing for the graph to run.
        return {
            head: undefined,
            tail: specification
        };
    }

    // Assemble the tail matches. Existential conditions stay with the pivot,
    // which the tail runs. A valid match begins with a path condition, so
    // collecting the paths first preserves the order the pivot declared.
    const tailMatch: Match = {
        unknown: pivot.unknown,
        conditions: [...tailConditions, ...existentialConditions]
    };
    const tailMatches = [tailMatch].concat(specification.matches.slice(firstMatchWithSuccessor + 1));

    // Compute the givens of the tail.
    // They are the labels that the tail uses but does not define,
    // including the labels of its projection.
    const unknownAsGiven: SpecificationGiven[] = specification.matches.map(match => ({
        label: { name: match.unknown.name, type: match.unknown.type },
        conditions: []
    }));
    const allLabels: SpecificationGiven[] = specification.given
        .concat(unknownAsGiven)
        .concat(splitMatches.map(match => ({
            label: { name: match.unknown.name, type: match.unknown.type },
            conditions: []
        })));
    const tailGiven = referencedLabels(tailMatches, allLabels, specification.projection);

    // Project the tail givens
    const headProjection: Projection = projectLabels(tailGiven);

    // Compute the givens of the head.
    // The head projects the tail's givens, so its own projection
    // takes part in the derivation.
    const headGiven = referencedLabels(headMatches, specification.given, headProjection);
    const head: Specification = {
        given: headGiven,
        matches: headMatches,
        projection: headProjection
    };
    const tail: Specification = {
        given: tailGiven,
        matches: tailMatches,
        projection: specification.projection
    };
    return {
        head,
        tail
    };
}

// Name the labels that the split introduces. Each must differ from the others
// and from every label already in the specification, so that the head and tail
// can both refer to it unambiguously.
function allocateLabels(specification: Specification, count: number): string[] {
    const taken = declaredLabels(specification);
    const names: string[] = [];
    let ordinal = 1;
    while (names.length < count) {
        const name = `s${ordinal}`;
        if (taken.indexOf(name) === -1) {
            names.push(name);
        }
        ordinal++;
    }
    return names;
}

function declaredLabels(specification: Specification): string[] {
    return specification.given.map(given => given.label.name)
        .concat(declaredLabelsInGivens(specification.given))
        .concat(declaredLabelsInMatches(specification.matches))
        .concat(declaredLabelsInProjection(specification.projection));
}

// A given can carry existential conditions of its own, and the matches within
// them declare labels in the same scope as the rest of the specification.
function declaredLabelsInGivens(given: SpecificationGiven[]): string[] {
    return given.map(g => declaredLabelsInMatches(
        g.conditions.map(condition => condition.matches)
            .reduce((acc, val) => acc.concat(val), [])))
        .reduce((acc, val) => acc.concat(val), []);
}

function declaredLabelsInMatches(matches: Match[]): string[] {
    return matches.map(match => [ match.unknown.name ].concat(
        match.conditions.map(condition => condition.type === "existential" ?
            declaredLabelsInMatches(condition.matches) : [])
            .reduce((acc, val) => acc.concat(val), [])))
        .reduce((acc, val) => acc.concat(val), []);
}

function declaredLabelsInProjection(projection: Projection | ComponentProjection): string[] {
    if (projection.type === "composite") {
        return projection.components.map(declaredLabelsInProjection)
            .reduce((acc, val) => acc.concat(val), []);
    }
    else if (projection.type === "specification") {
        return declaredLabelsInMatches(projection.matches)
            .concat(declaredLabelsInProjection(projection.projection));
    }
    else {
        return [];
    }
}

function projectLabels(given: SpecificationGiven[]): Projection {
    return given.length === 1 ?
        <FactProjection>{ type: "fact", label: given[0].label.name } :
        <CompositeProjection>{ type: "composite", components: given.map(g => (<NamedComponentProjection>{
            type: "fact",
            name: g.label.name,
            label: g.label.name
        })) };
}

function referencedLabels(matches: Match[], labels: SpecificationGiven[], projection?: Projection): SpecificationGiven[] {
    // Find all labels that the matches and the projection use but the matches do not define
    const free = freeLabels(matches, projection);
    return labels
        .filter(given => free.indexOf(given.label.name) !== -1);
}

function freeLabels(matches: Match[], projection: Projection | ComponentProjection | undefined): string[] {
    const definedLabels = matches.map(match => match.unknown.name);
    const usedLabels = matches.map(labelsInMatch).reduce((acc, val) => acc.concat(val), [])
        .concat(projection === undefined ? [] : labelsInProjection(projection));
    return usedLabels
        .filter(label => definedLabels.indexOf(label) === -1);
}

function labelsInMatch(match: Match): string[] {
    return match.conditions.map(labelsInCondition).reduce((acc, val) => acc.concat(val), []);
}

function labelsInProjection(projection: Projection | ComponentProjection): string[] {
    if (projection.type === "composite") {
        return projection.components.map(labelsInProjection).reduce((acc, val) => acc.concat(val), []);
    }
    else if (projection.type === "specification") {
        // A nested specification defines its own labels, so only its free labels escape.
        return freeLabels(projection.matches, projection.projection);
    }
    else {
        // Fact, field, hash and time projections each name a single label.
        return [ projection.label ];
    }
}

function labelsInCondition(condition: Condition): string[] {
    if (condition.type === "path") {
        return [ condition.labelRight ];
    }
    else if (condition.type === "existential") {
        return condition.matches.map(labelsInMatch).reduce((acc, val) => acc.concat(val), []);
    }
    else {
        const _exhaustiveCheck: never = condition;
        throw new Error(`Unexpected condition type ${(_exhaustiveCheck as any).type}`);
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
