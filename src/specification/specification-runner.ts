import { FactRecord, FactReference, factReferenceEquals, ProjectedResult, ReferencesByName } from "../storage";
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

  async read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
    if (start.length !== specification.given.length) {
      throw new Error(`The number of start references (${start.length}) must match the number of given facts (${specification.given.length}).`);
    }
    
    // Check if all given facts exist by attempting to find them
    for (const reference of start) {
      const fact = await this.source.findFact(reference);
      if (fact === null) {
        // If any given fact doesn't exist, return empty result
        return [];
      }
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
            return [];
          }
        }
      }
    }

    const products = await this.executeMatchesAndProjection(references, specification.matches, specification.projection);
    return products;
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
        throw new Error(`The fact ${reference} is not defined.`);
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
