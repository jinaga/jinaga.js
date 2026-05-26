import {
  EdgeDescription,
  NotExistsConditionDescription,
  Skeleton,
  skeletonOfSpecification
} from "../specification/skeleton";
import { Specification, isPathCondition, specificationIsIdentity } from "../specification/specification";
import { FactReference, ReferencesByName, Storage, factReferenceEquals } from "../storage";
import { DistributionRules } from "./distribution-rules";

type FactMapping = Map<number, number>;

interface DistributionRuleEntry {
  specification: Specification;
  feeds: Specification[];
  user: Specification | null;
}

interface RuleAuth {
  // Whether the rule shares with everyone. No user check required.
  isEveryone: boolean;
  // Structural key of the rule's user spec, or null when isEveryone.
  // Rules with matching keys authorize the same set of users.
  userKey: string | null;
  // Whether the rule's user spec evaluated successfully for the user
  // against namedStart. Rules with userKey present here are treated as
  // authorized; other rules with the same userKey are accepted by
  // structural equivalence.
  verifiedForUser: boolean;
}

/**
 * Attempt to authorize the target feed by composing multiple distribution rules.
 *
 * A target feed is "compositionally authorized" if its outer edges and any
 * notExists conditions can be covered by a sequence of rules, where each
 * rule's input either targets a feed given or matches an output of an
 * earlier rule in the composition. Every rule used must authorize the
 * logged-in user.
 *
 * This makes negating feeds (produced by `.notExists()`) authorizable when
 * each fact type in the traversal is independently shared with the user.
 */
export async function canAuthorizeByComposition(
  targetFeed: Specification,
  namedStart: ReferencesByName,
  user: FactReference | null,
  rules: DistributionRules,
  store: Storage
): Promise<boolean> {
  const targetSkeleton = skeletonOfSpecification(targetFeed);
  if (targetSkeleton.edges.length === 0 && targetSkeleton.notExistsConditions.length === 0) {
    return false;
  }

  const ruleAuthCache = await computeRuleAuthorizations(rules, namedStart, user, store);
  const verifiedUserKeys = new Set<string | null>();
  for (const auth of ruleAuthCache.values()) {
    if (auth.verifiedForUser && auth.userKey !== null) {
      verifiedUserKeys.add(auth.userKey);
    }
  }

  const initialLive = new Set<number>(targetSkeleton.inputs.map(i => i.factIndex));
  return tryCover(
    targetSkeleton,
    initialLive,
    new Set(targetSkeleton.edges.map(e => e.edgeIndex)),
    new Set(targetSkeleton.notExistsConditions.map((_, i) => i)),
    rules,
    ruleAuthCache,
    verifiedUserKeys,
    new Set()
  );
}

async function computeRuleAuthorizations(
  rules: DistributionRules,
  namedStart: ReferencesByName,
  user: FactReference | null,
  store: Storage
): Promise<Map<DistributionRuleEntry, RuleAuth>> {
  const map = new Map<DistributionRuleEntry, RuleAuth>();
  for (const rule of rules.rules) {
    if (rule.user === null) {
      map.set(rule, { isEveryone: true, userKey: null, verifiedForUser: true });
      continue;
    }
    const userKey = JSON.stringify(rule.user);

    const start = ruleStartFromNamedStart(rule.specification, namedStart);
    if (start === null || user === null) {
      map.set(rule, { isEveryone: false, userKey, verifiedForUser: false });
      continue;
    }

    const verifiedForUser = await evaluateUserSpec(rule.user, start, user, store);
    map.set(rule, { isEveryone: false, userKey, verifiedForUser });
  }
  return map;
}

function ruleStartFromNamedStart(
  ruleSpec: Specification,
  namedStart: ReferencesByName
): FactReference[] | null {
  const start: FactReference[] = [];
  for (const given of ruleSpec.given) {
    const ref = namedStart[given.label.name];
    if (!ref || ref.type !== given.label.type) return null;
    start.push(ref);
  }
  return start;
}

