import { DistributionDenialCode, distributionDenialCodes } from "../distribution/distribution-engine";
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

const feedDecisionKinds = ['authorized', 'reactive', 'denied'];

function parseFeedDecision(decision: any): FeedDecision {
  if (!isObject(decision)) throw new ValidationError("Expected FeedDecision to be an object.");
  if (typeof decision.feed !== 'string') throw new ValidationError("Expected a string 'feed' property.");
  if (!feedDecisionKinds.includes(decision.decision)) {
    throw new ValidationError("Expected 'decision' to be 'authorized', 'reactive', or 'denied'.");
  }
  if (typeof decision.reason !== 'string') throw new ValidationError("Expected a string 'reason' property.");
  const result: FeedDecision = {
    feed: decision.feed,
    decision: decision.decision,
    reason: decision.reason
  };
  if (decision.code !== undefined) {
    if (typeof decision.code !== 'string') throw new ValidationError("Expected a string 'code' property.");
    if (!(distributionDenialCodes as readonly string[]).includes(decision.code)) {
      throw new ValidationError(`Unknown denial 'code': ${decision.code}.`);
    }
    result.code = decision.code as DistributionDenialCode;
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