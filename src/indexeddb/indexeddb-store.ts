import { hydrateFromTree } from '../fact/hydrate';
import { TopologicalSorter } from '../fact/sorter';
import { Specification } from "../specification/specification";
import { SpecificationRunner } from '../specification/specification-runner';
import { FactEnvelope, FactFeed, FactRecord, FactReference, ProjectedResult, Storage } from '../storage';
import { distinct, flatten, flattenAsync } from '../util/fn';
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

  read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
    return withDatabase(this.indexName, db => {
      return withTransaction(db, ['edge', 'fact', 'ancestor'], 'readonly', tx => {
        const edgeObjectStore = tx.objectStore('edge');
        const predecessorIndex = edgeObjectStore.index('predecessor');
        const successorIndex = edgeObjectStore.index('successor');
        const factObjectStore = tx.objectStore('fact');
        const ancestorObjectStore = tx.objectStore('ancestor');

        const runner = new SpecificationRunner({
          async getPredecessors(reference, name, predecessorType) {
            const edges = await execRequest<Edge[]>(successorIndex.getAll([factKey(reference), name]));
            return edges
              .map(edge => keyToReference(edge.predecessor))
              .filter(reference => reference.type === predecessorType);
          },
          async getSuccessors(reference, name, successorType) {
            const edges = await execRequest<Edge[]>(predecessorIndex.getAll([factKey(reference), name]));
            return edges
              .map(edge => keyToReference(edge.successor))
              .filter(reference => reference.type === successorType);
          },
          findFact(reference) {
            return execRequest<FactRecord>(factObjectStore.get(factKey(reference)));
          },
          async hydrate(reference) {
            const allAncestors = await execRequest<string[]>(ancestorObjectStore.get(factKey(reference)));
            const distinctAncestors = allAncestors.filter(distinct);
            const factRecords = await Promise.all(distinctAncestors.map(key =>
              execRequest<FactRecord>(factObjectStore.get(key))));
            const facts = hydrateFromTree([reference], factRecords);
            if (facts.length === 0) {
              throw new Error(`The fact ${reference} is not defined.`);
            }
            if (facts.length > 1) {
              throw new Error(`The fact ${reference} is defined more than once.`);
            }
            return facts[0];
          }
        });
        return runner.read(start, specification);
      });
    });
  }

  feed(feed: Specification, start: FactReference[], bookmark: string): Promise<FactFeed> {
    throw new Error('Method not implemented.');
  }

  whichExist(references: FactReference[]): Promise<FactReference[]> {
    return withDatabase(this.indexName, db => {
      return withTransaction(db, ['fact'], 'readonly', async tx => {
        const factObjectStore = tx.objectStore('fact');
        const factKeys = references.map(factKey);
        const factRecords = await Promise.all(factKeys.map(key => execRequest<FactRecord>(factObjectStore.get(key))));
        return factRecords
          .filter(fact => !!fact)
          .map(fact => keyToReference(factKey(fact)));
      });
    });
  }

  load(references: FactReference[]): Promise<FactEnvelope[]> {
    return withDatabase(this.indexName, db => {
      return withTransaction(db, ['fact', 'ancestor'], 'readonly', async tx => {
        const factObjectStore = tx.objectStore('fact');
        const ancestorObjectStore = tx.objectStore('ancestor');
        const allAncestors = await flattenAsync(references, reference =>
          execRequest<string[]>(ancestorObjectStore.get(factKey(reference))));
        const distinctAncestors = allAncestors
          .filter(distinct);
        const factRecords = await Promise.all(distinctAncestors.map<Promise<FactEnvelope>>(async key => ({
          fact: await execRequest<FactRecord>(factObjectStore.get(key)),
          signatures: []
        })));
        return factRecords;
      });
    });
  }

  purge(purgeConditions: Specification[]): Promise<void> {
    // Not yet implemented
    return Promise.resolve();
  }

  loadBookmark(feed: string): Promise<string> {
    return withDatabase(this.indexName, db => {
      return withTransaction(db, ['bookmark'], 'readonly', async tx => {
        const bookmarkObjectStore = tx.objectStore('bookmark');
        const bookmark = await execRequest<string | undefined>(bookmarkObjectStore.get(feed));
        return bookmark || '';
      });
    });
  }
  
  saveBookmark(feed: string, bookmark: string): Promise<void> {
    return withDatabase(this.indexName, db => {
      return withTransaction(db, ['bookmark'], 'readwrite', async tx => {
        const bookmarkObjectStore = tx.objectStore('bookmark');
        await execRequest(bookmarkObjectStore.put(bookmark, feed));
      });
    });
  }

  getMruDate(specificationHash: string): Promise<Date | null> {
    return withDatabase(this.indexName, db => {
      return withTransaction(db, ['specification'], 'readonly', async tx => {
        const specificationObjectStore = tx.objectStore('specification');
        const mruDate = await execRequest<Date | undefined>(specificationObjectStore.get(specificationHash));
        return mruDate || null;
      });
    });
  }

  setMruDate(specificationHash: string, mruDate: Date): Promise<void> {
    return withDatabase(this.indexName, db => {
      return withTransaction(db, ['specification'], 'readwrite', async tx => {
        const specificationObjectStore = tx.objectStore('specification');
        await execRequest(specificationObjectStore.put(mruDate, specificationHash));

        // Remove specifications older than 30 days.
        const oldMruDate = new Date(mruDate.getTime() - 1000 * 60 * 60 * 24 * 30);
        const cursor = await execRequest<IDBCursorWithValue | null>(
          specificationObjectStore.openCursor(IDBKeyRange.upperBound(oldMruDate)));
        while (cursor) {
          await execRequest(cursor.delete());
          await cursor.continue();
        }
      });
    });
  }
}
