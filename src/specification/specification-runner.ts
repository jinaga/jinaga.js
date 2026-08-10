import { FactRecord, FactReference, factReferenceEquals, ProjectedResult, ReadResult, ReferencesByName } from "../storage";
import { flattenAsync, mapAsync } from "../util/fn";
import { ComponentProjection, Condition, Label, Match, PathCondition, Projection, Role, SingularProjection, Specification } from "./specification";

export interface FactSource {
  findFact(reference: FactReference): Promise<FactRecord | null>;
  getPredecessors(reference: FactReference, name: string, predecessorType: string): Promise<FactReference[]>;
  getSuccessors(reference: FactReference, name: string, successorType: string): Promise<FactReference[]>;
  hydrate(reference: FactReference): Promise<unknown>;
}

export class SpecificationRunner {
  constructor(
    private readonly source: FactSource
  ) { }

  /**
   * Evaluate a specification, discarding the given-not-found distinction
   * (issue #232). Retained as a derived projection over `readFull` so the many
   * internal callers for which an absent given is routine — authorization
   * rules, distribution, purge, the observable source — are unaffected.
   */
  async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
    const result = await this.readFull(start, specification);
    return result.kind === 'complete' ? result.results : [];
  }

  async readFull(start: FactReference[], specification: Specification): Promise<ReadResult> {
    if (start.length !== specification.given.length) {
      throw new Error(`The number of start references (${start.length}) must match the number of given facts (${specification.given.length}).`);
    }

    // Report every given that is missing, not just the first. A caller
    // debugging a multi-given specification needs the whole set.
    //
    // `start` can be sparse: the distribution engine builds permutations by
    // assigning into an array by index (`permutationsOf`), which leaves holes
    // when the indices are not contiguous. A hole is as absent as a fact that
    // is not in the store, but there is no reference to name in the report.
    const missing: FactReference[] = [];
    let incomplete = false;
    for (const reference of start) {
      const fact = reference ? await this.source.findFact(reference) : null;
      if (fact === null) {
        if (reference) {
          missing.push({ type: reference.type, hash: reference.hash });
        }
        else {
          incomplete = true;
        }
      }
    }
    if (incomplete || missing.length > 0) {
      return { kind: 'given-not-found', references: missing };
    }

    const references = start.reduce((references, reference, index) => ({
      ...references,
      [specification.given[index].label.name]: {
        type: reference.type,
        hash: reference.hash
      }
    }), {} as ReferencesByName);

    // Evaluate given conditions
    for (let i = 0; i < specification.given.length; i++) {
      const given = specification.given[i];
      const givenReference = references[given.label.name];

      for (const condition of given.conditions) {
        if (condition.type === "existential") {
          const matches = await this.executeMatches(
            references,
            condition.matches
          );
          const conditionSatisfied = condition.exists ?
            matches.length > 0 :
            matches.length === 0;

          if (!conditionSatisfied) {
            // The given exists; the specification excludes it. That is a
            // complete answer of zero rows, not a missing given.
            return { kind: 'complete', results: [] };
          }
        }
      }
    }

    const products = await this.executeMatchesAndProjection(references, specification.matches, specification.projection);
    return { kind: 'complete', results: products };
  }

  private async executeMatchesAndProjection(references: ReferencesByName, matches: Match[], projection: Projection): Promise<ProjectedResult[]> {
    const tuples: ReferencesByName[] = await this.executeMatches(references, matches);
    const products = mapAsync(tuples, tuple => this.createProduct(tuple, projection));
    return products;
  }

  private async executeMatches(references: ReferencesByName, matches: Match[]): Promise<ReferencesByName[]> {
    let results: ReferencesByName[] = [references];
    for (const match of matches) {
      results = await flattenAsync(results, tuple => this.executeMatch(tuple, match));
    }
    return results;
  }

  private async executeMatch(references: ReferencesByName, match: Match): Promise<ReferencesByName[]> {
    let results: ReferencesByName[] = [];
    if (match.conditions.length === 0) {
      throw new Error("A match must have at least one condition.");
    }
    const firstCondition = match.conditions[0];
    if (firstCondition.type === "path") {
      const result: FactReference[] = await this.executePathCondition(references, match.unknown, firstCondition);
      results = result.map(reference => ({
        ...references,
        [match.unknown.name]: {
          type: reference.type,
          hash: reference.hash
        }
      }));
    }
    else {
      throw new Error("The first condition must be a path condition.");
    }

    const remainingConditions = match.conditions.slice(1);
    for (const condition of remainingConditions) {
      results = await this.filterByCondition(references, match.unknown, results, condition);
    }
    return results;
  }

  private async executePathCondition(references: ReferencesByName, unknown: Label, pathCondition: PathCondition): Promise<FactReference[]> {
    if (!references.hasOwnProperty(pathCondition.labelRight)) {
      throw new Error(`The label ${pathCondition.labelRight} is not defined.`);
    }
    const start = references[pathCondition.labelRight];
    let results: FactReference[] = [start];
    for (const role of pathCondition.rolesRight) {
      results = await this.executePredecessorStep(results, role.name, role.predecessorType);
    }
    const invertedRoles = invertRoles(pathCondition.rolesLeft, unknown.type);
    for (const role of invertedRoles) {
      results = await this.executeSuccessorStep(results, role.name, role.successorType);
    }
    return results;
  }

  private executePredecessorStep(set: FactReference[], name: string, predecessorType: string): Promise<FactReference[]> {
    return flattenAsync(set, reference => this.source.getPredecessors(reference, name, predecessorType));
  }

  private executeSuccessorStep(set: FactReference[], name: string, successorType: string): Promise<FactReference[]> {
    return flattenAsync(set, reference => this.source.getSuccessors(reference, name, successorType));
  }

  private async filterByCondition(references: ReferencesByName, unknown: Label, results: ReferencesByName[], condition: Condition): Promise<ReferencesByName[]> {
    if (condition.type === "path") {
      const otherResults = await this.executePathCondition(references, unknown, condition);
      return results.filter(result => otherResults.some(factReferenceEquals(result[unknown.name])));
    }
    else if (condition.type === "existential") {
      const matchingReferences: ReferencesByName[] = [];
      for (const result of results) {
        const matches = await this.executeMatches(result, condition.matches);
        const include = condition.exists ?
          matches.length > 0 :
          matches.length === 0;
        if (include) {
          matchingReferences.push(result);
        }
      }
      return matchingReferences;
    }
    else {
      const _exhaustiveCheck: never = condition;
      throw new Error(`Unknown condition type: ${(_exhaustiveCheck as any).type}`);
    }
  }

  private async createProduct(tuple: ReferencesByName, projection: Projection): Promise<ProjectedResult> {
    if (projection.type === "composite") {
      let result = {};
      for (const component of projection.components) {
        result = {
          ...result,
          [component.name]: await this.createComponent(tuple, component)
        };
      }
      return {
        tuple,
        result
      };
    }
    else {
      const result = await this.createSingularProduct(tuple, projection);
      return {
        tuple,
        result
      };
    }
  }

  private async createComponent(tuple: ReferencesByName, component: ComponentProjection): Promise<any> {
    if (component.type === "specification") {
      return await this.executeMatchesAndProjection(tuple, component.matches, component.projection);
    }
    else {
      return await this.createSingularProduct(tuple, component);
    }
  }

  private async createSingularProduct(tuple: ReferencesByName, projection: SingularProjection): Promise<any> {
    if (projection.type === "fact") {
      if (!tuple.hasOwnProperty(projection.label)) {
        throw new Error(`The label ${projection.label} is not defined.`);
      }
      const reference = tuple[projection.label];
      return await this.source.hydrate(reference);
    }
    else if (projection.type === "field") {
      if (!tuple.hasOwnProperty(projection.label)) {
        throw new Error(`The label ${projection.label} is not defined.`);
      }
      const reference = tuple[projection.label];
      const fact = await this.source.findFact(reference);
      if (fact === null) {
        throw new Error(`The fact ${reference.type}:${reference.hash} is not defined.`);
      }
      const value: any = fact.fields[projection.field];
      return value;
    }
    else if (projection.type === "hash") {
      if (!tuple.hasOwnProperty(projection.label)) {
        throw new Error(`The label ${projection.label} is not defined.`);
      }
      const reference = tuple[projection.label];
      return reference.hash;
    }
    else if (projection.type === "time") {
      if (!tuple.hasOwnProperty(projection.label)) {
        throw new Error(`The label ${projection.label} is not defined.`);
      }
      const reference = tuple[projection.label];
      const fact = await this.source.findFact(reference);
      if (fact === null) {
        throw new Error(`The fact ${reference.type}:${reference.hash} is not defined.`);
      }
      // Access timestamp property if available
      const timestampedFact = fact as FactRecord & { timestamp?: Date };
      if (!timestampedFact.timestamp) {
        throw new Error(`The fact ${reference.type}:${reference.hash} does not have timestamp metadata.`);
      }
      return timestampedFact.timestamp;
    }
    else {
      const _exhaustiveCheck: never = projection;
      throw new Error(`Unexpected child projection type: ${_exhaustiveCheck}`);
    }
  }
}

interface InvertedRole {
  name: string;
  successorType: string;
}

function invertRoles(roles: Role[], type: string): InvertedRole[] {
  const results: InvertedRole[] = [];
  for (const role of roles) {
    results.push({
      name: role.name,
      successorType: type
    });
    type = role.predecessorType;
  }
  return results.reverse();
}
