export interface Label {
    name: string;
    type: string;
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

export interface SpecificationProjection {
    type: "specification",
    name: string,
    matches: Match[],
    childProjections: ChildProjections
}

export interface FieldProjection {
    type: "field",
    name: string,
    label: string,
    field: string
}

export interface HashProjection {
    type: "hash",
    name: string,
    label: string
}

export interface FactProjection {
    type: "fact",
    name: string,
    label: string
}

export type ElementProjection = FieldProjection | HashProjection | FactProjection;
export type Projection = SpecificationProjection | ElementProjection;

export interface SingularFieldProjection {
    type: "field",
    label: string;
    field: string;
}

export interface SingularFactProjection {
    type: "fact",
    label: string;
}

export type ChildProjections = Projection[] | SingularFieldProjection | SingularFactProjection;

export type ResultProjection = ElementProjection[] | SingularFieldProjection;

export interface Match {
    unknown: Label;
    conditions: Condition[];
}

export interface Specification {
    given: Label[];
    matches: Match[];
    childProjections: ChildProjections;
}

export function getAllFactTypes(specification: Specification): string[] {
    const factTypes: string[] = [];
    for (const given of specification.given) {
        factTypes.push(given.type);
    }
    factTypes.push(...getAllFactTypesFromMatches(specification.matches));
    if (Array.isArray(specification.childProjections)) {
        factTypes.push(...getAllFactTypesFromProjections(specification.childProjections));
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

function getAllFactTypesFromProjections(projections: Projection[]) {
    const factTypes: string[] = [];
    for (const projection of projections) {
        if (projection.type === "specification") {
            factTypes.push(...getAllFactTypesFromMatches(projection.matches));
            if (Array.isArray(projection.childProjections)) {
                factTypes.push(...getAllFactTypesFromProjections(projection.childProjections));
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
        .reduce((labels, label) => ({
            ...labels,
            [label.name]: label.type
        }),
        {} as TypeByLabel);
    const { roles: rolesFromMatches, labels: labelsFromMatches } = getAllRolesFromMatches(labels, specification.matches);
    const projections = Array.isArray(specification.childProjections) ? specification.childProjections : [];
    const rolesFromProjections = getAllRolesFromProjections(labelsFromMatches, projections);
    const roles: RoleDescription[] = [ ...rolesFromMatches, ...rolesFromProjections ];
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

function getAllRolesFromProjections(labels: TypeByLabel, projections: Projection[]): RoleDescription[] {
    const roles: RoleDescription[] = [];
    for (const projection of projections) {
        if (projection.type === "specification") {
            const { roles: rolesFromMatches, labels: labelsFromMatches } = getAllRolesFromMatches(labels, projection.matches);
            roles.push(...rolesFromMatches);
            if (Array.isArray(projection.childProjections)) {
                roles.push(...getAllRolesFromProjections(labelsFromMatches, projection.childProjections));
            }
        }
    }
    return roles;
}