async function evaluateUserSpec(
  userSpec: Specification,
  start: FactReference[],
  user: FactReference,
  store: Storage
): Promise<boolean> {
  if (userSpec.projection.type !== "fact") return false;
  const label = userSpec.projection.label;

  if (specificationIsIdentity(userSpec)) {
    const ref = executeDeterministicSpecification(userSpec, label, start);
    return ref !== null && factReferenceEquals(user)(ref);
  }
  const results = await store.read(start, userSpec);
  return results.some(r => {
    const ref = r.tuple[label];
    return ref && factReferenceEquals(user)(ref);
  });
}

function executeDeterministicSpecification(
  specification: Specification,
  label: string,
  start: FactReference[]
): FactReference | null {
  const givenIndex = specification.given.findIndex(g => g.label.name === label);
  if (givenIndex !== -1) return start[givenIndex] ?? null;

  const match = specification.matches.find(m => m.unknown.name === label);
  if (!match) return null;
  const referencedLabels = match.conditions.filter(isPathCondition).map(c => c.labelRight);
  if (referencedLabels.length !== 1) return null;
  const index = specification.given.findIndex(g => g.label.name === referencedLabels[0]);
  if (index === -1) return null;
  return start[index] ?? null;
}

function isRuleAuthorized(
  rule: DistributionRuleEntry,
  ruleAuthCache: Map<DistributionRuleEntry, RuleAuth>,
  verifiedUserKeys: Set<string | null>
): boolean {
  const auth = ruleAuthCache.get(rule);
  if (!auth) return false;
  if (auth.isEveryone) return true;
  if (auth.verifiedForUser) return true;
  return auth.userKey !== null && verifiedUserKeys.has(auth.userKey);
}

function tryCover(
  targetSkeleton: Skeleton,
  liveFacts: Set<number>,
  uncoveredEdges: Set<number>,
  uncoveredNotExists: Set<number>,
  rules: DistributionRules,
  ruleAuthCache: Map<DistributionRuleEntry, RuleAuth>,
  verifiedUserKeys: Set<string | null>,
  visitedStates: Set<string>
): boolean {
  if (uncoveredEdges.size === 0 && uncoveredNotExists.size === 0) {
    return true;
  }

  const stateKey = serializeState(liveFacts, uncoveredEdges, uncoveredNotExists);
  if (visitedStates.has(stateKey)) return false;
  visitedStates.add(stateKey);

  // Try to cover an uncovered notExists condition by recursively authorizing
  // its inner skeleton as a sub-target anchored at a live fact.
  for (const neIdx of uncoveredNotExists) {
    const ne = targetSkeleton.notExistsConditions[neIdx];
    const anchorFact = findNotExistsAnchor(ne, liveFacts);
    if (anchorFact === null) continue;
    if (!canCoverNotExists(ne, anchorFact, targetSkeleton, rules, ruleAuthCache, verifiedUserKeys)) {
      continue;
    }
    const nextUncoveredNE = new Set(uncoveredNotExists);
    nextUncoveredNE.delete(neIdx);
    if (tryCover(targetSkeleton, liveFacts, uncoveredEdges, nextUncoveredNE, rules, ruleAuthCache, verifiedUserKeys, visitedStates)) {
      return true;
    }
  }

  for (const rule of rules.rules) {
    if (!isRuleAuthorized(rule, ruleAuthCache, verifiedUserKeys)) continue;

    for (const ruleFeed of rule.feeds) {
      const ruleSkeleton = skeletonOfSpecification(ruleFeed);
      // Phase 1 supports only rules whose feeds carry no notExists. Rules with
      // their own notExists feeds compose differently and are deferred.
      if (ruleSkeleton.notExistsConditions.length > 0) continue;
      if (ruleSkeleton.edges.length === 0) continue;

      const embeddings = findEmbeddings(ruleSkeleton, targetSkeleton, liveFacts, uncoveredEdges);
      for (const embedding of embeddings) {
        const nextLive = new Set(liveFacts);
        for (const ruleFact of ruleSkeleton.facts) {
          const targetIdx = embedding.get(ruleFact.factIndex);
          if (targetIdx !== undefined) nextLive.add(targetIdx);
        }
        const nextUncoveredEdges = new Set(uncoveredEdges);
        for (const ruleEdge of ruleSkeleton.edges) {
          const targetEdgeIndex = findCorrespondingTargetEdgeIndex(ruleEdge, embedding, targetSkeleton);
          if (targetEdgeIndex !== null) nextUncoveredEdges.delete(targetEdgeIndex);
        }
        if (nextUncoveredEdges.size === uncoveredEdges.size) continue;
        if (tryCover(targetSkeleton, nextLive, nextUncoveredEdges, uncoveredNotExists, rules, ruleAuthCache, verifiedUserKeys, visitedStates)) {
          return true;
        }
      }
    }
  }

  return false;
}

