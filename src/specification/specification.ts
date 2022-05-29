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

export type Condition = PathCondition;

export interface Projection {

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