import { ReportedDenialCode, ReportedFeedDecisionKind } from "../distribution/distribution-engine";
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

/**
 * Read one `FeedDecision`, giving every value the wire format permits a defined
 * meaning instead of rejecting the response (issue #439).
 *
 * Replicas are peers, and a newer peer may report a `decision` kind or a `code`
 * an older one has never heard of. Rejecting the response for that failed the
 * `feeds` list along with it, and every `query`, `watch` and `subscribe` of the
 * specification with it, over a field the caller may not even read.
 *
 * **Both values are carried through exactly as received**, known or not. The
 * parser checks the shape and assigns no meaning: what an unrecognized kind or
 * code *means* is decided where the decision is classified, by
 * `isFeedDecisionKind`, `isDistributionDenialCode` and the predicates in
 * `distributionDiagnostic.ts`. Dropping a value here would protect nothing,
 * because it was already on the wire, and would leave a developer with no way
 * to look up what the replicator actually said.
 *
 * Reading an unrecognized kind safely is therefore the readers' job, and every
 * one of them tests positively for the kind it acts on: `authorized` in
 * `pending-feed-resolution.ts` and in `toDistributionDiagnostics`, `reactive`
 * in `isPendingAuthorization`. An unknown kind matches none of them, so it is
 * never authorized and never pending, and `isStructuralDenial` requires a kind
 * this client knows before it reads a code as structural.
 *
 * A malformed *shape* still fails: a non-string or absent `decision`, a
 * non-string `code` or `reason`, a non-string `feed`. That line is what keeps
 * this from becoming "accept whatever arrives" -- the tolerance is of values
 * the wire format permits, not of responses that do not meet it.
 */
function parseFeedDecision(decision: any): FeedDecision {
  if (!isObject(decision)) throw new ValidationError("Expected FeedDecision to be an object.");
  if (typeof decision.feed !== 'string') throw new ValidationError("Expected a string 'feed' property.");
  if (typeof decision.decision !== 'string') throw new ValidationError("Expected a string 'decision' property.");
  if (typeof decision.reason !== 'string') throw new ValidationError("Expected a string 'reason' property.");
  const result: FeedDecision = {
    feed: decision.feed,
    decision: decision.decision as ReportedFeedDecisionKind,
    reason: decision.reason
  };
  if (decision.code !== undefined) {
    if (typeof decision.code !== 'string') throw new ValidationError("Expected a string 'code' property.");
    result.code = decision.code as ReportedDenialCode;
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