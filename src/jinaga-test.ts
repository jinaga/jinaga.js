import { Authentication } from './authentication/authentication';
import { AuthenticationTest } from './authentication/authentication-test';
import { AuthorizationRules } from './authorization/authorizationRules';
import { DistributionEngine } from './distribution/distribution-engine';
import { DistributionRules } from './distribution/distribution-rules';
import { dehydrateFact, Dehydration } from './fact/hydrate';
import { PassThroughFork } from './fork/pass-through-fork';
import { SyncStatusNotifier } from './http/web-client';
import { Jinaga } from './jinaga';
import { FactManager } from './managers/factManager';
import { Network, NetworkDistribution, NetworkNoOp } from './managers/NetworkManager';
import { MemoryStore } from './memory/memory-store';
import { ObservableSource } from './observable/observable';
import { PurgeConditions } from "./purge/purgeConditions";
import { Model } from './specification/model';
import { Specification } from "./specification/specification";
import { FactEnvelope, Storage } from './storage';

export type JinagaTestConfig = {
  model?: Model,
  authorization?: (a: AuthorizationRules) => AuthorizationRules,
  distribution?: (d: DistributionRules) => DistributionRules,
  user?: {},
  device?: {},
  initialState?: {}[],
  purgeConditions?: (p: PurgeConditions) => PurgeConditions,
  feedRefreshIntervalSeconds?: number
}

export class JinagaTest {
  static create(config: JinagaTestConfig) {
    const store = new MemoryStore();
    this.saveInitialState(config, store);
    const observableSource = new ObservableSource(store);
    const syncStatusNotifier = new SyncStatusNotifier();
    const fork = new PassThroughFork(store);
    const authentication = this.createAuthentication(config, store);
    const network = this.createNetwork(config, store);
    const purgeConditions = this.createPurgeConditions(config);
    const factManager = new FactManager(fork, observableSource, store, network, purgeConditions, config.feedRefreshIntervalSeconds);
    return new Jinaga(authentication, factManager, syncStatusNotifier);
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
    const userFact = JinagaTest.getUserFact(config);
    const deviceFact = JinagaTest.getDeviceFact(config);
    
    return new AuthenticationTest(store, authorizationRules, userFact, deviceFact);
  }

  static createNetwork(config: JinagaTestConfig, store: MemoryStore): Network {
    if (config.distribution) {
      const distributionRules = config.distribution(new DistributionRules([]));
      const distributionEngine = new DistributionEngine(distributionRules, store);
      return new NetworkDistribution(distributionEngine, this.getUserFact(config));
    }
    else {
      return new NetworkNoOp();
    }
  }

  static createPurgeConditions(config: JinagaTestConfig): Specification[] {
    if (config.purgeConditions) {
      return config.purgeConditions(new PurgeConditions([])).specifications;
    }
    else {
      return [];
    }
  }

  private static getUserFact(config: JinagaTestConfig) {
    return config.user ? dehydrateFact(config.user)[0] : null;
  }

  private static getDeviceFact(config: JinagaTestConfig) {
    return config.device ? dehydrateFact(config.device)[0] : null;
  }
}
