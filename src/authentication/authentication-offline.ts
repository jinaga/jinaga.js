import { Channel } from "../fork/channel";
import { Fork } from "../fork/fork";
import { LoginResponse } from '../http/messages';
import { WebClient } from '../http/web-client';
import { IndexedDBLoginStore } from '../indexeddb/indexeddb-login-store';
import { Observable, SpecificationListener } from '../observable/observable';
import { Query } from '../query/query';
import { Feed } from "../specification/feed";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactFeed, FactRecord, FactReference, ProjectedResult } from '../storage';
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

  read(start: FactReference[], specification: Specification): Promise<ProjectedResult[]> {
    return this.inner.read(start, specification);
  }

  feed(feed: Feed, bookmark: string): Promise<FactFeed> {
    return this.inner.feed(feed, bookmark);
  }

  whichExist(references: FactReference[]): Promise<FactReference[]> {
      throw new Error("whichExist method not implemented on AuthenticationImpl.");
  }

  load(references: FactReference[]): Promise<FactRecord[]> {
    return this.inner.load(references);
  }

  from(fact: FactReference, query: Query): Observable {
    return this.inner.from(fact, query);
  }

  addSpecificationListener(specification: Specification, onResult: (results: ProjectedResult[]) => Promise<void>) {
    return this.inner.addSpecificationListener(specification, onResult);
  }

  removeSpecificationListener(listener: SpecificationListener) {
      return this.inner.removeSpecificationListener(listener);
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