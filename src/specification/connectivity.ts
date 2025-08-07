import { ComponentProjection, Condition, Match, NamedComponentProjection, Projection, Specification } from "./specification";

export class DisconnectedSpecificationError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, DisconnectedSpecificationError.prototype);
    this.name = "DisconnectedSpecificationError";
  }
}

export type ConnectivityValidationMode = "off" | "warn" | "error";
let connectivityValidationMode: ConnectivityValidationMode = "off";

export function setConnectivityValidationMode(mode: ConnectivityValidationMode) {
  connectivityValidationMode = mode;
}

export function enforceConnectivityValidation(spec: Specification): void {
  if (connectivityValidationMode === "off") return;
  try {
    validateSpecificationConnectivity(spec);
  }
  catch (e) {
    if (connectivityValidationMode === "warn") {
      // eslint-disable-next-line no-console
      console.warn((e as Error).message);
      return;
    }
    throw e;
  }
}

export function validateSpecificationConnectivity(spec: Specification): void {
  // Build undirected adjacency map of label names
  const nodes = new Set<string>();
  const adj = new Map<string, Set<string>>();

  function addNode(label: string) {
    nodes.add(label);
    if (!adj.has(label)) adj.set(label, new Set());
  }
  function addEdge(a: string, b: string) {
    if (a === b) return;
    addNode(a); addNode(b);
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }

  // Collect all nodes and edges from the entire spec tree
  for (const g of spec.given) {
    addNode(g.name);
  }
  collectFromMatches(spec.matches);
  collectFromProjection(spec.projection);

  function collectFromMatches(matches: Match[]) {
    for (const m of matches) {
      addNode(m.unknown.name);
      for (const c of m.conditions) {
        collectFromCondition(m.unknown.name, c);
      }
    }
  }

  function collectFromCondition(unknownLabel: string, c: Condition) {
    if (c.type === "path") {
      // Path condition connects the match unknown to the referenced label
      addNode(c.labelRight);
      addEdge(unknownLabel, c.labelRight);
    }
    else if (c.type === "existential") {
      collectFromMatches(c.matches);
    }
    else {
      const _exhaustive: never = c;
      throw new Error(`Unexpected condition type: ${( _exhaustive as any).type}`);
    }
  }

  function collectFromProjection(p: Projection) {
    if (p.type === "composite") {
      for (const comp of p.components) {
        collectFromComponent(comp);
      }
    }
    else {
      // Singular projections reference a label directly
      addNode(p.label);
    }
  }

  function collectFromComponent(comp: NamedComponentProjection) {
    if (comp.type === "specification") {
      collectFromMatches(comp.matches);
      collectFromProjection(comp.projection);
    }
    else {
      // fact/field/hash reference a label
      addNode(comp.label);
    }
  }

  // Compute degrees for isolated detection
  const degreeByNode = new Map<string, number>();
  for (const n of nodes) {
    degreeByNode.set(n, (adj.get(n)?.size ?? 0));
  }
  const isolated = Array.from(nodes).filter(n => (degreeByNode.get(n) ?? 0) === 0);
  // Allow identity specifications that neither match nor project any labels
  const isIdentity = isolated.length > 0 && nodes.size === spec.given.length &&
    spec.matches.length === 0 &&
    (spec.projection.type === "composite" && spec.projection.components.length === 0);
  if (!isIdentity && isolated.length > 0) {
    throw new DisconnectedSpecificationError(
      `Specification is disconnected. Isolated labels: ${isolated.sort().join(", ")}.`
    );
  }

  // Compute connected components over nodes present in adj
  const nodeList = Array.from(nodes);
  const componentIdByNode = new Map<string, number>();
  let currentId = 0;
  for (const n of nodeList) {
    if (!componentIdByNode.has(n)) {
      // BFS/DFS
      const stack = [n];
      componentIdByNode.set(n, currentId);
      while (stack.length) {
        const v = stack.pop()!;
        const neighbors = adj.get(v) ?? new Set<string>();
        for (const w of neighbors) {
          if (!componentIdByNode.has(w)) {
            componentIdByNode.set(w, currentId);
            stack.push(w);
          }
        }
      }
      currentId++;
    }
  }

  // Gather labels referenced by the projection tree (including nested specs)
  const projectionLabels = new Set<string>();
  collectProjectionLabels(spec.projection, projectionLabels);

  function collectProjectionLabels(p: Projection, acc: Set<string>) {
    if (p.type === "composite") {
      for (const comp of p.components) {
        if (comp.type === "specification") {
          collectProjectionLabels(comp.projection, acc);
        }
        else {
          acc.add(comp.label);
        }
      }
    }
    else {
      acc.add(p.label);
    }
  }

  // Determine which component(s) the projection references
  const projectionComponentIds = new Set<number>();
  for (const l of projectionLabels) {
    if (!componentIdByNode.has(l)) {
      // Label used in projection but never defined as given or unknown
      // Treat it as isolated node (will be caught above if truly isolated)
      addNode(l);
      componentIdByNode.set(l, currentId++);
      projectionComponentIds.add(componentIdByNode.get(l)!);
    }
    else {
      projectionComponentIds.add(componentIdByNode.get(l)!);
    }
  }

  if (projectionComponentIds.size > 1) {
    const componentsById = new Map<number, string[]>();
    for (const l of projectionLabels) {
      const id = componentIdByNode.get(l)!;
      const group = componentsById.get(id) ?? [];
      group.push(l);
      componentsById.set(id, group);
    }
    const parts = Array.from(componentsById.values()).map(g => `{ ${g.sort().join(", ")} }`);
    throw new DisconnectedSpecificationError(
      `Specification is disconnected. Projection references labels from multiple components: ${parts.join("; ")}.`
    );
  }

  // If there are nodes not in the projection's component, the spec is disconnected
  const targetComponentId = projectionComponentIds.size === 1 ? Array.from(projectionComponentIds)[0] : null;
  if (targetComponentId !== null) {
    const givenSet = new Set(spec.given.map(g => g.name));
    const disconnectedLabels: string[] = [];
    for (const n of nodeList) {
      const id = componentIdByNode.get(n)!;
      if (id !== targetComponentId) {
        // Ignore givens here; they may serve as connectors only
        if (!givenSet.has(n)) {
          disconnectedLabels.push(n);
        }
      }
    }

    if (disconnectedLabels.length > 0) {
      const sorted = disconnectedLabels.sort();
      throw new DisconnectedSpecificationError(
        `Specification is disconnected. Labels not connected to the projection: ${sorted.join(", ")}.`
      );
    }
  }
}