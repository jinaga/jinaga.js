import { FactReference } from '../storage';

function upgradingToVersion({ newVersion, oldVersion }: IDBVersionChangeEvent, ver: number) {
  return newVersion && newVersion >= ver && oldVersion < ver;
}

function openDatabase(indexName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = self.indexedDB.open(indexName, 1);
    request.onsuccess = _ => resolve(request.result);
    request.onerror = _ => reject(`Error opening database ${indexName}: ${JSON.stringify(request.error, null, 2)}.`);
    request.onupgradeneeded = ev => {
      const db = request.result;
      if (upgradingToVersion(ev, 1)) {
        db.createObjectStore('login');
        db.createObjectStore('fact');
        db.createObjectStore('ancestor');
        const edgeObjectStore = db.createObjectStore('edge', {
          keyPath: ['successor', 'predecessor', 'role']
        });
        edgeObjectStore.createIndex('predecessor', ['predecessor', 'role'], { unique: false });
        edgeObjectStore.createIndex('successor', ['successor', 'role'], { unique: false });
        edgeObjectStore.createIndex('all', 'successor', { unique: false });
        db.createObjectStore('queue');
      }
    }
  });
}

export async function withDatabase<T>(indexName: string, action: (db: IDBDatabase) => Promise<T>) {
  const db = await openDatabase(indexName);
  const result = await action(db);
  db.close();
  return result;
}

export async function withTransaction<T>(db: IDBDatabase, storeNames: string[], mode: IDBTransactionMode, action: (transaction: IDBTransaction) => Promise<T>) {
  const transaction = db.transaction(storeNames, mode);
  const transactionComplete = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = _ => resolve();
    transaction.onerror = _ => reject(`Error executing transaction ${JSON.stringify(transaction.error?.message, null, 2)}`);
  });
  const [result, v] = await Promise.all([action(transaction), transactionComplete]);
  return result;
}

export function execRequest<T>(request: IDBRequest) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = (_: Event) => resolve(request.result);
    request.onerror = (_: Event) => reject(`Error executing request ${JSON.stringify(request.error?.message, null, 2)}`);
  });
}

export function factKey(fact: FactReference) {
  return `${fact.type}:${fact.hash}`;
}

export function keyToReference(key: string): FactReference {
  const regex = /([^:]*):(.*)/;
  const match = regex.exec(key);
  if (!match) {
    throw new Error(`Invalid key ${key}`);
  }
  const [ _, type, hash ] = match;
  return { type, hash };
}