function canCoverNotExists(
  ne: NotExistsConditionDescription,
  anchorFactIndex: number,
  targetSkeleton: Skeleton,
  rules: DistributionRules,
  ruleAuthCache: Map<DistributionRuleEntry, RuleAuth>,
  verifiedUserKeys: Set<string | null>
): boolean {
  const innerFactIndices = collectFactIndices(ne);
  innerFactIndices.add(anchorFactIndex);

  const innerSkeleton: Skeleton = {
    facts: targetSkeleton.facts.filter(f => innerFactIndices.has(f.factIndex)),
    inputs: [{ factIndex: anchorFactIndex, inputIndex: 0 }],
    edges: ne.edges.slice(),
    notExistsConditions: ne.notExistsConditions.slice(),
    outputs: []
  };

  return tryCover(
    innerSkeleton,
    new Set<number>([anchorFactIndex]),
    new Set(innerSkeleton.edges.map(e => e.edgeIndex)),
    new Set(innerSkeleton.notExistsConditions.map((_, i) => i)),
    rules,
    ruleAuthCache,
    verifiedUserKeys,
    new Set()
  );
}

function collectFactIndices(ne: NotExistsConditionDescription): Set<number> {
  const indices = new Set<number>();
  for (const e of ne.edges) {
    indices.add(e.predecessorFactIndex);
    indices.add(e.successorFactIndex);
  }
  for (const nested of ne.notExistsConditions) {
    for (const idx of collectFactIndices(nested)) indices.add(idx);
  }
  return indices;
}

function findNotExistsAnchor(
  ne: NotExistsConditionDescription,
  liveFacts: Set<number>
): number | null {
  for (const e of ne.edges) {
    if (liveFacts.has(e.predecessorFactIndex)) return e.predecessorFactIndex;
    if (liveFacts.has(e.successorFactIndex)) return e.successorFactIndex;
  }
  return null;
}

function findEmbeddings(
  ruleSkeleton: Skeleton,
  targetSkeleton: Skeleton,
  liveFacts: Set<number>,
  uncoveredEdges: Set<number>
): FactMapping[] {
  const results: FactMapping[] = [];
  const inputs = ruleSkeleton.inputs;
  if (inputs.length === 0) return results;

  const assignInput = (
    index: number,
    mapping: FactMapping,
    usedTargets: Set<number>
  ): void => {
    if (index === inputs.length) {
      extendByEdges(mapping, usedTargets, new Set(), new Set(), ruleSkeleton, targetSkeleton, uncoveredEdges, results);
      return;
    }
    const input = inputs[index];
    const ruleFact = ruleSkeleton.facts.find(f => f.factIndex === input.factIndex);
    if (!ruleFact) return;
    for (const li of liveFacts) {
      if (usedTargets.has(li)) continue;
      const tf = targetSkeleton.facts.find(f => f.factIndex === li);
      if (!tf || tf.factType !== ruleFact.factType) continue;
      const nextMapping = new Map(mapping);
      nextMapping.set(input.factIndex, li);
      const nextUsed = new Set(usedTargets);
      nextUsed.add(li);
      assignInput(index + 1, nextMapping, nextUsed);
    }
  };

  assignInput(0, new Map(), new Set());
  return results;
}

