import { Invalid } from "./invalid";
import { Match, Projection, Specification, SpecificationGiven } from "./specification";

export class DisconnectedSpecificationError extends Invalid {
    constructor(message: string) {
        super(message);
        this.name = "DisconnectedSpecificationError";
    }
}

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
function addConnectionsToUnionFind(specification: Specification, unionFind: UnionFind, allLabels: Set<string>, labelTypes: Map<string, string>, usedGivens: SpecificationGiven[]): void {
    // Conditions on givens (e.g., the existential introduced by
    // distribution-rule intersection) reference other labels and are part
    // of the connectivity graph. The inverter promotes given conditions to
    // match conditions, so connectedness must include them too.
    //
    // Only the givens the matches use are walked. A given no match uses is not
    // a label of this graph at all, so neither it nor the labels its own
    // conditions name belong here: those matches filter the one tuple the
    // given stands for, and yield no row of their own to take a product over.
    for (const given of usedGivens) {
        for (const condition of given.conditions) {
            for (const nestedMatch of condition.matches) {
                addConnectionsFromMatchToUnionFind(unionFind, nestedMatch, allLabels, labelTypes);
                const nestedConnections = getLabelsReferencedInMatch(nestedMatch);
                for (const connectedLabel of nestedConnections) {
                    allLabels.add(connectedLabel);
                    unionFind.union(given.label.name, connectedLabel);
                }
            }
        }
    }

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

    // Record every given's type, so that the refusal can name it if it turns
    // out to be a label of the graph.
    for (const given of specification.given) {
        labelTypes.set(given.label.name, given.label.type);
    }

    // Only the givens the matches use are labels of the graph. A given binds
    // one fact rather than a set of rows, so it is a parameter of the query and
    // never a factor of a product: a given no match uses is left out, and is
    // not a component of its own. This is what jinaga-spec's `asFeed` takes as
    // a feed's givens, and what its `isConnected` counts
    // (jinaga/jinaga-spec#60).
    const referencedLabels = labelsReferencedInSpecification(specification);
    const usedGivens = specification.given.filter(given =>
        referencedLabels.has(given.label.name));
    for (const given of usedGivens) {
        allLabels.add(given.label.name);
    }

    // Build connections and collect labels in one pass
    const unionFind = new UnionFind();
    addConnectionsToUnionFind(specification, unionFind, allLabels, labelTypes, usedGivens);

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
/**
 * The labels that a specification's matches name: the right-hand label of each
 * path condition, and every label an existential condition names, at any depth.
 * Every match of the specification counts, wherever it sits — a top-level
 * match, a match of a child specification in a projection, and a match of a
 * condition on a given.
 *
 * A given this set does not hold is one no match reads. A projection that names
 * a given does not put it here: projecting a given copies the one fact it binds
 * into every row, which joins nothing and multiplies nothing.
 *
 * A condition on a given does put it here, which is where this parts from
 * jinaga-spec's `usedGivens`: in jinaga-spec a given carries no conditions, so
 * there is no such match to read it. Here there is, and the inverter promotes a
 * given's conditions to match conditions, so a given that carries one is still
 * walked and still has to be joined to the rest. Counting it keeps the refusal
 * this check already gave such a specification, rather than letting it reach
 * `shakeTree` and fail there as a crash instead of as a client error.
 *
 * @param specification The specification to inspect.
 * @returns The set of label names the matches name.
 */
function labelsReferencedInSpecification(specification: Specification): Set<string> {
    const referencedLabels = new Set<string>();
    for (const given of specification.given) {
        for (const condition of given.conditions) {
            addReferencedLabelsFromMatches(condition.matches, referencedLabels);
        }
    }
    addReferencedLabelsFromMatches(specification.matches, referencedLabels);
    addReferencedLabelsFromProjection(specification.projection, referencedLabels);
    return referencedLabels;
}

function addReferencedLabelsFromMatches(matches: Match[], referencedLabels: Set<string>): void {
    for (const match of matches) {
        for (const label of getLabelsReferencedInMatch(match)) {
            referencedLabels.add(label);
        }
    }
}

function addReferencedLabelsFromProjection(projection: Projection, referencedLabels: Set<string>): void {
    if (projection.type !== "composite") {
        return;
    }
    for (const component of projection.components) {
        if (component.type === "specification") {
            addReferencedLabelsFromMatches(component.matches, referencedLabels);
            addReferencedLabelsFromProjection(component.projection, referencedLabels);
        }
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
