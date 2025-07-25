export interface Label {
    name: string;
    type: string;
}

export interface Given extends Label {
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
export type SingularProjection = FieldProjection | HashProjection | FactProjection;
export type Projection = CompositeProjection | SingularProjection;

export interface Match {
    unknown: Label;
    conditions: Condition[];
}

export interface Specification {
    given: Given[];
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
        factTypes.push(given.type);
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
            [given.name]: given.type
        }),
        {} as TypeByLabel);
    
    // Collect roles from existential conditions on givens
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

export function specificationIsDeterministic(specification: Specification): boolean {
    return specification.matches.every(match =>
        match.conditions.every(condition =>
            condition.type === "path" &&
            condition.rolesLeft.length === 0
        )
    );
}

export function specificationIsNotDeterministic(specification: Specification): boolean {
    return specification.matches.some(match =>
        match.conditions.some(condition =>
            condition.type === "path" &&
            condition.rolesLeft.length > 0
        )
    );
}

export function splitBeforeFirstSuccessor(specification: Specification): { head: Specification | undefined, tail: Specification | undefined } {
    // Find the first match (if any) that seeks successors or has an existential condition
    const firstMatchWithSuccessor = specification.matches.findIndex(match =>
        match.conditions.length !== 1 || match.conditions.some(condition =>
            condition.type !== "path" || condition.rolesLeft.length > 0));

    if (firstMatchWithSuccessor === -1) {
        // No match seeks successors, so the whole specification is deterministic
        return {
            head: specification,
            tail: undefined
        };
    }
    else {
        // If there is only a single path condition, then split that path.
        const pivot = specification.matches[firstMatchWithSuccessor];
        const pathConditions = pivot.conditions.filter(isPathCondition);
        if (pathConditions.length !== 1) {
            // Fall back to running the entire specification in the tail
            return {
                head: undefined,
                tail: specification
            };
        }

        const existentialConditions = pivot.conditions.filter(isExistentialCondition);
        const condition = pathConditions[0];

        if (condition.rolesRight.length === 0) {
            // The path contains only successor joins.
            // Put the entire match in the tail.
            if (firstMatchWithSuccessor === 0) {
                // There is nothing to put in the head
                return {
                    head: undefined,
                    tail: specification
                };
            }
            else {
                // Split the matches between the head and tail
                const headMatches = specification.matches.slice(0, firstMatchWithSuccessor);
                const tailMatches = specification.matches.slice(firstMatchWithSuccessor);

                // Compute the givens of the head and tail
                const headGiven = referencedLabels(headMatches, specification.given);
                const unknownAsGiven: Given[] = specification.matches.map(match => ({ 
                    name: match.unknown.name, 
                    type: match.unknown.type, 
                    conditions: [] 
                }));
                const allLabels: (Label | Given)[] = specification.given.concat(unknownAsGiven);
                const tailGiven = referencedLabels(tailMatches, allLabels);

                // Project the tail givens
                const headProjection: Projection = tailGiven.length === 1 ?
                    <FactProjection>{ type: "fact", label: tailGiven[0].name } :
                    <CompositeProjection>{ type: "composite", components: tailGiven.map(label => (<NamedComponentProjection>{
                        type: "fact", 
                        name: label.name,
                        label: label.name 
                    })) };
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
        }
        else {
            // The path contains both predecessor and successor joins.
            // Split the path into two paths.
            const splitLabel: Label = {
                name: 's1',
                type: condition.rolesRight[condition.rolesRight.length - 1].predecessorType
            };
            const headCondition: Condition = {
                type: "path",
                labelRight: condition.labelRight,
                rolesLeft: [],
                rolesRight: condition.rolesRight
            };
            const headMatch: Match = {
                unknown: splitLabel,
                conditions: [headCondition]
            }
            const tailCondition: Condition = {
                type: "path",
                labelRight: splitLabel.name,
                rolesLeft: condition.rolesLeft,
                rolesRight: []
            };
            const tailMatch: Match = {
                unknown: pivot.unknown,
                conditions: [tailCondition, ...existentialConditions]
            };

            // Assemble the head and tail matches
            const headMatches = specification.matches.slice(0, firstMatchWithSuccessor).concat(headMatch);
            const tailMatches = [tailMatch].concat(specification.matches.slice(firstMatchWithSuccessor + 1));

            // Compute the givens of the head and tail
            const headGiven = referencedLabels(headMatches, specification.given);
            const unknownAsGiven: Given[] = specification.matches.map(match => ({ 
                name: match.unknown.name, 
                type: match.unknown.type, 
                conditions: [] 
            }));
            const allLabels: (Label | Given)[] = specification.given
                .concat(unknownAsGiven)
                .concat([ { name: splitLabel.name, type: splitLabel.type, conditions: [] } ]);
            const tailGiven = referencedLabels(tailMatches, allLabels);

            // Project the tail givens
            const headProjection: Projection = tailGiven.length === 1 ?
                <FactProjection>{ type: "fact", label: tailGiven[0].name } :
                <CompositeProjection>{ type: "composite", components: tailGiven.map(label => (<NamedComponentProjection>{
                    type: "fact", 
                    name: label.name,
                    label: label.name 
                })) };
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
    }
}

function referencedLabels(matches: Match[], labels: (Label | Given)[]): Given[] {
    // Find all labels referenced in the matches
    const definedLabels = matches.map(match => match.unknown.name);
    const referencedLabels = matches.map(labelsInMatch).reduce((acc, val) => acc.concat(val), [])
        .filter(label => definedLabels.indexOf(label) === -1);
    return labels
        .filter(label => referencedLabels.indexOf(label.name) !== -1)
        .map(label => {
            // Ensure we return Given objects
            if ('conditions' in label) {
                return label;
            } else {
                return { name: label.name, type: label.type, conditions: [] };
            }
        });
}

function labelsInMatch(match: Match): string[] {
    return match.conditions.map(labelsInCondition).reduce((acc, val) => acc.concat(val), []);
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