import { Condition, Match, Specification } from '../specification/specification';
import { AuthorizationRuleError } from './errors';

/**
 * An edge in the dependency graph over fact types. The verdict on a fact of
 * type `to` can depend on the facts of type `from`, so every fact of type
 * `from` in a batch is decided first.
 *
 * Two kinds of edge reach this graph. A **rule edge** comes from the tail of a
 * rule: the tail reads the store, so what it finds there decides the verdict.
 * A **predecessor edge** comes from a predecessor role: a fact is accepted only
 * when its predecessors are.
 */
export interface TypeDependency {
    /** The type whose facts are decided first. */
    from: string;
    /** The type whose verdict depends on them. */
    to: string;
    /**
     * True when `from` is read beneath a negative existential condition, so a
     * fact of that type withholds the verdict rather than granting it.
     */
    negative: boolean;
    /**
     * True for an edge from a rule's tail, false for one from a predecessor
     * role. A component that holds a rule edge needs more than one pass.
     */
    fromRule: boolean;
}

/**
 * The strata of a dependency graph over fact types: its strongly connected
 * components, in topological order. Every type a rule's tail reads lies in an
 * earlier stratum, or in the same component, so a batch decided stratum by
 * stratum reads exactly the facts of those types that the batch will commit.
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
 * The types a rule's tail reads from the store, as edges into the type the rule
 * governs. An edge is negative when the type sits beneath a negative
 * existential condition, at any depth: a fact found there withholds the
 * verdict, so the verdict on it has to be settled first.
 */
export function tailDependencies(type: string, tail: Specification): TypeDependency[] {
    const dependencies: TypeDependency[] = [];
    const add = (from: string, negative: boolean) => {
        dependencies.push({ from, to: type, negative, fromRule: true });
    };
    collectFromMatches(tail.matches, true, add);
    return dependencies;
}

function collectFromMatches(matches: Match[], positive: boolean, add: (from: string, negative: boolean) => void) {
    for (const match of matches) {
        add(match.unknown.type, !positive);
        for (const condition of match.conditions) {
            collectFromCondition(condition, positive, add);
        }
    }
}

function collectFromCondition(condition: Condition, positive: boolean, add: (from: string, negative: boolean) => void) {
    if (condition.type === "existential") {
        // Once beneath a negative existential condition, every type nested
        // inside it is negative, however many conditions are nested within.
        collectFromMatches(condition.matches, positive && condition.exists, add);
    }
    else {
        for (const role of condition.rolesLeft) {
            add(role.predecessorType, !positive);
        }
        for (const role of condition.rolesRight) {
            add(role.predecessorType, !positive);
        }
    }
}

/**
 * The strata of the graph the dependencies describe, in topological order.
 *
 * Throws `AuthorizationRuleError` when a negative edge joins two types of one
 * component. Whether one fact is admitted would then depend on whether another
 * is, through a negation, and no order of evaluation settles that.
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

    for (const dependency of dependencies) {
        if (dependency.negative && stratumByType[dependency.from] === stratumByType[dependency.to]) {
            throw new AuthorizationRuleError(negativeCycleMessage(dependency, components[stratumByType[dependency.to]]));
        }
    }

    const recursive = components.map(() => false);
    for (const dependency of dependencies) {
        if (dependency.fromRule && stratumByType[dependency.from] === stratumByType[dependency.to]) {
            recursive[stratumByType[dependency.to]] = true;
        }
    }

    return new AuthorizationStrata(stratumByType, recursive);
}

function negativeCycleMessage(dependency: TypeDependency, component: readonly string[]): string {
    const cycle = component.slice().sort().join(", ");
    const forbids = dependency.from === dependency.to
        ? `The authorization rule for ${dependency.to} forbids a fact of its own type ${dependency.from}.`
        : `The authorization rule for ${dependency.to} forbids a fact of type ${dependency.from}, whose own verdict depends in turn on ${dependency.to}.`;
    return `${forbids} The types on the cycle are ${cycle}. ` +
        `Whether one fact is admitted would depend on whether another is, through a negation, so no order of evaluation settles it. ` +
        `Name the principal who makes the decision in a rule of their own instead.`;
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
