import { User } from "../model/user";
import { describeSpecification } from "../specification/description";
import { computeFeedHash } from "../specification/feed-cache";
import { buildFeeds } from "../specification/feed-builder";
import { EdgeDescription, FactDescription, InputDescription, NotExistsConditionDescription, Skeleton, skeletonOfSpecification } from "../specification/skeleton";
import { Specification, isPathCondition, specificationIsIdentity } from "../specification/specification";
import { intersectSpecificationWithDistributionRule } from "../specification/specification-intersection";
import { FactReference, ReferencesByName, Storage, factReferenceEquals } from "../storage";
import { canAuthorizeByComposition } from "./distribution-composition";
import { DistributionRules } from "./distribution-rules";

export interface DistributionIntersectionBranch {
  /**
   * Aligned with `specification.given`. When intersection occurred, this is
   * the original `start` with the user's fact reference appended in the
   * position of the synthetic `distributionUser` given.
   */
  start: FactReference[];
  /**
   * The specification for this branch. Either the original (passthrough) or
   * a spec with a synthetic `distributionUser` given that filters results
   * by one rule's user pattern.
   */
  specification: Specification;
}

export interface DistributionIntersectionResult {
  /**
   * One branch per matching distribution rule. Multiple branches express
   * OR semantics across rules (a row is authorized if any branch's auth
   * pattern is satisfied). For passthrough (already authorized, or no
   * applicable rule) the array has length 1 and carries the original
   * `(start, specification)` unchanged.
   */
  branches: DistributionIntersectionBranch[];
  /**
   * True when the intersection algorithm produced rewritten specs. False
   * when the original spec was returned unchanged in a single branch.
   */
  intersected: boolean;
}

/**
 * A discriminant that categorizes *why* a feed could not be distributed. The
 * categories split by whether the outcome can self-heal when a fact later
 * arrives (see issue #207):
 *
 * - `no-matching-rule` / `spec-more-restrictive-than-rule` are structural
 *   authoring errors: no rule covers the feed, so it can never self-heal.
 * - `principal-excluded` means a rule's shape matched but the logged-in user
 *   is not among those it authorizes.
 * - `not-authenticated` means a rule's shape matched but no user is logged in.
 *
 * Note: a "rule too restrictive" outcome is not a distinct engine state — it
 * surfaces as `principal-excluded`. Do not add a code the engine cannot
 * produce.
 */
export type DistributionDenialCode =
  | 'no-matching-rule'
  | 'spec-more-restrictive-than-rule'  // produced by the near-miss classification pass
  | 'principal-excluded'
  | 'not-authenticated';

export interface DistributionSuccess {
  type: 'success';
}

/**
 * The per-feed detail behind a distribution failure. `feed` is the same
 * URL-safe hash the client uses to fetch the feed, so callers can correlate a
 * denial with a specific feed.
 */
export interface DistributionPerFeedFailure {
  feed: string;
  code: DistributionDenialCode;
  reason: string;
}

export interface DistributionFailure {
  type: 'failure';
  reason: string;
  code: DistributionDenialCode;
  perFeed: DistributionPerFeedFailure[];
}

export type DistributionResult = DistributionSuccess | DistributionFailure;

/**
 * The single-feed result computed by `canDistributeTo`. It carries a code and
 * reason but not the per-feed array or feed hash; `canDistributeToAll`
 * assembles those into the aggregate `DistributionFailure`.
 */
interface PerFeedFailure {
  type: 'failure';
  reason: string;
  code: DistributionDenialCode;
}

type PerFeedResult = DistributionSuccess | PerFeedFailure;

/**
 * Relative actionability of the denial codes. `canDistributeToAll` reports the
 * most-actionable code across all failing feeds: structural authoring errors
 * first (a too-narrow spec is the most specific), then principal exclusion,
 * then missing authentication.
 */
const denialCodePriority: { [code in DistributionDenialCode]: number } = {
  'spec-more-restrictive-than-rule': 4,
  'no-matching-rule': 3,
  'principal-excluded': 2,
  'not-authenticated': 1,
};

export class DistributionEngine {
  constructor(
    private distributionRules: DistributionRules,
    private store: Storage,
    private isTest: boolean = false
  ) { }

