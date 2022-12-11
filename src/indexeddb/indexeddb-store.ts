import { TopologicalSorter } from '../fact/sorter';
import { Query } from '../query/query';
import { Direction, ExistentialCondition, Join, PropertyCondition, Quantifier, Step } from '../query/steps';
import { Feed } from "../specification/feed";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactFeed, FactPath, FactRecord, FactReference, ProjectedResult, Storage } from '../storage';
import { distinct, filterAsync, flatten, flattenAsync } from '../util/fn';
import { execRequest, factKey, keyToReference, withDatabase, withTransaction } from './driver';

export function getPredecessors(fact: FactRecord, role: string) {
  if (!fact) {
    return [];
  }

  const predecessors = fact.predecessors[role];
  if (predecessors) {
    if (Array.isArray(predecessors)) {
      return predecessors;
    }
    else {
      return [predecessors];
    }
  }
  else {
    return [];
  }
}

interface AncestorSet {
  key: string;
  ancestors: string[];
}

interface AncestorMap {
  [key: string]: string[];
}

function findAllAncestors(facts: FactRecord[]) {
  const sorter = new TopologicalSorter<AncestorSet>();
  const ancestorSets = sorter.sort(facts, (predecessors, fact) => ({
    key: factKey(fact),
    ancestors: flatten(predecessors, p => p.ancestors)
      .filter(distinct)
      .concat([ factKey(fact) ])
  }));
  if (!sorter.finished()) {
    throw new Error(`Not all ancestors have been provided: ${JSON.stringify(facts, null, 2)}`);
  }
  return ancestorSets.reduce((obj, ancestorSet) => ({
    ...obj,
    [ancestorSet.key]: ancestorSet.ancestors
  }), {} as AncestorMap);
}

async function saveFact(factObjectStore: IDBObjectStore, ancestorObjectStore: IDBObjectStore, edgeObjectStore: IDBObjectStore, ancestorMap: AncestorMap, fact: FactRecord) {
  const key = factKey(fact);
  const edges = flatten(Object.getOwnPropertyNames(fact.predecessors),
    role => getPredecessors(fact, role)
      .map(p => ({ successor: key, predecessor: factKey(p), role })));
  if (edges.length) {
    const edgeCount = await(execRequest(edgeObjectStore.index('all').count(key)));
    if (edgeCount !== edges.length) {
      await Promise.all(edges.map(edge => execRequest(edgeObjectStore.add(edge))));
    }
  }
  const ancestorCount = await execRequest(ancestorObjectStore.count(key));
  if (ancestorCount === 0) {
    await execRequest(ancestorObjectStore.add(ancestorMap[key], key));
  }
  const factCount = await execRequest(factObjectStore.count(key));
  if (factCount === 0) {
    await execRequest(factObjectStore.add(fact, key));
    return fact;
  }
  return null;
}

interface Edge {
  predecessor: string;
  successor: string;
  role: string;
}

function executeQuery(start: string, steps: Step[], predecessorIndex: IDBIndex, successorIndex: IDBIndex): Promise<string[][]> {
  return steps.reduce((pathsPromise, step) => pathsPromise
    .then(paths => executeStep(paths, step, predecessorIndex, successorIndex)),
    Promise.resolve([[start]]));
}

async function executeStep(paths: string[][], step: Step, predecessorIndex: IDBIndex, successorIndex: IDBIndex): Promise<string[][]> {
  if (step instanceof PropertyCondition) {
    if (step.name === 'type') {
      const prefix = step.value + ':';
      return paths.filter(path => {
        const fact = path[path.length - 1];
        return fact.startsWith(prefix);
      });
    }
  }
  else if (step instanceof Join) {
    const role = step.role;
    return await flattenAsync(paths, async path => {
      const fact = path[path.length - 1];
      const index = step.direction === Direction.Predecessor ? successorIndex : predecessorIndex;
      const edges = await execRequest<Edge[]>(index.getAll([fact, role]));
      return edges
        .map(edge =>
          path.concat([
            step.direction === Direction.Predecessor
              ? edge.predecessor
              : edge.successor]));
    });
  }
  else if (step instanceof ExistentialCondition) {
    return await filterAsync(paths, async path => {
      const fact = path[path.length - 1];
      const results = await executeQuery(fact, step.steps, predecessorIndex, successorIndex);
      return step.quantifier === Quantifier.Exists ?
        results.length > 0 :
        results.length === 0;
    });
  }

  throw new Error('Cannot yet handle this type of step: ' + JSON.stringify(step, null, 2));
}

export class IndexedDBStore implements Storage {
  constructor (
    private indexName: string
  ) { }
  
  close() {
    return Promise.resolve();
  }

  save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
    const ancestorMap = findAllAncestors(envelopes.map(e => e.fact));
    return withDatabase(this.indexName, db => {
      return withTransaction(db, ['fact', 'ancestor', 'edge'], 'readwrite', async tx => {
        const factObjectStore = tx.objectStore('fact');
        const ancestorObjectStore = tx.objectStore('ancestor');
        const edgeObjectStore = tx.objectStore('edge');
        const saved = await Promise.all(envelopes.map(envelope => saveFact(factObjectStore, ancestorObjectStore, edgeObjectStore, ancestorMap, envelope.fact)));
        return saved
          .filter(fact => fact)
          .map(fact => <FactEnvelope>{ signatures: [], fact });
      });
    });
  }

 query(start: FactReference, query: Query): Promise<FactPath[]> {
    return withDatabase(this.indexName, db => {
      return withTransaction(db, ['edge'], 'readonly', async tx => {
        const edgeObjectStore = tx.objectStore('edge');
        const predecessorIndex = edgeObjectStore.index('predecessor');
        const successorIndex = edgeObjectStore.index('successor');
    
        const paths = await executeQuery(factKey(start), query.steps, predecessorIndex, successorIndex);
        const results = paths.map(path => path.slice(1).map(keyToReference));
        return results;
      });
    });
  }

  read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
    throw new Error('Method not implemented.');
  }

  feed(feed: Feed, bookmark: string): Promise<FactFeed> {
    throw new Error('Method not implemented.');
  }

  whichExist(references: FactReference[]): Promise<FactReference[]> {
      throw new Error('whichExist not yet implemented on IndexedDB store.');
  }

  load(references: FactReference[]): Promise<FactRecord[]> {
    return withDatabase(this.indexName, db => {
      return withTransaction(db, ['fact', 'ancestor'], 'readonly', async tx => {
        const factObjectStore = tx.objectStore('fact');
        const ancestorObjectStore = tx.objectStore('ancestor');
        const allAncestors = await flattenAsync(references, reference =>
          execRequest<string[]>(ancestorObjectStore.get(factKey(reference))));
        const distinctAncestors = allAncestors
          .filter(distinct);
        const factRecords = await Promise.all(distinctAncestors.map(key =>
          execRequest(factObjectStore.get(key))));
        return <FactRecord[]>factRecords;
      });
    });
  }
}
