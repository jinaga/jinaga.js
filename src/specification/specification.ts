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