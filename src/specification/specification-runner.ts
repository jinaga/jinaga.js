import { ComponentProjection, Condition, Label, Match, PathCondition, Projection, Role, SingularProjection, Specification } from "./specification";
import { FactRecord, FactReference, factReferenceEquals, ProjectedResult, ReferencesByName } from "../storage";

export interface FactSource {
  findFact(reference: FactReference): FactRecord | null;
  getPredecessors(reference: FactReference, name: string, predecessorType: string): FactReference[];
  getSuccessors(reference: FactReference, name: string, successorType: string): FactRecord[];
  hydrate(reference: FactReference): unknown;
}

export class SpecificationRunner {
  constructor(
    private readonly source: FactSource
  ) { }

  read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
    if (start.length !== specification.given.length) {
      throw new Error(`The number of start references (${start.length}) must match the number of given facts (${specification.given.length}).`);
    }
    const references = start.reduce((references, reference, index) => ({
      ...references,
      [specification.given[index].name]: {
        type: reference.type,
        hash: reference.hash
      }
    }), {} as ReferencesByName);
    var products = this.executeMatchesAndProjection(references, specification.matches, specification.projection);
    return Promise.resolve(products);
  }

  private executeMatchesAndProjection(references: ReferencesByName, matches: Match[], projection: Projection): ProjectedResult[] {
    const tuples: ReferencesByName[] = this.executeMatches(references, matches);
    const products = tuples.map(tuple => this.createProduct(tuple, projection));
    return products;
  }

  private executeMatches(references: ReferencesByName, matches: Match[]): ReferencesByName[] {
    const results = matches.reduce(
      (tuples, match) => tuples.flatMap(
        tuple => this.executeMatch(tuple, match)
      ),
      [references]
    );
    return results;
  }

  private executeMatch(references: ReferencesByName, match: Match): ReferencesByName[] {
    let results: ReferencesByName[] = [];
    if (match.conditions.length === 0) {
      throw new Error("A match must have at least one condition.");
    }
    const firstCondition = match.conditions[0];
    if (firstCondition.type === "path") {
      const result: FactReference[] = this.executePathCondition(references, match.unknown, firstCondition);
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
      results = this.filterByCondition(references, match.unknown, results, condition);
    }
    return results;
  }

  private executePathCondition(references: ReferencesByName, unknown: Label, pathCondition: PathCondition): FactReference[] {
    if (!references.hasOwnProperty(pathCondition.labelRight)) {
      throw new Error(`The label ${pathCondition.labelRight} is not defined.`);
    }
    const start = references[pathCondition.labelRight];
    const predecessors = pathCondition.rolesRight.reduce(
      (set, role) => this.executePredecessorStep(set, role.name, role.predecessorType),
      [start]
    );
    const invertedRoles = invertRoles(pathCondition.rolesLeft, unknown.type);
    const results = invertedRoles.reduce(
      (set, role) => this.executeSuccessorStep(set, role.name, role.successorType),
      predecessors
    );
    return results;
  }

  private executePredecessorStep(set: FactReference[], name: string, predecessorType: string): FactReference[] {
    return set.flatMap(reference => this.source.getPredecessors(reference, name, predecessorType));
  }

  private executeSuccessorStep(set: FactReference[], name: string, successorType: string): FactReference[] {
    return set.flatMap(reference => this.source.getSuccessors(reference, name, successorType));
  }

  private filterByCondition(references: ReferencesByName, unknown: Label, results: ReferencesByName[], condition: Condition): ReferencesByName[] {
    if (condition.type === "path") {
      const otherResults = this.executePathCondition(references, unknown, condition);
      return results.filter(result => otherResults.some(factReferenceEquals(result[unknown.name])));
    }
    else if (condition.type === "existential") {
      var matchingReferences = results.filter(result => {
        const matches = this.executeMatches(result, condition.matches);
        return condition.exists ?
          matches.length > 0 :
          matches.length === 0;
      });
      return matchingReferences;
    }
    else {
      const _exhaustiveCheck: never = condition;
      throw new Error(`Unknown condition type: ${(condition as any).type}`);
    }
  }

  private createProduct(tuple: ReferencesByName, projection: Projection): ProjectedResult {
    if (projection.type === "composite") {
      const result = projection.components.reduce((obj, component) => ({
        ...obj,
        [component.name]: this.createComponent(tuple, component)
      }), {});
      return {
        tuple,
        result
      };
    }
    else {
      const result = this.createSingularProduct(tuple, projection);
      return {
        tuple,
        result
      };
    }
  }

  private createComponent(tuple: ReferencesByName, component: ComponentProjection): any {
    if (component.type === "specification") {
      return this.executeMatchesAndProjection(tuple, component.matches, component.projection);
    }
    else {
      return this.createSingularProduct(tuple, component);
    }
  }

  private createSingularProduct(tuple: ReferencesByName, projection: SingularProjection): any {
    if (projection.type === "fact") {
      if (!tuple.hasOwnProperty(projection.label)) {
        throw new Error(`The label ${projection.label} is not defined.`);
      }
      const reference = tuple[projection.label];
      return this.source.hydrate(reference);
    }
    else if (projection.type === "field") {
      if (!tuple.hasOwnProperty(projection.label)) {
        throw new Error(`The label ${projection.label} is not defined.`);
      }
      const reference = tuple[projection.label];
      const fact = this.source.findFact(reference);
      if (fact === null) {
        throw new Error(`The fact ${reference} is not defined.`);
      }
      const value: any = fact.fields[projection.field];
      if (value === undefined) {
        throw new Error(`The fact ${reference} does not have a field named ${projection.field}.`);
      }
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