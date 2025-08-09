import { Specification, Match, Projection, DisconnectedSpecificationError } from "./specification";

/**
 * Union-Find (Disjoint Set) data structure for efficiently managing
 * connected components of labels in a specification graph.
 *
 * This is an alternative to the graph + DFS approach that uses the equivalence
 * relation property of connected graphs. Instead of maintaining explicit
 * connections, we maintain discrete sets of connected labels and join them
 * when connections are added.
 */
class UnionFind {
    private parent: Map<string, string>;
    private rank: Map<string, number>;

    constructor() {
        this.parent = new Map();
        this.rank = new Map();
    }

    /**
     * Ensure a label exists in the data structure.
     * If it doesn't exist, initialize it as its own set.
     */
    ensureLabel(label: string): void {
        if (!this.parent.has(label)) {
            this.parent.set(label, label);
            this.rank.set(label, 0);
        }
    }

    /**
     * Find the root of the set containing the given label.
     * Uses path compression for optimization.
     */
    find(label: string): string {
        const parent = this.parent.get(label);
        if (!parent) {
            throw new Error(`Label ${label} not found in UnionFind`);
        }

        if (parent !== label) {
            // Path compression: make all nodes on the path point directly to the root
            this.parent.set(label, this.find(parent));
        }

        return this.parent.get(label)!;
    }

    /**
     * Union two sets containing the given labels.
     * Uses union by rank for optimization.
     */
    union(label1: string, label2: string): void {
        this.ensureLabel(label1);
        this.ensureLabel(label2);

        const root1 = this.find(label1);
        const root2 = this.find(label2);

        if (root1 === root2) {
            return; // Already in the same set
        }

        const rank1 = this.rank.get(root1)!;
        const rank2 = this.rank.get(root2)!;

        // Union by rank: attach smaller tree under root of larger tree
        if (rank1 < rank2) {
            this.parent.set(root1, root2);
        } else if (rank1 > rank2) {
            this.parent.set(root2, root1);
        } else {
            this.parent.set(root2, root1);
            this.rank.set(root1, rank1 + 1);
        }
    }

    /**
     * Get all connected components as separate arrays of labels.
     */
    getConnectedComponents(): string[][] {
        const components = new Map<string, string[]>();

        for (const label of this.parent.keys()) {
            const root = this.find(label);
            if (!components.has(root)) {
                components.set(root, []);
            }
            components.get(root)!.push(label);
        }

        return Array.from(components.values());
    }
}
/**
 * Add all bidirectional connections from the specification to the UnionFind structure.
 * Also collects all labels encountered during traversal.
 */
function addConnectionsToUnionFind(specification: Specification, unionFind: UnionFind, allLabels: Set<string>, labelTypes: Map<string, string>): void {
    // Add connections from path conditions in matches
    for (const match of specification.matches) {
        addConnectionsFromMatchToUnionFind(unionFind, match, allLabels, labelTypes);
    }

    // Add connections from nested specification projections
    addConnectionsFromSpecificationProjectionsToUnionFind(unionFind, specification.projection, allLabels, labelTypes);
}
function addConnectionsFromMatchToUnionFind(unionFind: UnionFind, match: Match, allLabels: Set<string>, labelTypes: Map<string, string>): void {
    const unknownLabel = match.unknown.name;
    allLabels.add(unknownLabel);
    labelTypes.set(unknownLabel, match.unknown.type);

    for (const condition of match.conditions) {
        if (condition.type === "path") {
            // Connect unknown to the label on the right side of the path
            const rightLabel = condition.labelRight;
            allLabels.add(rightLabel);
            // Note: We don't know the type of rightLabel here, it should have been added elsewhere
            unionFind.union(unknownLabel, rightLabel);
        } else if (condition.type === "existential") {
            // Process nested matches in existential conditions
            for (const nestedMatch of condition.matches) {
                addConnectionsFromMatchToUnionFind(unionFind, nestedMatch, allLabels, labelTypes);
                // Connect the parent unknown to labels referenced in existential conditions
                const nestedConnections = getLabelsReferencedInMatch(nestedMatch);
                for (const connectedLabel of nestedConnections) {
                    allLabels.add(connectedLabel);
                    unionFind.union(unknownLabel, connectedLabel);
                }
            }
        }
    }
}
function addConnectionsFromSpecificationProjectionsToUnionFind(unionFind: UnionFind, projection: Projection, allLabels: Set<string>, labelTypes: Map<string, string>): void {
    if (projection.type === "composite") {
        for (const component of projection.components) {
            if (component.type === "specification") {
                // Process nested specification projections - these contain matches
                for (const match of component.matches) {
                    addConnectionsFromMatchToUnionFind(unionFind, match, allLabels, labelTypes);
                }
                // Recursively process nested projections
                addConnectionsFromSpecificationProjectionsToUnionFind(unionFind, component.projection, allLabels, labelTypes);
            }
            // Field, hash, and fact components reference labels but don't create connections
        }
    }
    // Single projections (field, fact, hash) don't create connections
}

export function detectDisconnectedSpecification(specification: Specification): void {
    // Collect all labels while building connections
    const allLabels = new Set<string>();
    const labelTypes = new Map<string, string>();

    // Add given labels
    for (const given of specification.given) {
        allLabels.add(given.name);
        labelTypes.set(given.name, given.type);
    }

    // Build connections and collect labels in one pass
    const unionFind = new UnionFind();
    addConnectionsToUnionFind(specification, unionFind, allLabels, labelTypes);

    // Ensure all labels are in the UnionFind (including isolated ones)
    for (const label of allLabels) {
        unionFind.ensureLabel(label);
    }

    if (allLabels.size <= 1) {
        // Single label or empty specification cannot be disconnected
        return;
    }

    const connectedComponents = unionFind.getConnectedComponents();

    if (connectedComponents.length > 1) {
        const componentDescriptions = connectedComponents.map((component: string[], index: number) => {
            const labelDescriptions = component.map((label: string) => {
                const type = labelTypes.get(label) || 'unknown';
                return `'${label}:${type}'`;
            }).join(", ");
            return `Subgraph ${index + 1}: [${labelDescriptions}]`;
        }).join("; ");

        throw new DisconnectedSpecificationError(
            `Disconnected specification detected. The specification contains ${connectedComponents.length} ` +
            `disconnected subgraphs: ${componentDescriptions}. ` +
            `All labels must be connected through path conditions, existential conditions, or projections.`
        );
    }
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
