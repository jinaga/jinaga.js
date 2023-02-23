import { Authentication } from './authentication/authentication';
import { AuthenticationTest } from './authentication/authentication-test';
import { AuthorizationRules } from './authorization/authorizationRules';
import { dehydrateFact, Dehydration } from './fact/hydrate';
import { PassThroughFork } from './fork/pass-through-fork';
import { SyncStatusNotifier } from './http/web-client';
import { Jinaga } from './jinaga';
import { FactManager } from './managers/factManager';
import { NetworkNoOp } from './managers/NetworkManager';
import { MemoryStore } from './memory/memory-store';
import { ObservableSource } from './observable/observable';
import { Model } from './specification/model';
import { FactEnvelope, Storage } from './storage';

export type JinagaTestConfig = {
  model?: Model,
  authorization?: (a: AuthorizationRules) => AuthorizationRules,
  user?: {},
  device?: {},
  initialState?: {}[]
}

export class JinagaTest {
  static create(config: JinagaTestConfig) {
    const store = new MemoryStore();
    this.saveInitialState(config, store);
    const observableSource = new ObservableSource(store);
    const syncStatusNotifier = new SyncStatusNotifier();
    const fork = new PassThroughFork(store);
    const authentication = this.createAuthentication(config, store);
    const network = new NetworkNoOp();
    const factManager = new FactManager(authentication, fork, observableSource, store, network);
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

  static createAuthentication(config: JinagaTestConfig, store: Storage): Authentication {
    const authorizationRules = config.authorization ?
      config.authorization(new AuthorizationRules(config.model)) : null;
    const userFact = config.user ? dehydrateFact(config.user)[0] : null;
    const deviceFact = config.device ? dehydrateFact(config.device)[0] : null;
    
    return new AuthenticationTest(store, authorizationRules, userFact, deviceFact);
  }
}
