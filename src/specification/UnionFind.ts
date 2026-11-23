import { feedsOf } from "./feeds";
import { Invalid } from "./invalid";
import { Match, Projection, Specification, SpecificationGiven, isPathCondition } from "./specification";

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
 * A match with only its path conditions, so the filter a negative condition
 * applies is dropped (`Match.paths`, `JinagaSpec/Connected.lean`).
 */
function paths(match: Match): Match {
    return { ...match, conditions: match.conditions.filter(isPathCondition) };
}

/** Every label the conditions of these matches name, at any depth. */
function referenced(matches: Match[]): string[] {
    return matches.flatMap(match => match.conditions.flatMap(condition =>
        isPathCondition(condition) ? [condition.labelRight] : referenced(condition.matches)));
}

interface Connections {
    labels: string[];
    edges: [string, string][];
    types: [string, string][];
}

/**
 * Every label these matches name, and every pair the connectivity check joins.
 *
 * A path condition joins its match's unknown to the label it names. An
 * existential condition joins its match's unknown to every label its path
 * conditions name, at any depth, because the condition is a filter on that
 * match and the labels it reads are read through it.
 */
function connections(matches: Match[]): Connections {
    const labels: string[] = [];
    const edges: [string, string][] = [];
    const types: [string, string][] = [];
    for (const match of matches) {
        const unknown = match.unknown.name;
        labels.push(unknown);
        types.push([unknown, match.unknown.type]);
        for (const condition of match.conditions) {
            if (isPathCondition(condition)) {
                labels.push(condition.labelRight);
                edges.push([unknown, condition.labelRight]);
            }
            else {
                const inner = connections(condition.matches);
                const named = referenced(condition.matches);
                labels.push(...inner.labels, ...named);
                types.push(...inner.types);
                edges.push(...inner.edges, ...named.map(label => [unknown, label] as [string, string]));
            }
        }
    }
    return { labels, edges, types };
}

/**
 * The connected components of a specification's labels, and the type of each
 * label the specification declares. One component is `isConnected`: every
 * label is joined to every other, through path conditions or through the
 * labels an existential condition names. More than one is the break, and each
 * refusal below names the labels on either side of it.
 *
 * A condition on a given joins nothing. It filters the one row its given
 * contributes, so it adds no column to take a product over, and a feed takes
 * its givens without their conditions (`asFeed`). Counting the labels such a
 * condition names as joins would accept a specification whose two chains
 * nothing else joins, and whose feeds, walking only predecessors, leave clause
 * 3 nothing to read.
 */
function componentsOf(specification: Specification): { components: string[][]; types: Map<string, string> } {
    const unionFind = new UnionFind();
    const labels = new Set<string>();
    const types = new Map<string, string>();
    function add(connections: Connections) {
        for (const label of connections.labels) {
            labels.add(label);
        }
        for (const [label, type] of connections.types) {
            types.set(label, type);
        }
        for (const [left, right] of connections.edges) {
            unionFind.union(left, right);
        }
    }
    for (const given of specification.given) {
        labels.add(given.label.name);
        types.set(given.label.name, given.label.type);
    }
    add(connections(specification.matches));
    for (const label of labels) {
        unionFind.ensureLabel(label);
    }
    return { components: unionFind.getConnectedComponents(), types };
}

/**
 * Report whether a specification declares an unknown: a label whose facts are
 * found by walking the graph, and which therefore contributes rows that another
 * component's unknown could be multiplied against.
 *
 * Unknowns inside a condition on a given do not count. An existential condition
 * filters the row its given is part of; it yields no column of its own.
 *
 * @param specification The specification to inspect.
 * @returns True if the specification declares at least one unknown.
 */
function declaresUnknown(specification: Specification): boolean {
    return specification.matches.length > 0 ||
        projectionDeclaresUnknown(specification.projection);
}

function projectionDeclaresUnknown(projection: Projection): boolean {
    if (projection.type !== "composite") {
        return false;
    }
    return projection.components.some(component =>
        component.type === "specification" &&
        (component.matches.length > 0 || projectionDeclaresUnknown(component.projection))
    );
}

/** Labels these matches name but do not bind. `bound` holds the labels bound around them. */
function freeIn(bound: string[], matches: Match[]): string[] {
    return matches.flatMap(match => match.conditions.flatMap(condition => isPathCondition(condition)
        ? (bound.includes(condition.labelRight) ? [] : [condition.labelRight])
        : freeIn([...bound, ...condition.matches.map(nested => nested.unknown.name)], condition.matches)));
}

/**
 * The givens these matches name, in their path conditions or in the filters of
 * their negative conditions (`usedGivens`).
 */
function usedGivens(given: SpecificationGiven[], matches: Match[]): SpecificationGiven[] {
    const free = freeIn([], matches);
    return given.filter(g => free.includes(g.label.name));
}

/**
 * These matches as a feed of `given`: with the givens they use, and no
 * projection (`asFeed`). A given that only a filter names is a parameter of
 * that filter, not a factor of a product, so a feed takes only the givens its
 * matches use.
 */
function asFeed(given: SpecificationGiven[], matches: Match[]): Specification {
    return {
        given: usedGivens(given, matches).map(g => ({ label: g.label, conditions: [] })),
        matches,
        projection: { type: "composite", components: [] }
    };
}

/**
 * A specification and its child specifications at every depth, each as a
 * specification of its own: the same givens, and the parent's matches followed
 * by its own (`Specification.descendants`). A child inherits its parent's
 * matches, so a child is joined to whatever its parent's matches join.
 */
