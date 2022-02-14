import { Feed, Observable } from '../feed/feed';
import { Channel } from "../fork/channel";
import { Fork } from "../fork/fork";
import { LoginResponse } from '../http/messages';
import { WebClient } from '../http/web-client';
import { IndexedDBLoginStore } from '../indexeddb/indexeddb-login-store';
import { Query } from '../query/query';
import { FactEnvelope, FactRecord, FactReference } from '../storage';
import { Authentication } from './authentication';

export class AuthenticationOffline implements Authentication {
  constructor(private inner: Fork, private store: IndexedDBLoginStore, private client: WebClient) {
  }

  async close(): Promise<void> {
    await this.inner.close();
  }
  async login() {    
    try {
      return await this.loginRemote();
    }
    catch (err) {
      if (err === 'Unauthorized') {
        throw err;
      }

      try {
        return await this.loginLocal();
      }
      catch (err2) {
        throw err;
      }
    }
  }

  local(): Promise<FactRecord> {
    throw new Error('Local device has no persistence.');
  }

  async save(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
    const saved = await this.inner.save(envelopes);
    return saved;
  }

  query(start: FactReference, query: Query) {
    return this.inner.query(start, query);
  }

  exists(fact: FactReference): Promise<boolean> {
    throw new Error("Exists method not implemented on AuthenticationImpl.");
  }

  load(references: FactReference[]): Promise<FactRecord[]> {
    return this.inner.load(references);
  }

  from(fact: FactReference, query: Query): Observable {
    return this.inner.from(fact, query);
  }

  addChannel(fact: FactReference, query: Query): Channel {
    return this.inner.addChannel(fact, query);
  }

  removeChannel(channel: Channel): void {
    return this.inner.removeChannel(channel);
  }

  private async loginRemote() {
    const result = await this.client.login();
    if (result && result.userFact && result.profile) {
      await this.store.saveLogin('token', result.userFact, result.profile.displayName);
    }
    return result;
  }

  private async loginLocal(): Promise<LoginResponse> {
    const result = await this.store.loadLogin('token');
    return {
      userFact: result.userFact,
      profile: {
        displayName: result.displayName
      }
    };
  }
}