import { FactEnvelope, FactRecord, FactReference, Queue } from '../storage';
import { execRequest, factKey, withDatabase, withTransaction } from './driver';
import { distinct, flattenAsync } from '../util/fn';

export class IndexedDBQueue implements Queue {
  constructor(
    private indexName: string
  ) { }

  peek(): Promise<FactEnvelope[]> {
    return withDatabase(this.indexName, db =>
      withTransaction(db, ['queue', 'fact', 'ancestor'], 'readonly', async tx => {
        const queueObjectStore = tx.objectStore('queue');
        const factObjectStore = tx.objectStore('fact');
        const ancestorObjectStore = tx.objectStore('ancestor');
        
        // Get all envelopes from the queue
        const queuedEnvelopes = await execRequest<FactEnvelope[]>(queueObjectStore.getAll());
        
        // If queue is empty, return empty array
        if (queuedEnvelopes.length === 0) {
          return [];
        }
        
        // Get references to all queued facts
        const queuedReferences = queuedEnvelopes.map(envelope => ({
          type: envelope.fact.type,
          hash: envelope.fact.hash
        }));
        
        // Get all ancestors of queued facts
        const allAncestors = await flattenAsync(queuedReferences, reference =>
          execRequest<string[]>(ancestorObjectStore.get(factKey(reference))));
        
        // Remove duplicates and queued facts from ancestors
        const queuedKeys = new Set(queuedReferences.map(factKey));
        const distinctAncestorKeys = allAncestors
          .filter(distinct)
          .filter(key => !queuedKeys.has(key));
        
        // If no ancestors, return just the queued envelopes
        if (distinctAncestorKeys.length === 0) {
          return queuedEnvelopes;
        }
        
        // Get fact records for all ancestors
        const ancestorEnvelopes = await Promise.all(distinctAncestorKeys.map<Promise<FactEnvelope>>(async key => ({
          fact: await execRequest<FactRecord>(factObjectStore.get(key)),
          signatures: []
        })));
        
        // Combine queued envelopes and ancestor envelopes
        return [...queuedEnvelopes, ...ancestorEnvelopes];
      })
    );
  }

  enqueue(envelopes: FactEnvelope[]): Promise<void> {
    return withDatabase(this.indexName, db =>
      withTransaction(db, ['queue'], 'readwrite', async tx => {
        const queueObjectStore = tx.objectStore('queue');
        await Promise.all(envelopes.map(envelope =>
          execRequest(queueObjectStore.put(envelope, factKey(envelope.fact)))
        ));
      })
    );
  }

  dequeue(envelopes: FactEnvelope[]): Promise<void> {
    return withDatabase(this.indexName, db =>
      withTransaction(db, ['queue'], 'readwrite', async tx => {
        const queueObjectStore = tx.objectStore('queue');
        await Promise.all(envelopes.map(envelope =>
          execRequest(queueObjectStore.delete(factKey(envelope.fact)))
        ));
      })
    );
  }
}