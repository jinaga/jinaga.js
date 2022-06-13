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

export interface Projection {
    name: string,
    matches: Match[],
    projections: Projection[]
}

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
    for (const match of specification.matches) {
        factTypes.push(match.unknown.type);
        for (const condition of match.conditions) {
            if (condition.type === "path") {
                for (const role of condition.rolesLeft) {
                    factTypes.push(role.targetType);
                }
            }
        }
    }
    const distinctFactTypes = Array.from(new Set(factTypes));
    return distinctFactTypes;
}

export function getAllRoles(specification: Specification): { definingFactType: string, name: string, targetType: string }[] {
    const roles: { definingFactType: string, name: string, targetType: string }[] = [];
    for (const match of specification.matches) {
        for (const condition of match.conditions) {
            if (condition.type === "path") {
                let type = match.unknown.type;
                for (const role of condition.rolesLeft) {
                    roles.push({ definingFactType: type, name: role.name, targetType: role.targetType });
                    type = role.targetType;
                }
                type = getTypeOfLabel(specification, condition.labelRight);
                for (const role of condition.rolesRight) {
                    roles.push({ definingFactType: type, name: role.name, targetType: role.targetType });
                    type = role.targetType;
                }
            }
        }
    }
    const distinctRoles = roles.filter((value, index, array) => {
        return array.findIndex(r =>
            r.definingFactType === value.definingFactType &&
            r.name === value.name) === index;
    });
    return distinctRoles;
}

function getTypeOfLabel(specification: Specification, label: string): string {
    const given = specification.given.find(l => l.name === label);
    if (given) {
        return given.type;
    }
    const unknown = specification.matches.find(m => m.unknown.name === label);
    if (unknown) {
        return unknown.unknown.type;
    }
    throw new Error(`Label ${label} not found in specification`);
}

export function describeSpecification(specification: Specification): string {
    return `Given: ${specification.given.map(l => `${l.name}: ${l.type}`).join(", ")}
Matches: ${specification.matches.map(m => `${m.unknown.name}: ${m.unknown.type}`).join(", ")}
Projections: ${specification.projections.map(p => `${p.name} (${p.matches.map(m => `${m.unknown.name} (${m.unknown.type})`).join(", ")})`).join(", ")}`;
}
