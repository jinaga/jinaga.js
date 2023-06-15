import { EdgeDescription, FactDescription, Feed, InputDescription, NotExistsConditionDescription, OutputDescription } from "../specification/feed";
import { FactReference, Storage } from "../storage";
import { DistributionRules } from "./distribution-rules";

export class DistributionEngine {
  constructor(
    private distributionRules: DistributionRules,
    private store: Storage
  ) { }

  async canDistribute(targetFeed: Feed, start: FactReference[], user: FactReference | null): Promise<boolean> {
    for (const rule of this.distributionRules.rules) {
      for (const ruleFeed of rule.feeds) {
        if (feedsEqual(ruleFeed, targetFeed)) {
          return true;
        }
      }
    }

    return false;
  }
}

function feedsEqual(ruleFeed: Feed, targetFeed: Feed): boolean {
  // Compare the sets of facts.
  if (!compareSets(ruleFeed.facts, targetFeed.facts, factsEqual)) {
    return false;
  }

  // Compare the sets of inputs.
  if (!compareSets(ruleFeed.inputs, targetFeed.inputs, inputsEqual)) {
    return false;
  }

  // Compare the sets of edges.
  if (!compareSets(ruleFeed.edges, targetFeed.edges, edgesEqual)) {
    return false;
  }

  // Compare the sets of not-exists conditions.
  if (!compareSets(ruleFeed.notExistsConditions, targetFeed.notExistsConditions, notExistsConditionsEqual)) {
    return false;
  }

  // Do not compare the sets of outputs.
  // They don't affect the rows that match the specification.

  return true;
}

function factsEqual(ruleFact: FactDescription, targetFact: FactDescription): boolean {
  if (ruleFact.factType !== targetFact.factType) {
    return false;
  }
  if (ruleFact.factIndex !== targetFact.factIndex) {
    return false;
  }
  return true;
}

function inputsEqual(ruleInput: InputDescription, targetInput: InputDescription): boolean {
  if (ruleInput.factIndex !== targetInput.factIndex) {
    return false;
  }
  if (ruleInput.inputIndex !== targetInput.inputIndex) {
    return false;
  }
  return true;
}

function edgesEqual(ruleEdge: EdgeDescription, targetEdge: EdgeDescription): boolean {
  if (ruleEdge.edgeIndex !== targetEdge.edgeIndex) {
    return false;
  }
  if (ruleEdge.predecessorFactIndex !== targetEdge.predecessorFactIndex) {
    return false;
  }
  if (ruleEdge.successorFactIndex !== targetEdge.successorFactIndex) {
    return false;
  }
  if (ruleEdge.roleName !== targetEdge.roleName) {
    return false;
  }
  return true;
}

function notExistsConditionsEqual(ruleCondition: NotExistsConditionDescription, targetCondition: NotExistsConditionDescription): boolean {
  if (!compareSets(ruleCondition.edges, targetCondition.edges, edgesEqual)) {
    return false;
  }
  // Do not compare nested existential conditions.
  // These are not executed while generating feeds.
  return true;
}

function outputsEqual(ruleOutput: OutputDescription, targetOutput: OutputDescription): boolean {
  if (ruleOutput.factIndex !== targetOutput.factIndex) {
    return false;
  }
  return true;
}

function compareSets<T>(a: T[], b: T[], equals: (a: T, b: T) => boolean): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (const item of a) {
    if (!b.some(bItem => equals(item, bItem))) {
      return false;
    }
  }
  return true;
}