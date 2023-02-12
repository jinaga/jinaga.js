import { FactRecord } from '../storage';
import { execRequest, withDatabase, withTransaction } from './driver';

export interface LoginRecord {
  userFact: FactRecord;
  displayName: string;
}

export class IndexedDBLoginStore {
  constructor (
    private indexName: string
  ) { }

  saveLogin(sessionToken: string, userFact: FactRecord, displayName: string) {
    return withDatabase(this.indexName, db => {
      return withTransaction(db, ['login'], 'readwrite', async tx => {
        const loginObjectStore = tx.objectStore('login');
        await execRequest(loginObjectStore.put({ userFact, displayName }, sessionToken));
      });
    });
  }

  loadLogin(sessionToken: string): Promise<LoginRecord> {
    return withDatabase(this.indexName, async db => {
      return withTransaction(db, ['login'], 'readonly', tx => {
        const loginObjectStore = tx.objectStore('login');
        return execRequest<LoginRecord>(loginObjectStore.get(sessionToken));
      });
    });
  }
}