function extendByEdges(
  mapping: FactMapping,
  usedTargets: Set<number>,
  matchedRuleEdges: Set<number>,
  usedTargetEdges: Set<number>,
  ruleSkeleton: Skeleton,
  targetSkeleton: Skeleton,
  uncoveredEdges: Set<number>,
  results: FactMapping[]
): void {
  if (matchedRuleEdges.size === ruleSkeleton.edges.length) {
    results.push(mapping);
    return;
  }
  const ruleEdgeIdx = ruleSkeleton.edges.findIndex((e, i) =>
    !matchedRuleEdges.has(i) &&
    (mapping.has(e.predecessorFactIndex) || mapping.has(e.successorFactIndex))
  );
  if (ruleEdgeIdx === -1) return;
  const ruleEdge = ruleSkeleton.edges[ruleEdgeIdx];

  const candidates = targetSkeleton.edges.filter(te => {
    if (!uncoveredEdges.has(te.edgeIndex)) return false;
    if (usedTargetEdges.has(te.edgeIndex)) return false;
    if (te.roleName !== ruleEdge.roleName) return false;

    const mappedPred = mapping.get(ruleEdge.predecessorFactIndex);
    if (mappedPred !== undefined && mappedPred !== te.predecessorFactIndex) return false;
    const mappedSucc = mapping.get(ruleEdge.successorFactIndex);
    if (mappedSucc !== undefined && mappedSucc !== te.successorFactIndex) return false;

    const rulePred = ruleSkeleton.facts.find(f => f.factIndex === ruleEdge.predecessorFactIndex);
    const ruleSucc = ruleSkeleton.facts.find(f => f.factIndex === ruleEdge.successorFactIndex);
    const targetPred = targetSkeleton.facts.find(f => f.factIndex === te.predecessorFactIndex);
    const targetSucc = targetSkeleton.facts.find(f => f.factIndex === te.successorFactIndex);
    if (!rulePred || !ruleSucc || !targetPred || !targetSucc) return false;
    if (rulePred.factType !== targetPred.factType) return false;
    if (ruleSucc.factType !== targetSucc.factType) return false;

    // Reject mappings that would collide two distinct rule facts onto one target fact.
    if (mappedPred === undefined && usedTargets.has(te.predecessorFactIndex)) {
      const existing = mappedFromTarget(mapping, te.predecessorFactIndex);
      if (existing !== null && existing !== ruleEdge.predecessorFactIndex) return false;
    }
    if (mappedSucc === undefined && usedTargets.has(te.successorFactIndex)) {
      const existing = mappedFromTarget(mapping, te.successorFactIndex);
      if (existing !== null && existing !== ruleEdge.successorFactIndex) return false;
    }
    return true;
  });

  for (const te of candidates) {
    const nextMapping = new Map(mapping);
    nextMapping.set(ruleEdge.predecessorFactIndex, te.predecessorFactIndex);
    nextMapping.set(ruleEdge.successorFactIndex, te.successorFactIndex);
    const nextUsed = new Set(usedTargets);
    nextUsed.add(te.predecessorFactIndex);
    nextUsed.add(te.successorFactIndex);
    const nextMatched = new Set(matchedRuleEdges);
    nextMatched.add(ruleEdgeIdx);
    const nextTargetEdges = new Set(usedTargetEdges);
    nextTargetEdges.add(te.edgeIndex);
    extendByEdges(nextMapping, nextUsed, nextMatched, nextTargetEdges, ruleSkeleton, targetSkeleton, uncoveredEdges, results);
  }
}

function mappedFromTarget(mapping: FactMapping, targetIndex: number): number | null {
  for (const [r, t] of mapping.entries()) {
    if (t === targetIndex) return r;
  }
  return null;
}

function findCorrespondingTargetEdgeIndex(
  ruleEdge: EdgeDescription,
  mapping: FactMapping,
  targetSkeleton: Skeleton
): number | null {
  const predTarget = mapping.get(ruleEdge.predecessorFactIndex);
  const succTarget = mapping.get(ruleEdge.successorFactIndex);
  if (predTarget === undefined || succTarget === undefined) return null;
  const te = targetSkeleton.edges.find(e =>
    e.predecessorFactIndex === predTarget &&
    e.successorFactIndex === succTarget &&
    e.roleName === ruleEdge.roleName
  );
  return te ? te.edgeIndex : null;
}

function serializeState(
  liveFacts: Set<number>,
  uncoveredEdges: Set<number>,
  uncoveredNotExists: Set<number>
): string {
  return JSON.stringify({
    l: [...liveFacts].sort((a, b) => a - b),
    e: [...uncoveredEdges].sort((a, b) => a - b),
    n: [...uncoveredNotExists].sort((a, b) => a - b)
  });
}
