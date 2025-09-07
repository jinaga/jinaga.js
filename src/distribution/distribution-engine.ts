import { describeSpecification } from "../specification/description";
import { EdgeDescription, FactDescription, InputDescription, NotExistsConditionDescription, Skeleton, skeletonOfSpecification } from "../specification/skeleton";
import { Specification, isPathCondition, specificationIsIdentity, Label, Match, PathCondition, ExistentialCondition, Projection } from "../specification/specification";
import { FactReference, ReferencesByName, Storage, factReferenceEquals } from "../storage";
import { DistributionRules } from "./distribution-rules";
import { User } from "../model/user";

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
    private distributionRules: DistributionRules,
    private store: Storage,
    private isTest: boolean = false
  ) { }

  async canDistributeToAll(targetFeeds: Specification[], namedStart: ReferencesByName, user: FactReference | null): Promise<DistributionResult> {
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

  intersectSpecificationWithDistributionRule(specification: Specification, ruleSpecification: Specification): Specification {
    // Handle edge cases: empty specs
    if (specification.given.length === 0 && specification.matches.length === 0) {
      return specification;
    }

    // Handle invalid rules: no projection or not a fact projection
    if (ruleSpecification.projection.type !== 'fact') {
      throw new Error('Distribution rule specification must have a fact projection');
    }

    const userLabel = ruleSpecification.projection.label;

    // 1. Add distribution user as new given with type Jinaga.User
    const distributionUserLabel: Label = {
      name: 'distributionUser',
      type: User.Type
    };
    const newGiven = [...specification.given, { label: distributionUserLabel, conditions: [] }];

    // 2. Create existential condition from distribution rule specification
    // 3. Add path condition equating projected user with distribution user
    const pathCondition: PathCondition = {
      type: 'path',
      rolesLeft: [],
      labelRight: 'distributionUser',
      rolesRight: []
    };

    // Find the match that defines the user label and add the path condition
    const updatedRuleMatches = ruleSpecification.matches.map(match => {
      if (match.unknown.name === userLabel) {
        return {
          ...match,
          conditions: [...match.conditions, pathCondition]
        };
      }
      return match;
    });

    const existentialCondition: ExistentialCondition = {
      type: 'existential',
      exists: true,
      matches: updatedRuleMatches
    };

    // Add the existential condition to the original specification's matches
    // For simplicity, add it to the first match if exists, or create a new match
    let newMatches: Match[];
    if (specification.matches.length > 0) {
      newMatches = specification.matches.map((match, index) => {
        if (index === 0) {
          return {
            ...match,
            conditions: [...match.conditions, existentialCondition]
          };
        }
        return match;
      });
    } else {
      // If no matches, create a dummy match to hold the existential condition
      const dummyMatch: Match = {
        unknown: { name: 'dummy', type: 'Dummy' },
        conditions: [existentialCondition]
      };
      newMatches = [dummyMatch];
    }

    // 5. Preserve original specification semantics when condition is satisfied
    // The existential condition ensures the rule is satisfied, so original semantics are preserved

    // 6. Return empty results when distribution condition fails
    // If the existential condition is not satisfied, the query will return no results

    // Verify conditions collections remain empty as required
    newGiven.forEach((given, index) => {
      if (given.conditions.length > 0) {
        console.warn(`Warning: conditions collection at index ${index} is not empty:`, given.conditions);
      }
    });

    return {
      given: newGiven,
      matches: newMatches,
      projection: specification.projection
    };
  }

  private async canDistributeTo(targetFeed: Specification, namedStart: ReferencesByName, user: FactReference | null): Promise<DistributionResult> {
    const start = targetFeed.given.map(g => namedStart[g.label.name]);
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
            }
            else {
              // The projection must be a singular label.
              if (rule.user.projection.type !== 'fact') {
                throw new Error('The projection must be a singular label.');
              }
              const label = rule.user.projection.label;

              // If the user specification is deterministic, then pick the labeled given.
              if (specificationIsIdentity(rule.user)) {
                const userReference = executeDeterministicSpecification(rule.user, label, permutation);
                // If the user matches the given, then we can distribute to the user.
                const authorized = factReferenceEquals(user)(userReference);
                if (authorized) {
                  return {
                    type: 'success'
                  };
                }
                
                if (this.isTest) {
                  reasons.push(
                    `The user does not match ${describeSpecification(rule.user, 0)}.\n` +
                    `User hash: ${user.hash}\n` +
                    `Expected hash: ${userReference.hash}`
                  );
                } else {
                  reasons.push(`The user does not match ${describeSpecification(rule.user, 0)}`);
                }
              }
              else {
                // Find the set of users to whom we can distribute this feed.
                const users = await this.store.read(permutation, rule.user);
                const results = users.map(user => user.tuple[label])

                // If any of the results match the user, then we can distribute to the user.
                const authorized = results.some(factReferenceEquals(user));
                if (authorized) {
                  return {
                    type: 'success'
                  };
                }
                
                if (this.isTest) {
                  reasons.push(
                    `The user does not match ${describeSpecification(rule.user, 0)}.\n` +
                    `User hash: ${user.hash}\n` +
                    `Expected hashes: [${results.map(r => r.hash).join(", ")}]`
                  );
                } else {
                  reasons.push(`The user does not match ${describeSpecification(rule.user, 0)}`);
                }
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

    function executeDeterministicSpecification(specification: Specification, label: string, permutation: FactReference[]) {
      // If the label is a given, then return the associated fact reference.
      const givenIndex = specification.given.findIndex(g => g.label.name === label);
      if (givenIndex !== -1) {
        const userReference = permutation[givenIndex];
        return userReference;
      }

      // Find the match with the unknown matching the projected label.
      const match = specification.matches.find(m => m.unknown.name === label);
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
      const index = specification.given.findIndex(g => g.label.name === referencedLabel);
      if (index === -1) {
        throw new Error(`The user specification must have a given labeled '${label}'.`);
      }
      const userReference = permutation[index];
      return userReference;
    }
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