import { ReportedDenialCode } from "../distribution/distribution-engine";
import { FactRecord, FactReference, PredecessorCollection } from "../storage";
import { ValidationError } from "../util/errors";
import { FeedDecision, FeedsResponse, LoadMessage, SaveMessage } from "./messages";

// `typeof null === 'object'`, and so is an array. Neither is a valid message
// object here: letting them through produced a bare TypeError on the next
// property access rather than the intended ValidationError, which is exactly
// the classification hole this parser is meant to close.
function isObject(value: any): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFactReference(factReference: any): FactReference {
  if (!isObject(factReference)) throw new ValidationError("Expected FactReference to be an object.");
  if (typeof factReference.type !== 'string') throw new ValidationError("Expected a string 'type' property.");
  if (typeof factReference.hash !== 'string') throw new ValidationError("Expected a string 'hash' property.");
  return {
    type: factReference.type,
    hash: factReference.hash
  };
}

function parsePredecessor(predecessor: any): FactReference | FactReference[] {
  if (Array.isArray(predecessor)) {
    return predecessor.map(parseFactReference);
  }
  else {
    return parseFactReference(predecessor);
  }
}

function parsePredecessorCollection(predecessors: any): PredecessorCollection {
  if (!isObject(predecessors)) throw new ValidationError("Expected PredecessorCollection to be an object.");
  return Object.keys(predecessors).reduce((result, key) => ({
    ...result,
    [key]: parsePredecessor(predecessors[key])
  }), {} as PredecessorCollection);
}

function parseFactRecord(factRecord: any): FactRecord {
  if (!isObject(factRecord)) throw new ValidationError("Expected FactRecord to be an object.");
  if (typeof factRecord.type !== 'string') throw new ValidationError("Expected a string 'type' property.");
  if (typeof factRecord.hash !== 'string') throw new ValidationError("Expected a string 'hash' property.");
  if (!isObject(factRecord.fields)) throw new ValidationError("Expected an object 'fields' property.");
  return {
    type: factRecord.type,
    hash: factRecord.hash,
    predecessors: parsePredecessorCollection(factRecord.predecessors),
    fields: factRecord.fields
  };
}

export function parseSaveMessage(message: any): SaveMessage {
  if (!isObject(message)) throw new ValidationError("Expected an object. Check the content type of the request.");
  if (!Array.isArray(message.facts)) throw new ValidationError("Expected an array 'facts' property.");
  return {
    facts: message.facts.map(parseFactRecord)
  };
}

export function parseLoadMessage(message: any): LoadMessage {
  if (!isObject(message)) throw new ValidationError("Expected an object. Check the content type of the request.");
  if (!Array.isArray(message.references)) throw new ValidationError("Expected an array 'references' property.");
  return {
    references: message.references.map(parseFactReference)
  };
}

const feedDecisionKinds = ['authorized', 'reactive', 'denied'] as const;

type FeedDecisionKind = FeedDecision['decision'];

function isFeedDecisionKind(decision: string): decision is FeedDecisionKind {
  return (feedDecisionKinds as readonly string[]).includes(decision);
}

/**
 * Read one `FeedDecision`, giving every value the wire format permits a defined
 * meaning instead of rejecting the response (issue #439).
 *
 * Replicas are peers, and a newer peer may report a `decision` kind or a `code`
 * an older one has never heard of. Rejecting the response for that failed the
 * `feeds` list along with it, and every `query`, `watch` and `subscribe` of the
 * specification with it, over a field the caller may not even read.
 *
 * **An unknown `decision` kind is read as `denied`, carrying no `code`.**
 * `denied` is the only kind that neither hands out data nor promises that
 * waiting will, so it is the safe reading, and it keeps
 * `FeedDecision.decision` at exactly three inhabitants: nothing downstream has
 * an unknown kind to handle, and no path can mistake one for authorization.
 * The `code` is dropped rather than carried because the client cannot tell
 * what a code was asserting *about* when it cannot interpret the kind that
 * accompanied it, and an absent code already means exactly what is required
 * here -- it claims nothing about the shapes, so the denial is not structural
 * and never reaches `DistributionDeniedError`. That makes "non-structural"
 * true of the representation rather than a rule applied to it later. What
 * survives is the `reason`, which the replicator writes for a person.
 *
 * **An unknown `code` on a kind this client does know is carried through
 * raw**, so a developer still sees what the replicator sent and can look it
 * up. It is classified as neither structural nor pending where that
 * classification is made, by `isDistributionDenialCode` in
 * `distributionDiagnostic.ts`.
 *
 * A malformed *shape* still fails: a non-string or absent `decision`, a
 * non-string `code` or `reason`, a non-string `feed`. That line is what keeps
 * this from becoming "accept whatever arrives" -- the tolerance is of values
 * the wire format permits, not of responses that do not meet it. A `code` whose
 * value is discarded is still checked, so a malformed one is reported whatever
 * kind accompanied it.
 */
function parseFeedDecision(decision: any): FeedDecision {
  if (!isObject(decision)) throw new ValidationError("Expected FeedDecision to be an object.");
  if (typeof decision.feed !== 'string') throw new ValidationError("Expected a string 'feed' property.");
  if (typeof decision.decision !== 'string') throw new ValidationError("Expected a string 'decision' property.");
  const recognizedKind = isFeedDecisionKind(decision.decision);
  if (typeof decision.reason !== 'string') throw new ValidationError("Expected a string 'reason' property.");
  const result: FeedDecision = {
    feed: decision.feed,
    decision: recognizedKind ? decision.decision : 'denied',
    reason: decision.reason
  };
  if (decision.code !== undefined) {
    if (typeof decision.code !== 'string') throw new ValidationError("Expected a string 'code' property.");
    if (recognizedKind) {
      result.code = decision.code as ReportedDenialCode;
    }
  }
  return result;
}

export function parseFeedsResponse(message: any): FeedsResponse {
  if (!isObject(message)) throw new ValidationError("Expected an object. Check the content type of the response.");
  if (!Array.isArray(message.feeds)) throw new ValidationError("Expected an array 'feeds' property.");
  const feeds: string[] = message.feeds.map((feed: any) => {
    if (typeof feed !== 'string') throw new ValidationError("Expected 'feeds' to be an array of strings.");
    return feed;
  });
  const response: FeedsResponse = { feeds };
  // Old replicators omit `decisions`; when absent the client simply has
  // nothing to report (graceful degradation).
  if (message.decisions !== undefined) {
    if (!Array.isArray(message.decisions)) throw new ValidationError("Expected an array 'decisions' property.");
    response.decisions = message.decisions.map(parseFeedDecision);
  }
  return response;
}