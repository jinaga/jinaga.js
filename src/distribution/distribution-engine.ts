import { describeSpecification } from "../specification/description";
import { EdgeDescription, FactDescription, Skeleton, InputDescription, NotExistsConditionDescription, skeletonOfSpecification } from "../specification/skeleton";
import { Specification, isPathCondition, specificationIsIdentity } from "../specification/specification";
import { FactReference, Storage, factReferenceEquals } from "../storage";
import { DistributionRules } from "./distribution-rules";

export interface DistributionSuccess {
  type: 'success';
}

export interface DistributionFailure {
  type: 'failure';
  reason: string;
}

export type DistributionResult = DistributionSuccess | DistributionFailure;

export type FactReferenceByName = { [name: string]: FactReference };

export class DistributionEngine {
  constructor(
    private distributionRules: DistributionRules,
    private store: Storage
  ) { }

  async canDistributeToAll(targetFeeds: Specification[], namedStart: FactReferenceByName, user: FactReference | null): Promise<DistributionResult> {
    // TODO: Minimize the number hits to the database.
    const reasons: string[] = [];
    for (const targetFeed of targetFeeds) {
      const feedResult = await this.canDistributeTo(targetFeed, namedStart, user);
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

  private async canDistributeTo(targetFeed: Specification, namedStart: FactReferenceByName, user: FactReference | null): Promise<DistributionResult> {
    const start = targetFeed.given.map(g => namedStart[g.name]);
    const targetSkeleton = skeletonOfSpecification(targetFeed);
    const reasons: string[] = [];
    for (const rule of this.distributionRules.rules) {
      for (const ruleFeed of rule.feeds) {
        const ruleSkeleton = skeletonOfSpecification(ruleFeed);
        const permutations = permutationsOf(start, ruleSkeleton, targetSkeleton);
        for (const permutation of permutations) {
          if (skeletonsEqual(ruleSkeleton, targetSkeleton)) {
            // If this rule applies to any user, then we can distribute.
            if (rule.user === null) {
              return {
                type: 'success'
              };
            }

            // If there is no user logged in, then we cannot distribute.
            if (user === null) {
              if (reasons.length === 0) {
                reasons.push(`User is not logged in.`);
              }
              continue;
            }

            // The projection must be a singular label.
            if (rule.user.projection.type !== 'fact') {
              throw new Error('The projection must be a singular label.');
            }
            const label = rule.user.projection.label;

            // If the user specification is the identity, then pick the labeled given.
            if (specificationIsIdentity(rule.user)) {
              // Find the match with the unknown matching the projected label.
              const match = rule.user.matches.find(m => m.unknown.name === label);
              if (!match) {
                throw new Error(`The user specification must have a match with an unknown labeled '${label}'.`);
              }
              // Find the right-hand side of the path condition in that match.
              const referencedLabels = match.conditions
                .filter(isPathCondition)
                .map(c => c.labelRight);
              if (referencedLabels.length !== 1) {
                throw new Error(`The user specification must have exactly one path condition with an unknown labeled '${label}'.`);
              }
              const referencedLabel = referencedLabels[0];
              // Find the given that the match references.
              const index = rule.user.given.findIndex(g => g.name === referencedLabel);
              if (index === -1) {
                throw new Error(`The user specification must have a given labeled '${label}'.`);
              }
              const userReference = permutation[index];
              // If the user matches the given, then we can distribute to the user.
              const authorized = factReferenceEquals(user)(userReference);
              if (!authorized) {
                reasons.push(`The user does not match ${describeSpecification(rule.user, 0)}`);
                continue;
              }
              else {
                return {
                  type: 'success'
                };
              }
            }
            else {
              // Find the set of users to whom we can distribute this feed.
              const users = await this.store.read(permutation, rule.user);
              const results = users.map(user => user.tuple[label])

              // If any of the results match the user, then we can distribute to the user.
              const authorized = results.some(factReferenceEquals(user));
              if (!authorized) {
                reasons.push(`The user does not match ${describeSpecification(rule.user, 0)}`);
                continue;
              }
              else {
                return {
                  type: 'success'
                };
              }
            }
          }
        }
      }
    }

    if (reasons.length === 0) {
      reasons.push("No rules apply to this feed.");
    }
    return {
      type: 'failure',
      reason: `Cannot distribute to ${describeSpecification(targetFeed, 0)}${reasons.join('\n')}`
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