import { FactRecord, FactReference, PredecessorCollection } from "../storage";
import { LoadMessage, QueryMessage, SaveMessage } from "./messages";

function parseFactReference(factReference: any): FactReference {
  if (typeof factReference !== 'object') throw new Error("Expected FactReference to be an object.");
  if (typeof factReference.type !== 'string') throw new Error("Expected a string 'type' property.");
  if (typeof factReference.hash !== 'string') throw new Error("Expected a string 'hash' property.");
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
  if (typeof predecessors !== 'object') throw new Error("Expected PredecessorCollection to be an object.");
  return Object.keys(predecessors).reduce((result, key) => ({
    ...result,
    [key]: parsePredecessor(predecessors[key])
  }), {} as PredecessorCollection);
}

function parseFactRecord(factRecord: any): FactRecord {
  if (typeof factRecord !== 'object') throw new Error("Expected FactRecord to be an object.");
  if (typeof factRecord.type !== 'string') throw new Error("Expected a string 'type' property.");
  if (typeof factRecord.hash !== 'string') throw new Error("Expected a string 'hash' property.");
  if (typeof factRecord.fields !== 'object') throw new Error("Expected an object 'fields' property.");
  return {
    type: factRecord.type,
    hash: factRecord.hash,
    predecessors: parsePredecessorCollection(factRecord.predecessors),
    fields: factRecord.fields
  };
}

export function parseQueryMessage(message: any): QueryMessage {
  if (typeof message !== 'object') throw new Error("Expected an object. Check the content type of the request.");
  if (typeof message.query !== 'string') throw new Error("Expected a string 'query' property.");
  return {
    start: parseFactReference(message.start),
    query: message.query
  };
}

export function parseSaveMessage(message: any): SaveMessage {
  if (typeof message !== 'object') throw new Error("Expected an object. Check the content type of the request.");
  if (!Array.isArray(message.facts)) throw new Error("Expected an array 'facts' property.");
  return {
    facts: message.facts.map(parseFactRecord)
  };
}

export function parseLoadMessage(message: any): LoadMessage {
  if (typeof message !== 'object') throw new Error("Expected an object. Check the content type of the request.");
  if (!Array.isArray(message.references)) throw new Error("Expected an array 'references' property.");
  return {
    references: message.references.map(parseFactReference)
  };
}