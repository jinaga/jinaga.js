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
    given: Label[];
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
        .reduce((labels, label) => ({
            ...labels,
            [label.name]: label.type
        }),
        {} as TypeByLabel);
    const { roles: rolesFromMatches, labels: labelsFromMatches } = getAllRolesFromMatches(labels, specification.matches);
    const components = specification.projection.type === "composite" ? specification.projection.components : [];
    const rolesFromComponents = getAllRolesFromComponents(labelsFromMatches, components);
    const roles: RoleDescription[] = [ ...rolesFromMatches, ...rolesFromComponents ];
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
                const allLabels = specification.given.concat(specification.matches.map(match => match.unknown));
                const tailGiven = referencedLabels(tailMatches, allLabels);

                // Project the tail givens
                const headProjection: Projection = tailGiven.length === 1 ?
                    <FactProjection>{ type: "fact", label: tailGiven[0].name } :
                    <CompositeProjection>{ type: "composite", components: tailGiven.map(label => (
                        <FactProjection>{ type: "fact", label: label.name })) };
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
            const allLabels = specification.given
                .concat(specification.matches.map(match => match.unknown))
                .concat([ splitLabel ]);
            const tailGiven = referencedLabels(tailMatches, allLabels);

            // Project the tail givens
            const headProjection: Projection = tailGiven.length === 1 ?
                <FactProjection>{ type: "fact", label: tailGiven[0].name } :
                <CompositeProjection>{ type: "composite", components: tailGiven.map(label => (
                    <FactProjection>{ type: "fact", label: label.name })) };
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

function referencedLabels(matches: Match[], labels: Label[]): Label[] {
    // Find all labels referenced in the matches
    const definedLabels = matches.map(match => match.unknown.name);
    const referencedLabels = matches.flatMap(labelsInMatch)
        .filter(label => definedLabels.indexOf(label) === -1);
    return labels.filter(label => referencedLabels.indexOf(label.name) !== -1);
}

function labelsInMatch(match: Match): string[] {
    return match.conditions.flatMap(labelsInCondition);
}

function labelsInCondition(condition: Condition): string[] {
    if (condition.type === "path") {
        return [ condition.labelRight ];
    }
    else if (condition.type === "existential") {
        return condition.matches.flatMap(labelsInMatch);
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

export class DisconnectedSpecificationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DisconnectedSpecificationError";
    }
}

export function detectDisconnectedSpecification(specification: Specification): void {
    const allLabels = getAllLabels(specification);
    if (allLabels.length <= 1) {
        // Single label or empty specification cannot be disconnected
        return;
    }

    const graph = buildLabelConnectionGraph(specification, allLabels);
    const connectedComponents = findConnectedComponents(graph, allLabels);
    
    if (connectedComponents.length > 1) {
        const componentDescriptions = connectedComponents.map((component, index) => {
            const labelNames = component.map(label => `'${label}'`).join(", ");
            return `Subgraph ${index + 1}: [${labelNames}]`;
        }).join("; ");
        
        throw new DisconnectedSpecificationError(
            `Disconnected specification detected. The specification contains ${connectedComponents.length} ` +
            `disconnected subgraphs: ${componentDescriptions}. ` +
            `All labels must be connected through path conditions, existential conditions, or projections.`
        );
    }
}

function getAllLabels(specification: Specification): string[] {
    const labelNames = new Set<string>();
    
    // Add given labels
    for (const given of specification.given) {
        labelNames.add(given.name);
    }
    
    // Add unknown labels from matches
    for (const match of specification.matches) {
        labelNames.add(match.unknown.name);
    }
    
    // Add unknown labels from nested specification projections
    addLabelsFromProjection(labelNames, specification.projection);
    
    return Array.from(labelNames);
}

function addLabelsFromProjection(labelNames: Set<string>, projection: Projection): void {
    if (projection.type === "composite") {
        for (const component of projection.components) {
            if (component.type === "specification") {
                // Add unknown labels from nested specification projections
                for (const match of component.matches) {
                    labelNames.add(match.unknown.name);
                    // Also process any nested existential conditions
                    addLabelsFromMatches(labelNames, [match]);
                }
                // Recursively process nested projections
                addLabelsFromProjection(labelNames, component.projection);
            }
        }
    }
}