  async canDistributeToAll(targetFeeds: Specification[], namedStart: ReferencesByName, user: FactReference | null): Promise<DistributionResult> {
    // TODO: Minimize the number hits to the database.
    const perFeed: DistributionPerFeedFailure[] = [];
    for (const targetFeed of targetFeeds) {
      const feedResult = await this.canDistributeTo(targetFeed, namedStart, user);
      if (feedResult.type === 'failure') {
        perFeed.push({
          feed: computeFeedHash(targetFeed, namedStart),
          code: feedResult.code,
          reason: feedResult.reason
        });
      }
    }
    if (perFeed.length > 0) {
      // Pick the most-actionable code across all failing feeds while keeping
      // the full per-feed detail for callers that want to inspect it.
      const code = perFeed.reduce((most, f) =>
        denialCodePriority[f.code] > denialCodePriority[most] ? f.code : most,
        perFeed[0].code);
      return {
        type: 'failure',
        reason: perFeed.map(f => f.reason).join('\n\n'),
        code,
        perFeed
      };
    }
    else {
      return {
        type: 'success'
      };
    }
  }

  private async canDistributeTo(targetFeed: Specification, namedStart: ReferencesByName, user: FactReference | null): Promise<PerFeedResult> {
    const start = targetFeed.given.map(g => namedStart[g.label.name]);
    const targetSkeleton = skeletonOfSpecification(targetFeed);
    const reasons: string[] = [];
    for (const rule of this.distributionRules.rules) {
      for (const ruleFeed of rule.feeds) {
        const ruleSkeleton = skeletonOfSpecification(ruleFeed);
        // A rule's feed authorizes its own shape exactly, and also any feed
        // whose shape is a connected sub-portion of the rule feed (rooted at
        // the same inputs) — e.g. a direct query for an intermediate fact that
        // the rule only traverses through on its way to a projected leaf
        // (`Event -> Finalist` covered by a rule that projects
        // `Event -> Finalist -> Competitor -> CompetitorName`). `skeletonContains`
        // only admits sub-feeds whose every output fact the rule already
        // delivers (see its soundness argument), so this grants no data beyond
        // what the rule authorizes. This engine backs both JinagaTest and the
        // real replicator (jinaga-server), so they stay in lock-step. See #204.
        //
        // The shape match depends only on the two skeletons, not on the
        // permutation, so evaluate it once and skip the feed before enumerating
        // permutations (which can be many when givens share a type).
        if (!skeletonsEqual(ruleSkeleton, targetSkeleton) &&
            !skeletonContains(ruleSkeleton, targetSkeleton)) {
          continue;
        }
        const permutations = permutationsOf(start, ruleSkeleton, targetSkeleton);
        for (const permutation of permutations) {
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

    // No single rule matched the target feed (or the user did not satisfy
    // the matching rules). Try compositional authorization: if the target
    // can be covered by a sequence of rules that each authorize the user,
    // then the target is authorized.
    if (await canAuthorizeByComposition(targetFeed, namedStart, user, this.distributionRules, this.store)) {
      return { type: 'success' };
    }

    if (reasons.length === 0) {
      // No rule's shape matched the target at all. Run the diagnostic-only
      // near-miss pass (W2, off the hot path): is the target a *narrower*
      // version of some rule — i.e. does it contain all of a rule's facts,
      // edges, and not-exists conditions plus additional positive structure
      // the rule lacks? If so, the developer narrowed the spec past the rule
      // rather than simply having no rule at all.
      const nearMissRule = findNearMissRule(targetSkeleton, this.distributionRules);
      if (nearMissRule !== null) {
        return {
          type: 'failure',
          code: 'spec-more-restrictive-than-rule',
          reason: `Cannot distribute to ${describeSpecification(targetFeed, 0)}` +
            `The specification is more restrictive than the distribution rule ` +
            `${describeSpecification(nearMissRule, 0)}`
        };
      }
      return {
        type: 'failure',
        code: 'no-matching-rule',
        reason: `Cannot distribute to ${describeSpecification(targetFeed, 0)}No rules apply to this feed.`
      };
    }

    // A rule's shape matched but authorization failed. When no user is logged
    // in this is `not-authenticated`; otherwise the user is not among those the
    // matching rule authorizes (`principal-excluded`).
    return {
      type: 'failure',
      code: user === null ? 'not-authenticated' : 'principal-excluded',
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
   * proceed as-is, or do we need to compose the spec with distribution
   * rules so it filters by an authorizing fact that hasn't arrived yet?
   *
   * - If the user is already authorized (single rule or compositional
   *   fallback), returns one passthrough branch with the original
   *   spec/start — no work to do.
   * - If one or more rules' share-specs match the target spec by skeleton
   *   but the user doesn't currently satisfy any user-spec, returns one
   *   intersected branch *per* matching rule. The observer subscribes to
   *   all branches in parallel; a row is delivered when any branch's auth
   *   pattern fires (OR semantics).
   * - If no applicable rule was found at all, returns one passthrough
   *   branch; the query path will continue to fail authorization, which is
   *   the right behavior — Phase 3 doesn't relax authorization, it makes
   *   it reactive.
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
      return { branches: [{ start, specification }], intersected: false };
    }

    // The user isn't authorized via any single rule or via composition. See
    // which rules' share-specs apply to the user's spec (same shape by
    // skeleton) and have non-null user-specs — those are the rules whose
    // auth conditions become OR-branches.
    const matchingRules = findRulesForIntersection(specification, this.distributionRules, targetFeeds);
    if (matchingRules.length === 0) {
      return { branches: [{ start, specification }], intersected: false };
    }

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
    const branches: DistributionIntersectionBranch[] = matchingRules.map(ruleUserSpec => ({
      start: [...start, userRef],
      specification: intersectSpecificationWithDistributionRule(specification, ruleUserSpec)
    }));
    return { branches, intersected: true };
  }
}

/**
 * Find every rule whose share-specification matches the target spec by
 * skeleton and whose user-spec has compatible given types. Returns the
 * rule user-specs in declaration order; an empty array means no rule is
 * applicable. Multiple matches express OR semantics: any one of the
 * returned user-specs being satisfied authorizes the subscriber.
 *
 * The observer subscribes to one intersected branch per returned rule and
 * deduplicates results across branches, so picking up multiple rules here
 * is the path that lets a user authorized by *any* of them see the feed
 * once the corresponding auth fact arrives.
 */
function findRulesForIntersection(
  specification: Specification,
  distributionRules: DistributionRules,
  targetFeeds: Specification[]
): Specification[] {
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
  return matches;
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

/**
 * True when `targetSkeleton` is a *sound* sub-feed of `ruleSkeleton`: the target
 * keeps a subset of the rule's facts and the rule delivers every fact the target
 * outputs, so authorizing the rule legitimately authorizes the target.
 *
 * `buildFeeds` assigns fact/edge indices by a deterministic walk outward from
 * the givens, so a target that is a prefix of the rule's traversal carries the
 * same indices and the existing index-based predicates line up. The caller has
 * already matched inputs via `permutationsOf`.
 *
 * Soundness hinges on *which* facts the target drops:
 *  - Dropping a fact reached by a **predecessor** join (e.g. the `Competitor` of
 *    a `Finalist`) is safe: every successor carries all its predecessors, so the
 *    rule delivers the same output set with or without that fact in the feed.
 *  - Dropping a fact reached by a **successor** join or existential (e.g. the
 *    `Publish` that a "published posts" rule requires of each `Post`) is NOT
 *    safe: that fact restricts the rule's output, and a target lacking it would
 *    see more than the rule grants.
 * So a dropped fact may only appear predecessor-ward of the kept facts: no rule
 * edge may run from a kept fact to a dropped successor.
 *
 * This lets an authorized user run a direct query for a fact a projection rule
 * only traverses through (issue #204), without declaring a redundant flat rule.
 * The same engine authorizes JinagaTest and the real replicator (jinaga-server),
 * so the relaxation applies uniformly to both.
 */
function skeletonContains(ruleSkeleton: Skeleton, targetSkeleton: Skeleton): boolean {
  // Every target fact must be a rule fact.
  if (!isSubsetOf(targetSkeleton.facts, ruleSkeleton.facts, factsEqual)) {
    return false;
  }

  const keptFactIndices = new Set(targetSkeleton.facts.map(f => f.factIndex));
  const isKept = (factIndex: number) => keptFactIndices.has(factIndex);

  // A rule edge leading (as a successor join) to a dropped fact is a restriction
  // the target lacks, so the target is not covered. Only predecessor-ward facts
  // (present for every successor) may be dropped.
  for (const edge of ruleSkeleton.edges) {
    if (!isKept(edge.successorFactIndex) && isKept(edge.predecessorFactIndex)) {
      return false;
    }
  }

  // The target must preserve exactly the rule's structure among the facts it
  // keeps: every rule edge between two kept facts must be present, and the
  // target may not introduce edges the rule lacks.
  const ruleEdgesAmongKept = ruleSkeleton.edges.filter(e =>
    isKept(e.predecessorFactIndex) && isKept(e.successorFactIndex));
  if (!compareSets(targetSkeleton.edges, ruleEdgesAmongKept, edgesEqual)) {
    return false;
  }

  // The target must be at least as restrictive as the rule: every not-exists
  // condition the rule imposes must also appear in the target.
  if (!isSubsetOf(ruleSkeleton.notExistsConditions, targetSkeleton.notExistsConditions, notExistsConditionsEqual)) {
    return false;
  }

  return true;
}

/**
 * Diagnostic-only near-miss classification (W2, issue #207). Runs only when no
 * rule matched the target by shape (equal or sound sub-feed), so it is off the
 * hot path. Returns the first rule feed whose skeleton is a *proper subset* of
 * the target skeleton — meaning the target keeps every fact, edge, and
 * not-exists condition of the rule and adds at least one positive fact, join,
 * or condition the rule lacks. That is the "spec is more restrictive than the
 * rule" signal; the engine is the only place it can originate because the
 * client does not hold the replicator's distribution rules.
 *
 * This is deliberately distinct from `skeletonContains`: that predicate refuses
 * to drop successor facts (it guards what the engine will *authorize*), whereas
 * here we are diagnosing a target that *adds* them, so we test plain structural
 * containment rather than sound-sub-feed containment.
 */
function findNearMissRule(targetSkeleton: Skeleton, distributionRules: DistributionRules): Specification | null {
  for (const rule of distributionRules.rules) {
    for (const ruleFeed of rule.feeds) {
      const ruleSkeleton = skeletonOfSpecification(ruleFeed);
      if (skeletonIsProperSubset(ruleSkeleton, targetSkeleton)) {
        return ruleFeed;
      }
    }
  }
  return null;
}

/**
 * True when `subsetSkeleton` is contained in `supersetSkeleton` and the
 * superset adds strictly more structure. Fact/edge indices are assigned by a
 * deterministic outward walk from the givens, so a target that appends a join
 * shares the rule's indices on the common prefix and the index-based equality
 * predicates line up. A target that inserts a join mid-traversal shifts the
 * indices and will not be detected — an acceptable limitation for a best-effort
 * diagnostic.
 */
function skeletonIsProperSubset(subsetSkeleton: Skeleton, supersetSkeleton: Skeleton): boolean {
  if (!isSubsetOf(subsetSkeleton.facts, supersetSkeleton.facts, factsEqual)) {
    return false;
  }
  if (!isSubsetOf(subsetSkeleton.edges, supersetSkeleton.edges, edgesEqual)) {
    return false;
  }
  if (!isSubsetOf(subsetSkeleton.notExistsConditions, supersetSkeleton.notExistsConditions, notExistsConditionsEqual)) {
    return false;
  }
  // The target must add at least one fact, edge, or condition; otherwise the
  // shapes are equal and would already have matched on the hot path.
  return supersetSkeleton.facts.length > subsetSkeleton.facts.length ||
    supersetSkeleton.edges.length > subsetSkeleton.edges.length ||
    supersetSkeleton.notExistsConditions.length > subsetSkeleton.notExistsConditions.length;
}

function isSubsetOf<T>(subset: T[], superset: T[], equals: (a: T, b: T) => boolean): boolean {
  return subset.every(item => superset.some(candidate => equals(candidate, item)));
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