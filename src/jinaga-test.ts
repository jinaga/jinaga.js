import { Authentication } from './authentication/authentication';
import { AuthenticationTest } from './authentication/authentication-test';
import { AuthorizationRules } from './authorization/authorizationRules';
import { dehydrateFact, Dehydration } from './fact/hydrate';
import { PassThroughFork } from './fork/pass-through-fork';
import { SyncStatusNotifier } from './http/web-client';
import { Jinaga } from './jinaga';
import { FactManager } from './managers/factManager';
import { MemoryStore } from './memory/memory-store';
import { ObservableSource } from './observable/observable';
import { ObservableSourceImpl } from './observable/observable-source-impl';
import { FactEnvelope } from './storage';

export type JinagaTestConfig = {
  authorization?: (a: AuthorizationRules) => AuthorizationRules,
  user?: {},
  device?: {},
  initialState?: {}[]
}

export class JinagaTest {
  static create(config: JinagaTestConfig) {
    const store = new MemoryStore();
    this.saveInitialState(config, store);
    const feed = new ObservableSourceImpl(store);
    const syncStatusNotifier = new SyncStatusNotifier();
    const fork = new PassThroughFork(feed);
    const authentication = this.createAuthentication(config, feed);
    const factManager = new FactManager(authentication, fork);
    return new Jinaga(factManager, syncStatusNotifier);
  }

  static saveInitialState(config: JinagaTestConfig, store: MemoryStore) {
    if (config.initialState) {
      const dehydrate = new Dehydration();
      config.initialState.forEach(obj => dehydrate.dehydrate(obj));
      store.save(dehydrate.factRecords().map(f => <FactEnvelope>{
        fact: f,
        signatures: []
      }));
    }
  }

  static createAuthentication(config: JinagaTestConfig, inner: ObservableSource): Authentication {
    const authorizationRules = config.authorization ?
      config.authorization(new AuthorizationRules()) : null;
    const userFact = config.user ? dehydrateFact(config.user)[0] : null;
    const deviceFact = config.device ? dehydrateFact(config.device)[0] : null;
    
    return new AuthenticationTest(inner, authorizationRules, userFact, deviceFact);
  }
}
