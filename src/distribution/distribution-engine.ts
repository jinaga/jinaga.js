import { User } from "../model/user";
import { alphaTransform } from "../specification/alpha";
import { describeSpecification } from "../specification/description";
import { EdgeDescription, FactDescription, InputDescription, NotExistsConditionDescription, Skeleton, skeletonOfSpecification } from "../specification/skeleton";
import { ExistentialCondition, Match, Specification, SpecificationGiven } from "../specification/specification";
import { FactReference, ReferencesByName } from "../storage";
import { DistributionRules } from "./distribution-rules";

export interface DistributionSuccess {
  type: 'success';
}

export interface DistributionFailure {
  type: 'failure';
  reason: string;
}

export type DistributionResult = DistributionSuccess | DistributionFailure;

export class DistributionEngine {
  constructor(
    private distributionRules: DistributionRules
  ) { }

  canDistributeToAll(targetFeeds: Specification[], namedStart: ReferencesByName, user: FactReference | null): DistributionResult {
    const reasons: string[] = [];
    for (const targetFeed of targetFeeds) {
      const feedResult = this.canDistributeTo(targetFeed, namedStart, user);
      if (feedResult.type === 'failure') {
        reasons.push(feedResult.reason);
      }
    }
    if (reasons.length > 0) {
      return {
        type: 'failure',
        reason: reasons.join('\n\n')
      };
    }
    else {
      return {
        type: 'success'
      };
    }
  }

  intersectSpecificationWithDistributionRule(specification: Specification, ruleSpecification: Specification): Specification {
    // Ensure that the rule specification has the same givens as the original specification.
    if (specification.given.length !== ruleSpecification.given.length) {
      throw new Error("The number of givens in the rule specification must match the number of givens in the original specification.");
    }
    if (!specification.given.every((given, index) => {
      const ruleGiven = ruleSpecification.given[index];
      return given.label.name === ruleGiven.label.name && given.label.type === ruleGiven.label.type;
    })) {
      throw new Error("The givens in the rule specification must match the givens in the original specification.");
    }

    // Ensure that the rule specification projects a user fact.
    const ruleProjection = ruleSpecification.projection;
    if (ruleProjection.type !== 'fact') {
      throw new Error("Distribution rule specification must have a fact projection.");
    }
    const distributionUserMatch = ruleSpecification.matches.find(match => match.unknown.name === ruleProjection.label);
    if (!distributionUserMatch) {
      throw new Error("Distribution rule specification must have a match for the projected user fact.");
    }
    if (distributionUserMatch.unknown.type !== User.Type) {
      throw new Error("Distribution rule specification must project a user fact.");
    }

    // Collect all labels from both specifications to avoid conflicts
    const originalLabels = new Set<string>();
    function collectLabels(spec: Specification) {
      spec.given.forEach(g => originalLabels.add(g.label.name));
      spec.matches.forEach(m => originalLabels.add(m.unknown.name));
      if (spec.projection.type === 'fact') {
        originalLabels.add(spec.projection.label);
      } else if (spec.projection.type === 'composite') {
        spec.projection.components.forEach(c => {
          if (c.type === 'fact' || c.type === 'field' || c.type === 'hash') {
            originalLabels.add(c.label);
          }
        });
      }
    }
    collectLabels(specification);
    collectLabels(ruleSpecification);

    // Collect unknown labels from rule specification (those not in given)
    const ruleUnknowns = new Set<string>();
    ruleSpecification.matches.forEach(m => {
      if (!ruleSpecification.given.some(g => g.label.name === m.unknown.name)) {
        ruleUnknowns.add(m.unknown.name);
      }
    });

    // Create mapping for alpha transformation with "dist_" prefix
    const mapping: Record<string, string> = {};
    for (const unknown of ruleUnknowns) {
      let newName = "dist_" + unknown;
      let counter = 1;
      while (originalLabels.has(newName)) {
        newName = "dist_" + unknown + counter;
        counter++;
      }
      mapping[unknown] = newName;
      originalLabels.add(newName); // Prevent conflicts with subsequent mappings
    }

    // Apply alpha transformation to rule specification
    const transformedRuleSpec = alphaTransform(ruleSpecification, mapping);

    // Find the distribution user match in the transformed spec
    if (transformedRuleSpec.projection.type !== 'fact') {
      throw new Error("Transformed rule specification must have a fact projection.");
    }
    const transformedDistributionUserMatch = transformedRuleSpec.matches.find(match => match.unknown.name === (transformedRuleSpec.projection as any).label);
    if (!transformedDistributionUserMatch) {
      throw new Error("Transformed rule specification must have a match for the projected user fact.");
    }

    // Replace the distribution user match with one that has an extra path condition:
    // that the distribution user is equal to the `distributionUser` given fact.
    const updatedDistributionUserMatch: Match = {
      ...transformedDistributionUserMatch,
      conditions: [
        ...transformedDistributionUserMatch.conditions,
        {
          type: "path",
          labelRight: "distributionUser",
          rolesLeft: [],
          rolesRight: []
        }
      ]
    };
    const updatedMatches = transformedRuleSpec.matches.map(match =>
      match === transformedDistributionUserMatch ? updatedDistributionUserMatch : match
    );

    // Create an existential condition for the `distributionUser` given.
    // That is, there exists a fact defined by the rule specification where the distribution user
    // match unknown is equal to the `distributionUser` given.
    const existentialCondition: ExistentialCondition = {
      type: "existential",
      exists: true,
      matches: updatedMatches
    };

    // Create a new given that represents the user running the specification.
    const distributionUserGiven: SpecificationGiven = {
      label: {
        name: "distributionUser",
        type: User.Type
      },
      conditions: [existentialCondition]
    };

    // Insert the new given into the original specification's givens.
    const updatedSpecification: Specification = {
      ...specification,
      given: [
        ...specification.given,
        distributionUserGiven
      ]
    };

    return updatedSpecification;
  }

