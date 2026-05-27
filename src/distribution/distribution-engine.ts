import { User } from "../model/user";
import { describeSpecification } from "../specification/description";
import { buildFeeds } from "../specification/feed-builder";
import { EdgeDescription, FactDescription, InputDescription, NotExistsConditionDescription, Skeleton, skeletonOfSpecification } from "../specification/skeleton";
import { Specification, isPathCondition, specificationIsIdentity } from "../specification/specification";
import { intersectSpecificationWithDistributionRule } from "../specification/specification-intersection";
import { FactReference, ReferencesByName, Storage, factReferenceEquals } from "../storage";
import { canAuthorizeByComposition } from "./distribution-composition";
import { DistributionRules } from "./distribution-rules";

export interface DistributionIntersectionResult {
  /**
   * The specification to use going forward. Either the original (when the
   * user is already authorized, or no applicable rule was found) or a new
   * spec with a synthetic `distributionUser` given that filters results by
   * the rule's user pattern.
   */
  specification: Specification;
  /**
   * Aligned with `specification.given`. When intersection occurred, this is
   * the original `start` with the user's fact reference appended in the
   * position of the new `distributionUser` given.
   */
  start: FactReference[];
  /**
   * True when the intersection algorithm rewrote the specification. False
   * when the original spec was returned unchanged.
   */
  intersected: boolean;
}

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

    // No single rule matched the target feed (or the user did not satisfy
    // the matching rules). Try compositional authorization: if the target
    // can be covered by a sequence of rules that each authorize the user,
    // then the target is authorized.
    if (await canAuthorizeByComposition(targetFeed, namedStart, user, this.distributionRules, this.store)) {
      return { type: 'success' };
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

  /**
   * Compose a specification with a distribution rule's user specification so
   * the result set is naturally gated by the rule. Exposed for unit testing
   * the algorithm; runtime callers should prefer `intersectForSubscribe`,
   * which only intersects when the user isn't already authorized.
   */
  intersectSpecificationWithDistributionRule(specification: Specification, ruleSpecification: Specification): Specification {
    return intersectSpecificationWithDistributionRule(specification, ruleSpecification);
  }

  /**
   * Phase 3 of the j.subscribe trust release. Asks: can this subscribe call
   * proceed as-is, or do we need to compose the spec with a distribution
   * rule so it filters by an authorizing fact that hasn't arrived yet?
   *
   * - If the user is already authorized (single rule or compositional
   *   fallback), returns the original spec/start unchanged — no work to do.
   * - If a single rule's share-spec matches the target spec by skeleton but
   *   the user doesn't currently satisfy its user-spec, intersects with that
   *   rule. The subscriber sees empty results until the auth fact arrives,
   *   at which point the existing inverse engine surfaces them.
   * - If no applicable rule was found at all, returns the original spec; the
   *   query path will continue to fail authorization, which is the right
   *   behavior — Phase 3 doesn't relax authorization, it makes it reactive.
   */
  async intersectForSubscribe(
    start: FactReference[],
    specification: Specification,
    user: FactReference | null
  ): Promise<DistributionIntersectionResult> {
    const namedStart = specification.given.reduce((map, given, index) => ({
      ...map,
      [given.label.name]: start[index]
    }), {} as ReferencesByName);

    const targetFeeds = buildFeeds(specification);
    const authResult = await this.canDistributeToAll(targetFeeds, namedStart, user);
    if (authResult.type === 'success') {
      return { specification, start, intersected: false };
    }

    // The user isn't authorized via any single rule or via composition. See
    // if any rule's share-spec applies to the user's spec (same shape by
    // skeleton) and has a non-null user-spec — that's the rule whose auth
    // condition we'll intersect.
    const matchingRule = findRuleForIntersection(specification, this.distributionRules, targetFeeds);
    if (!matchingRule) {
      return { specification, start, intersected: false };
    }

    const intersected = intersectSpecificationWithDistributionRule(specification, matchingRule);
    // The synthetic `distributionUser` given is bound to the logged-in user.
    // When no user is logged in, fall back to a sentinel reference — the
    // existential will then never be satisfied (no User fact will ever
    // match), so the subscription stays empty until login + auth fact both
    // exist. Normalize to a bare {type, hash} so the observer's tuple hash
    // matches the inverse engine's tuple hash byte-for-byte (the user fact
    // from JinagaTest carries dehydrated predecessors/fields that the
    // spec runner discards).
    const userRef: FactReference = user
      ? { type: user.type, hash: user.hash }
      : { type: User.Type, hash: "" };
    return {
      specification: intersected,
      start: [...start, userRef],
      intersected: true
    };
  }
}

/**
 * Pick a rule whose share-specification matches the target spec by skeleton
 * and whose user-spec has compatible given types. Returns null when no rule
 * is applicable, or when more than one rule matches (ambiguity — see below).
 *
 * Ambiguity bail-out: if two rules both share the target shape but to
 * different user sets (e.g. share with administrators OR share with
 * creators), picking the first rule arbitrarily would make subscription
 * activation depend on rule ordering. A user authorized only by the
 * *other* rule would see the subscription stay empty forever, even though
 * a valid authorization path exists. The right semantics is the union (OR)
 * of all applicable user-specs, but the spec language has no OR primitive;
 * until it does, we refuse to intersect in the ambiguous case so the
 * subscribe call falls back to the existing "Not authorized" failure
 * rather than to a silently-inactivatable subscription.
 */
function findRuleForIntersection(
  specification: Specification,
  distributionRules: DistributionRules,
  targetFeeds: Specification[]
): Specification | null {
  const targetSkeletons = targetFeeds.map(f => skeletonOfSpecification(f));
  const matches: Specification[] = [];
  for (const rule of distributionRules.rules) {
    if (rule.user === null) continue;
    for (const ruleFeed of rule.feeds) {
      const ruleSkeleton = skeletonOfSpecification(ruleFeed);
      if (!targetSkeletons.some(ts => skeletonsEqual(ruleSkeleton, ts))) continue;
      // The intersection algorithm requires the rule's user-spec and the
      // target spec to share given counts and types.
      if (rule.user.given.length !== specification.given.length) continue;
      const typesAlign = rule.user.given.every((g, i) =>
        g.label.type === specification.given[i].label.type
      );
      if (!typesAlign) continue;
      matches.push(rule.user);
      break; // One match per rule is enough.
    }
  }
  if (matches.length !== 1) {
    return null;
  }
  return matches[0];
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