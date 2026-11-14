import { Condition, Match, Specification } from '../specification/specification';

/**
 * An edge in the dependency graph over fact types. The verdict on a fact of
 * type `to` can depend on the facts of type `from`, so every fact of type
 * `from` in a batch is decided first.
 *
 * Two kinds of edge reach this graph. A **rule edge** comes from the tail of a
 * rule: the tail reads the store, so what it finds there decides the verdict.
 * A **predecessor edge** comes from a predecessor role: a fact is accepted only
 * when its predecessors are.
 *
 * A type read beneath a negative existential condition yields no edge. Nothing
 * beneath such a condition sees the facts of the batch, so no verdict in the
 * batch depends on one, and the order in which the batch is decided owes it
 * nothing.
 */
export interface TypeDependency {
    /** The type whose facts are decided first. */
    from: string;
    /** The type whose verdict depends on them. */
    to: string;
    /**
     * True for an edge from a rule's tail, false for one from a predecessor
     * role. A component that holds a rule edge needs more than one pass.
     */
    fromRule: boolean;
}

/**
 * The strata of a dependency graph over fact types: its strongly connected
 * components, in topological order. Every type a rule's tail reads outside a
 * negative existential condition lies in an earlier stratum, or in the same
 * component, so a batch decided stratum by stratum reads back every fact of
 * those types that the batch will commit.
 */
export class AuthorizationStrata {
    constructor(
        private readonly stratumByType: { [type: string]: number },
        private readonly recursive: readonly boolean[]
    ) { }

    /**
     * The stratum a type belongs to. A type the graph does not name sorts after
     * every stratum: nothing in the graph reads it, and a fact of a type no rule
     * governs is refused in any case.
     */
    stratumOf(type: string): number {
        const stratum = this.stratumByType[type];
        return stratum === undefined ? this.recursive.length : stratum;
    }

    /**
     * True when the stratum's component holds a rule edge, so one fact in it
     * can be admitted by another. Such a stratum is evaluated again until a
     * pass accepts nothing new. A component held together only by predecessor
     * edges settles in a single pass, because the batch is already sorted so
     * that predecessors come first.
     */
    isRecursive(stratum: number): boolean {
        return this.recursive[stratum] === true;
    }

    /** The number of strata, not counting the one unnamed types sort into. */
    get count(): number {
        return this.recursive.length;
    }
}

/**
 * The types a rule's tail reads from the store outside every negative
 * existential condition, as edges into the type the rule governs. A fact of one
 * of those types can admit a fact of this type, so it is decided first.
 *
 * A type read beneath a negative existential condition yields no edge, at any
 * depth, because nothing beneath such a condition sees the facts of the batch.
 */
export function tailDependencies(type: string, tail: Specification): TypeDependency[] {
    const dependencies: TypeDependency[] = [];
    const add = (from: string) => {
        dependencies.push({ from, to: type, fromRule: true });
    };
    collectFromMatches(tail.matches, add);
    return dependencies;
}

function collectFromMatches(matches: Match[], add: (from: string) => void) {
    for (const match of matches) {
        add(match.unknown.type);
        for (const condition of match.conditions) {
            collectFromCondition(condition, add);
        }
    }
}

function collectFromCondition(condition: Condition, add: (from: string) => void) {
    if (condition.type === "existential") {
        // A negative condition stops the walk. Every type nested inside it,
        // however many conditions are nested within, is read from the store as
        // it was before the batch, so no verdict in the batch depends on it.
        if (condition.exists) {
            collectFromMatches(condition.matches, add);
        }
    }
    else {
        for (const role of condition.rolesLeft) {
            add(role.predecessorType);
        }
        for (const role of condition.rolesRight) {
            add(role.predecessorType);
        }
    }
}

/**
 * The strata of the graph the dependencies describe, in topological order.
 *
 * No rule set is refused for its shape. A cycle is ordinary: its types form one
 * component, and a component that holds a rule edge is decided again until a
 * pass accepts nothing new. Negative conditions take no part in that iteration,
 * because they read the store as it was before the batch, so a cycle through a
 * negation cannot leave a verdict ambiguous.
 */
export function computeStrata(dependencies: readonly TypeDependency[], types: readonly string[]): AuthorizationStrata {
    // Sorted so that the component order, and therefore the stratum numbers, do
    // not depend on the order the rules were declared or the batch arrived in.
    const nodes = Array.from(new Set<string>([
        ...types,
        ...dependencies.map(d => d.from),
        ...dependencies.map(d => d.to)
    ])).sort();

    const outgoing: { [from: string]: string[] } = {};
    for (const node of nodes) {
        outgoing[node] = [];
    }
    for (const dependency of dependencies) {
        const targets = outgoing[dependency.from];
        if (!targets.includes(dependency.to)) {
            targets.push(dependency.to);
        }
    }
    for (const node of nodes) {
        outgoing[node].sort();
    }

    const components = stronglyConnectedComponents(nodes, outgoing);
    const stratumByType: { [type: string]: number } = {};
    components.forEach((component, stratum) => {
        for (const type of component) {
            stratumByType[type] = stratum;
        }
    });

    const recursive = components.map(() => false);
    for (const dependency of dependencies) {
        if (dependency.fromRule && stratumByType[dependency.from] === stratumByType[dependency.to]) {
            recursive[stratumByType[dependency.to]] = true;
        }
    }

    return new AuthorizationStrata(stratumByType, recursive);
}

/**
 * Tarjan's algorithm, iterative so that a long chain of fact types cannot
 * exhaust the call stack. Tarjan emits a component only once every component it
 * reaches has been emitted, which is reverse topological order for edges that
 * run from the type decided first, so the result is reversed.
 */
function stronglyConnectedComponents(nodes: readonly string[], outgoing: { [from: string]: string[] }): string[][] {
    const index: { [node: string]: number } = {};
    const low: { [node: string]: number } = {};
    const onStack: { [node: string]: boolean } = {};
    const stack: string[] = [];
    const components: string[][] = [];
    let nextIndex = 0;

    for (const root of nodes) {
        if (index[root] !== undefined) {
            continue;
        }
        index[root] = low[root] = nextIndex++;
        stack.push(root);
        onStack[root] = true;
        const frames: { node: string, next: number }[] = [{ node: root, next: 0 }];
        while (frames.length > 0) {
            const frame = frames[frames.length - 1];
            const successors = outgoing[frame.node];
            if (frame.next < successors.length) {
                const successor = successors[frame.next++];
                if (index[successor] === undefined) {
                    index[successor] = low[successor] = nextIndex++;
                    stack.push(successor);
                    onStack[successor] = true;
                    frames.push({ node: successor, next: 0 });
                }
                else if (onStack[successor]) {
                    low[frame.node] = Math.min(low[frame.node], index[successor]);
                }
            }
            else {
                frames.pop();
                if (frames.length > 0) {
                    const parent = frames[frames.length - 1].node;
                    low[parent] = Math.min(low[parent], low[frame.node]);
                }
                if (low[frame.node] === index[frame.node]) {
                    const component: string[] = [];
                    let member: string;
                    do {
                        member = stack.pop()!;
                        onStack[member] = false;
                        component.push(member);
                    } while (member !== frame.node);
                    components.push(component);
                }
            }
        }
    }

    return components.reverse();
}
