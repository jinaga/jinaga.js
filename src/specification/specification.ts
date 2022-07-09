export interface Label {
    name: string;
    type: string;
}

export interface Role {
    name: string;
    targetType: string;
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
    projections: Projection[]
}

export interface FieldProjection {
    type: "field",
    name: string,
    label: string,
    field: string
}

export type Projection = SpecificationProjection | FieldProjection;

export interface Match {
    unknown: Label;
    conditions: Condition[];
}

export interface Specification {
    given: Label[];
    matches: Match[];
    projections: Projection[];
}

export function getAllFactTypes(specification: Specification): string[] {
    const factTypes: string[] = [];
    for (const given of specification.given) {
        factTypes.push(given.type);
    }
    factTypes.push(...getAllFactTypesFromMatches(specification.matches));
    factTypes.push(...getAllFactTypesFromProjections(specification.projections));
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
                    factTypes.push(role.targetType);
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
            factTypes.push(...getAllFactTypesFromProjections(projection.projections));
        }
    }
    return factTypes;
}

interface RoleDescription {
    definingFactType: string;
    name: string;
    targetType: string;
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
    const rolesFromProjections = getAllRolesFromProjections(labelsFromMatches, specification.projections);
    const roles: RoleDescription[] = [ ...rolesFromMatches, ...rolesFromProjections ];
    const distinctRoles = roles.filter((value, index, array) => {
        return array.findIndex(r =>
            r.definingFactType === value.definingFactType &&
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
                    roles.push({ definingFactType: type, name: role.name, targetType: role.targetType });
                    type = role.targetType;
                }
                type = labels[condition.labelRight];
                if (!type) {
                    throw new Error(`Label ${condition.labelRight} not found`);
                }
                for (const role of condition.rolesRight) {
                    roles.push({ definingFactType: type, name: role.name, targetType: role.targetType });
                    type = role.targetType;
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
            roles.push(...getAllRolesFromProjections(labelsFromMatches, projection.projections));
        }
    }
    return roles;
}

export function describeSpecification(specification: Specification): string {
    return `Given: ${specification.given.map(l => `${l.name}: ${l.type}`).join(", ")}
Matches: ${specification.matches.map(m => `${m.unknown.name}: ${m.unknown.type}`).join(", ")}
Projections: ${specification.projections.map(p => p.name).join(", ")}`;
}
