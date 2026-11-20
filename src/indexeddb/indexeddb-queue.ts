import { FactEnvelope, FactRecord, FactReference, Queue, QueuedEnvelope } from '../storage';
import { execRequest, factKey, withDatabase, withTransaction } from './driver';
import { distinct, flattenAsync } from '../util/fn';
import { TopologicalSorter } from '../fact/sorter';

export class IndexedDBQueue implements Queue {
  constructor(
    private indexName: string
  ) { }

  peek(): Promise<QueuedEnvelope[]> {
    return withDatabase(this.indexName, db =>
      withTransaction(db, ['queue', 'fact', 'ancestor'], 'readonly', async tx => {
        const queueObjectStore = tx.objectStore('queue');
        const factObjectStore = tx.objectStore('fact');
        const ancestorObjectStore = tx.objectStore('ancestor');
        
        // Get all envelopes from the queue
        // Each queued value carries the user who was current when the fact was
        // written, where there was one (issue #412). An entry written before
        // this client recorded the user has none, and reads back as a plain
        // envelope.
        const queuedEnvelopes = await execRequest<QueuedEnvelope[]>(queueObjectStore.getAll());
        
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
        
        // Get fact records for all ancestors
        const ancestorEnvelopes = await Promise.all(distinctAncestorKeys.map<Promise<QueuedEnvelope>>(async key => ({
          fact: await execRequest<FactRecord>(factObjectStore.get(key)),
          signatures: []
        })));
        
        // Combine queued envelopes and ancestor envelopes
        const allEnvelopes = [...queuedEnvelopes, ...ancestorEnvelopes];
        
        // Sort envelopes in topological order
        return this.sortAndValidateEnvelopes(allEnvelopes);
      })
    );
  }
  
  private sortAndValidateEnvelopes(envelopes: QueuedEnvelope[]): QueuedEnvelope[] {
    // Extract facts from envelopes
    const facts = envelopes.map(envelope => envelope.fact);
    
    // Create a map from fact key to envelope for quick lookup
    const envelopeMap = new Map<string, QueuedEnvelope>();
    envelopes.forEach(envelope => {
      envelopeMap.set(factKey(envelope.fact), envelope);
    });
    
    // Use TopologicalSorter to sort facts
    const sorter = new TopologicalSorter<string>();
    const sortedKeys = sorter.sort(facts, (_, fact) => factKey(fact));
    
    // Check if sorting was successful (no circular dependencies)
    if (!sorter.finished()) {
      throw new Error(`Circular dependencies detected in the fact queue. Some facts have predecessors that depend on them, creating a cycle.`);
    }
    
    // Validate the topological ordering
    this.validateTopologicalOrdering(sortedKeys, facts);
    
    // Convert sorted keys back to envelopes
    return sortedKeys.map(key => envelopeMap.get(key)!);
  }
  
  private validateTopologicalOrdering(sortedKeys: string[], facts: FactRecord[]): void {
    // Create a map of fact keys to their positions in the sorted list
    const positionMap = new Map<string, number>();
    sortedKeys.forEach((key, index) => {
      positionMap.set(key, index);
    });
    
    // Create a map of fact keys to facts for quick lookup
    const factMap = new Map<string, FactRecord>();
    facts.forEach(fact => {
      factMap.set(factKey(fact), fact);
    });
    
    // Validate that for each fact, all its predecessors appear earlier in the list
    for (let i = 0; i < sortedKeys.length; i++) {
      const key = sortedKeys[i];
      const fact = factMap.get(key);
      
      if (!fact) {
        throw new Error(`Internal error: Fact with key ${key} not found in fact map.`);
      }
      
      const predecessors = this.getAllPredecessors(fact);
      
      for (const predecessor of predecessors) {
        const predKey = factKey(predecessor);
        const predPosition = positionMap.get(predKey);
        
        // If predecessor is not in the list, it's an error
        if (predPosition === undefined) {
          throw new Error(`Missing predecessor: ${predKey} for fact ${key}`);
        }
        
        // If predecessor appears after the current fact, it's a topological ordering violation
        if (predPosition >= i) {
          throw new Error(`Topological ordering violation: ${predKey} (position ${predPosition}) should appear before ${key} (position ${i})`);
        }
      }
    }
  }
  
  private getAllPredecessors(fact: FactRecord): FactReference[] {
    const predecessors: FactReference[] = [];
    
    for (const role in fact.predecessors) {
      const references = fact.predecessors[role];
      if (Array.isArray(references)) {
        predecessors.push(...references);
      } else {
        predecessors.push(references);
      }
    }
    
    return predecessors;
  }

  enqueue(envelopes: FactEnvelope[], user?: FactReference): Promise<void> {
    return withDatabase(this.indexName, db =>
      withTransaction(db, ['queue'], 'readwrite', async tx => {
        const queueObjectStore = tx.objectStore('queue');
        await Promise.all(envelopes.map(async envelope => {
          const key = factKey(envelope.fact);
          // The user recorded is the one who was current when the fact was
          // written, so an entry already queued keeps the user it has
          // (issue #412). A queued fact is enqueued again when a later write
          // names it as a predecessor, and that later write is not when it was
          // written: taking the newer user would attribute the earlier write to
          // whoever is logged in now, which is the whole of what this records
          // against.
          const existing = await execRequest<QueuedEnvelope | undefined>(queueObjectStore.get(key));
          const recordedUser = existing ? existing.user : user;
          const queued: QueuedEnvelope = recordedUser
            ? { ...envelope, user: recordedUser }
            : envelope;
          await execRequest(queueObjectStore.put(queued, key));
        }));
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