function descendants(specification: Specification): Specification[] {
    const components = specification.projection.type === "composite" ? specification.projection.components : [];
    return [specification, ...components.flatMap(component => component.type !== "specification" ? [] :
        descendants({
            given: specification.given,
            matches: [...specification.matches, ...component.matches],
            projection: component.projection
        }))];
}

/**
 * Where independent parts of a specification belong. A child inherits its
 * parent's matches, so a child placed under a match is joined to that match's
 * chain and is not independent of it. Only a root with no matches of its own
 * holds parts that are.
 */
const independentParts =
    "Independent parts of a specification belong in child specifications of a root with no matches, " +
    "as in (p1, p2) { } => { a = { ... }, b = { ... } }, never in one list of matches and never under a match: " +
    "a child inherits its parent's matches, so a child placed under a match is joined to that match's chain.";

function describeSubgraphs(components: string[][], types: Map<string, string>): string {
    const descriptions = components.map((component, index) => {
        const labels = component.map(label => `'${label}:${types.get(label) || "unknown"}'`).join(", ");
        return `Subgraph ${index + 1}: [${labels}]`;
    }).join("; ");
    return `The specification contains ${components.length} disconnected subgraphs: ${descriptions}. `;
}

/**
 * Refuse a specification whose labels are not connected, or one of whose feeds
 * would be the product of two chains that nothing in that feed joins.
 *
 * This decides `ConnectedDescendants` (`JinagaSpec/Connected.lean`, proved in
 * jinaga/jinaga-spec#57), which `buildFeeds` needs of its input. It has three
 * clauses:
 *
 * 1. Each descendant, as a feed of the givens its matches use, is connected.
 * 2. Every given is used by some descendant.
 * 3. Every feed `buildFeeds` emits is joined: its path conditions alone, the
 *    filters of its negative conditions dropped, join its matches and the
 *    givens they use, and it passes `isConnected`, so each filter's matches
 *    are joined to the feed.
 *
 * Clause 3 is what says no feed is a product. A negative condition filters a
 * match, so `isConnected` counts every label a filter names as joined to that
 * match; dropping the filters is what reveals a feed that only a filter joins.
 */
export function detectDisconnectedSpecification(specification: Specification): void {
    if (!declaresUnknown(specification)) {
        // A specification that declares no unknown yields exactly one row,
        // whatever its givens are, so its labels are a tuple signature rather
        // than a graph to walk, and connectedness does not apply. Conditions on
        // the givens only filter that row; they add no column to take a product
        // over. There is no match for a given to be used by, and no feed to be
        // a product, so none of the three clauses has anything to read.
        //
        // The `with` specification of a distribution rule is this shape by
        // design. `DistributionEngine.canDistributeTo` reads the principal out
        // of it through `specificationIsIdentity` and
        // `executeDeterministicSpecification`, which take the given at the
        // projected label's index and never consult a store. Its givens mirror
        // the share rule's, so a share rule with two unrelated givens has a
        // `with` whose labels necessarily fall into two components. Refusing
        // that would leave a multi-given share rule with no expressible
        // principal.
        //
        // `model.given(X).select(x => x)`, and a projection of a given's own
        // fields, hash or time, are this shape too. jinaga.js answers both.
        return;
    }

    const specifications = descendants(specification);

    // Clause 1: each descendant, as a feed, is connected.
    for (let index = 0; index < specifications.length; index++) {
        const descendant = specifications[index];
        const { components, types } = componentsOf(asFeed(descendant.given, descendant.matches));
        if (components.length > 1) {
            const scope = index === 0 ? "the specification" : "a child specification of the projection";
            throw new DisconnectedSpecificationError(
                "Disconnected specification detected. " +
                describeSubgraphs(components, types) +
                `Nothing joins them, so ${scope} would be the product of ${components.length} chains. ` +
                `Join them with a path condition, or, if they are independent, keep them apart. ` +
                independentParts
            );
        }
    }

    // Clause 2: every given is used by some descendant.
    for (const given of specification.given) {
        const used = specifications.some(descendant =>
            usedGivens(descendant.given, descendant.matches).some(g => g.label.name === given.label.name));
        if (!used) {
            const { components, types } = componentsOf(specification);
            throw new DisconnectedSpecificationError(
                "Disconnected specification detected. " +
                `The given '${given.label.name}:${given.label.type}' is used by no match, of the specification or of any of its child specifications. ` +
                (components.length > 1 ? describeSubgraphs(components, types) : "") +
                "Remove the given, or join a match to it with a path condition."
            );
        }
    }

    // Clause 3: every feed is joined, so no feed is the product of two chains.
    for (const feed of feedsOf(specification)) {
        const dropped = componentsOf(asFeed(feed.given, feed.matches.map(paths)));
        if (dropped.components.length > 1) {
            throw new DisconnectedSpecificationError(
                "Disconnected specification detected. " +
                describeSubgraphs(dropped.components, dropped.types) +
                `One feed of this specification joins them only through the filter of a negative condition, ` +
                `so that feed would be the product of ${dropped.components.length} chains. ` +
                "A negative condition filters a match; it never joins two. " +
                "Move the match the condition names into the condition, so the condition filters a join. " +
                "If a later match joins the two chains, move it before the negative condition instead, so the chain " +
                "the condition filters is joined by the time the condition applies: the two orders have the same " +
                "results, and their feeds differ. " +
                independentParts
            );
        }
        const whole = componentsOf(feed);
        if (whole.components.length > 1) {
            throw new DisconnectedSpecificationError(
                "Disconnected specification detected. " +
                describeSubgraphs(whole.components, whole.types) +
                "One feed of this specification carries a negative condition whose matches are joined to nothing. " +
                "Give each match of the condition a path condition that names a label the feed binds."
            );
        }
    }
}
