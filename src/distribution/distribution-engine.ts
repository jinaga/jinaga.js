import { EdgeDescription, FactDescription, Feed, InputDescription, NotExistsConditionDescription, OutputDescription } from "../specification/feed";
import { FactReference, Storage, factReferenceEquals } from "../storage";
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
          // If this rule applies to any user, then we can distribute.
          if (rule.user === null) {
            return true;
          }

          // If there is no user logged in, then we cannot distribute.
          if (user === null) {
            return false;
          }

          // The projection must be a singular label.
          if (rule.user.projection.type !== 'fact') {
            throw new Error('The projection must be a singular label.');
          }
          const label = rule.user.projection.label;

          // Find the set of users to whom we can distribute this feed.
          const users = await this.store.read(start, rule.user);
          const results = users.map(user => user.tuple[label])

          // If any of the results match the user, then we can distribute to the user.
          const authorized = results.some(factReferenceEquals(user));
          return authorized;
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