function addLabelsFromMatches(labelNames: Set<string>, matches: Match[]): void {
    for (const match of matches) {
        for (const condition of match.conditions) {
            if (condition.type === "existential") {
                for (const nestedMatch of condition.matches) {
                    labelNames.add(nestedMatch.unknown.name);
                }
                addLabelsFromMatches(labelNames, condition.matches);
            }
        }
    }
}

function buildLabelConnectionGraph(specification: Specification, allLabels: string[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    
    // Initialize graph with all labels
    for (const label of allLabels) {
        graph.set(label, new Set<string>());
    }
    
    // Add connections from path conditions in matches
    for (const match of specification.matches) {
        addConnectionsFromMatch(graph, match);
    }
    
    // Add connections from nested specification projections
    // Note: Regular projections (field, fact, hash) do NOT create connections.
    // However, specification projections contain matches that can create connections.
    addConnectionsFromSpecificationProjections(graph, specification.projection);
    
    return graph;
}

function addConnectionsFromMatch(graph: Map<string, Set<string>>, match: Match): void {
    const unknownLabel = match.unknown.name;
    
    for (const condition of match.conditions) {
        if (condition.type === "path") {
            // Connect unknown to the label on the right side of the path
            const rightLabel = condition.labelRight;
            addBidirectionalConnection(graph, unknownLabel, rightLabel);
        } else if (condition.type === "existential") {
            // Process nested matches in existential conditions
            for (const nestedMatch of condition.matches) {
                addConnectionsFromMatch(graph, nestedMatch);
                // Connect the parent unknown to labels referenced in existential conditions
                const nestedConnections = getLabelsReferencedInMatch(nestedMatch);
                for (const connectedLabel of nestedConnections) {
                    addBidirectionalConnection(graph, unknownLabel, connectedLabel);
                }
            }
        }
    }
}

function addConnectionsFromSpecificationProjections(graph: Map<string, Set<string>>, projection: Projection): void {
    if (projection.type === "composite") {
        for (const component of projection.components) {
            if (component.type === "specification") {
                // Process nested specification projections - these contain matches
                for (const match of component.matches) {
                    addConnectionsFromMatch(graph, match);
                }
                // Recursively process nested projections
                addConnectionsFromSpecificationProjections(graph, component.projection);
            }
            // Field, hash, and fact components reference labels but don't create connections
        }
    }
    // Single projections (field, fact, hash) don't create connections
}

function getLabelsReferencedInMatch(match: Match): string[] {
    const referencedLabels = new Set<string>();
    
    for (const condition of match.conditions) {
        if (condition.type === "path") {
            referencedLabels.add(condition.labelRight);
        } else if (condition.type === "existential") {
            for (const nestedMatch of condition.matches) {
                const nestedLabels = getLabelsReferencedInMatch(nestedMatch);
                for (const label of nestedLabels) {
                    referencedLabels.add(label);
                }
            }
        }
    }
    
    return Array.from(referencedLabels);
}

function addBidirectionalConnection(graph: Map<string, Set<string>>, label1: string, label2: string): void {
    const connections1 = graph.get(label1);
    const connections2 = graph.get(label2);
    
    if (connections1 && connections2) {
        connections1.add(label2);
        connections2.add(label1);
    }
}

function findConnectedComponents(graph: Map<string, Set<string>>, allLabels: string[]): string[][] {
    const visited = new Set<string>();
    const components: string[][] = [];
    
    for (const label of allLabels) {
        if (!visited.has(label)) {
            const component = dfsTraversal(graph, label, visited);
            components.push(component);
        }
    }
    
    return components;
}

function dfsTraversal(graph: Map<string, Set<string>>, startLabel: string, visited: Set<string>): string[] {
    const component: string[] = [];
    const stack: string[] = [startLabel];
    
    while (stack.length > 0) {
        const currentLabel = stack.pop()!;
        
        if (!visited.has(currentLabel)) {
            visited.add(currentLabel);
            component.push(currentLabel);
            
            const connections = graph.get(currentLabel);
            if (connections) {
                for (const connectedLabel of connections) {
                    if (!visited.has(connectedLabel)) {
                        stack.push(connectedLabel);
                    }
                }
            }
        }
    }
    
    return component;
}