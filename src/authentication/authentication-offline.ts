import { LoginResponse } from '../http/messages';
import { WebClient } from '../http/web-client';
import { IndexedDBLoginStore } from '../indexeddb/indexeddb-login-store';
import { FactEnvelope, FactRecord } from '../storage';
import { Authentication } from './authentication';

export class AuthenticationOffline implements Authentication {
  constructor(
    private store: IndexedDBLoginStore,
    private client: WebClient
  ) { }

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

  authorize(envelopes: FactEnvelope[]): Promise<FactEnvelope[]> {
    return Promise.resolve(envelopes);
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