  private canDistributeTo(targetFeed: Specification, namedStart: ReferencesByName, user: FactReference | null): DistributionResult {
    const start = targetFeed.given.map(g => namedStart[g.label.name]);
    const targetSkeleton = skeletonOfSpecification(targetFeed);
    for (const rule of this.distributionRules.rules) {
      for (const ruleFeed of rule.feeds) {
        const ruleSkeleton = skeletonOfSpecification(ruleFeed);
        const permutations = permutationsOf(start, ruleSkeleton, targetSkeleton);
        for (const permutation of permutations) {
          if (skeletonsEqual(ruleSkeleton, targetSkeleton)) {
            // Check if the user is authorized for this rule
            if (rule.user === null) {
              // Rule allows everyone
              return {
                type: 'success'
              };
            }
            if (user) {
              return {
                type: 'success'
              };
            }
          }
        }
      }
    }

    return {
      type: 'failure',
      reason: `Cannot distribute to ${describeSpecification(targetFeed, 0)}\nNo rules apply to this feed.`
    };
  }
}

function skeletonsEqual(ruleSkeleton: Skeleton, targetSkeleton: Skeleton): boolean {
  // Compare the sets of facts.
  if (!compareSets(ruleSkeleton.facts, targetSkeleton.facts, factsEqual)) {
    return false;
  }

  // Do not compare the sets of inputs.
  // The matching permutation has already been calculated.

  // Compare the sets of edges.
  if (!compareSets(ruleSkeleton.edges, targetSkeleton.edges, edgesEqual)) {
    return false;
  }

  // Compare the sets of not-exists conditions.
  if (!compareSets(ruleSkeleton.notExistsConditions, targetSkeleton.notExistsConditions, notExistsConditionsEqual)) {
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

function permutationsOf(start: FactReference[], ruleSkeleton: Skeleton, targetSkeleton: Skeleton): FactReference[][] {
  function permute(
    ruleInputs: InputDescription[],
    targetInputs: InputDescription[]
  ): FactReference[][] {
    // If there are no more rule inputs, then end the recursion.
    // We have found one matching permutation.
    if (ruleInputs.length === 0) {
      return [[]];
    }

    const [ ruleInput, ...remainingRuleInputs ] = ruleInputs;
    const ruleFact = ruleSkeleton.facts.find(f => f.factIndex === ruleInput.factIndex);
    if (!ruleFact) {
      throw new Error(`Rule fact index ${ruleInput.factIndex} was not found.`);
    }
    // Find all of the target inputs that match the first rule input.
    return targetInputs.flatMap((targetInput, targetIndex) => {
      const targetFact = targetSkeleton.facts.find(f => f.factIndex === targetInput.factIndex);
      if (!targetFact) {
        throw new Error(`Target fact index ${targetInput.factIndex} was not found.`);
      }
      if (targetFact.factType !== ruleFact.factType) {
        return [];
      }

      // Remove the target input from the set of candidates.
      const remainingTargetInputs = targetInputs.slice(0, targetIndex)
        .concat(targetInputs.slice(targetIndex + 1));

      // Recursively find all permutations of the remainder.
      return permute(remainingRuleInputs, remainingTargetInputs)
        .map(permutation => {
          permutation[ruleInput.inputIndex] = start[targetInput.inputIndex];
          return permutation;
        });
    });
  }

  const permutations = permute(ruleSkeleton.inputs, targetSkeleton.inputs);
  return permutations;
}