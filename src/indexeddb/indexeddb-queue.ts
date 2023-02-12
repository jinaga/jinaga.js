import { FactEnvelope, Queue } from '../storage';
import { execRequest, factKey, withDatabase, withTransaction } from './driver';

export class IndexedDBQueue implements Queue {
  constructor(
    private indexName: string
  ) { }

  peek(): Promise<FactEnvelope[]> {
    return withDatabase(this.indexName, db =>
      withTransaction(db, ['queue'], 'readonly', async tx => {
        const queueObjectStore = tx.objectStore('queue');
        const envelopes = await execRequest<FactEnvelope[]>(queueObjectStore.getAll());
        return envelopes;
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