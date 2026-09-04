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
import { Trace } from './util/trace';

export type JinagaTestConfig = {
  model?: Model,
  authorization?: (a: AuthorizationRules) => AuthorizationRules,
  distribution?: (d: DistributionRules) => DistributionRules,
  user?: {},
  device?: {},
  initialState?: {}[],
  purgeConditions?: (p: PurgeConditions) => PurgeConditions,
  feedRefreshIntervalSeconds?: number,
  /**
   * Maximum milliseconds to wait for a single watch or subscribe callback to
   * settle before continuing without it (issue #246). Set to 0 to wait
   * indefinitely. Defaults to `DEFAULT_LISTENER_TIMEOUT_MS`.
   */
  listenerTimeoutMs?: number,
  /**
   * Produces the store that backs the test instance. Defaults to a new
   * `MemoryStore`. Supply a factory to run a `JinagaTest`-based suite against
   * another implementation of `Storage`, the way the storage conformance kit
   * runs one suite against several stores (issue #252).
   *
   * Supplying this together with a non-empty `initialState` requires
   * `createAsync`, because `create` cannot await the save; `create` refuses
   * the combination rather than dropping the result (issue #274). `create`
   * still accepts the factory on its own, for a suite that seeds its facts
   * through the instance.
   *
   * The factory itself is synchronous, unlike the conformance kit's
   * `StorageFactory`, because `create` is synchronous and both entry points
   * read this one field. Asynchronous *construction* is not the same thing as
   * asynchronous writes: `MemoryStore` and `IndexedDBStore` are both built
   * synchronously and defer their work to their methods.
   */
  store?: () => Storage
}

export class JinagaTest {
  static create(config: JinagaTestConfig) {
    // `create` cannot await the save, so a supplied store carrying initial
    // state is a misuse (issue #274): a store whose writes complete
    // asynchronously returns an instance that does not hold the state yet, and
    // a save that fails is detached from this call site — an unhandled
    // rejection, or a failure Jest attributes to whichever test the microtask
    // lands in. Refuse it here, where the caller can see it. The factory is
    // opt-in as of issue #252, so no caller predating it is affected.
    if (config.store && config.initialState && config.initialState.length > 0) {
      throw new Error("JinagaTest.create cannot save initial state into a store from the `store` factory, because it does not await the save. Use JinagaTest.createAsync instead.");
    }
    const store = this.createStore(config);
    // The initial state is saved without awaiting, so it is readable on return
    // only for a store that applies writes synchronously, as `MemoryStore`
    // does. `createAsync` is the entry point for any store that does not.
    //
    // What reaches the save from here is the default `MemoryStore`, or a
    // supplied store with an empty `initialState`. A rejection from either
    // should not happen, but must not escape as an unhandled rejection, so
    // report it. A *synchronous* throw is untouched: `saveInitialState` is not
    // `async`, so it propagates out of `create` before there is a promise to
    // attach this handler to.
    this.saveInitialState(config, store).catch(error => Trace.error(error));
    return this.assemble(config, store);
  }

  /**
   * Creates a test instance, awaiting the initial state before returning.
   * Use this whenever `config.store` produces a store whose `save` completes
   * asynchronously.
   */
  static async createAsync(config: JinagaTestConfig): Promise<Jinaga> {
    const store = this.createStore(config);
    await this.saveInitialState(config, store);
    return this.assemble(config, store);
  }

  private static createStore(config: JinagaTestConfig): Storage {
    return config.store ? config.store() : new MemoryStore();
  }

  private static assemble(config: JinagaTestConfig, store: Storage) {
    const observableSource = new ObservableSource(store, {
      listenerTimeoutMs: config.listenerTimeoutMs
    });
    const syncStatusNotifier = new SyncStatusNotifier();
    const fork = new PassThroughFork(store);
    const authentication = this.createAuthentication(config, store);
    const network = this.createNetwork(config, store);
    const purgeConditions = this.createPurgeConditions(config);
    const factManager = new FactManager(fork, observableSource, store, network, purgeConditions, config.feedRefreshIntervalSeconds);
    return new Jinaga(authentication, factManager, syncStatusNotifier);
  }

  // Deliberately not `async`. `create` calls this without awaiting, so an
  // async body would convert every synchronous throw in it — a malformed fact
  // out of `dehydrate`, or a store whose `save` throws before returning —
  // into a rejected promise that `create` drops. That would turn a clear
  // synchronous failure into an unhandled rejection, on the default
  // `MemoryStore` path as much as any other. Returning the promise instead
  // keeps those throws propagating out of `create` as they always have.
  static saveInitialState(config: JinagaTestConfig, store: Storage): Promise<void> {
    if (config.initialState) {
      const dehydrate = new Dehydration();
      config.initialState.forEach(obj => dehydrate.dehydrate(obj));
      return store.save(dehydrate.factRecords().map(f => <FactEnvelope>{
        fact: f,
        signatures: []
      })).then(() => { });
    }
    return Promise.resolve();
  }

  static createAuthentication(config: JinagaTestConfig, store: Storage): Authentication {
    const authorizationRules = config.authorization ?
      config.authorization(new AuthorizationRules(config.model)) : null;
    const userFact = JinagaTest.getUserFact(config);
    const deviceFact = JinagaTest.getDeviceFact(config);
    
    return new AuthenticationTest(store, authorizationRules, userFact, deviceFact);
  }

  static createNetwork(config: JinagaTestConfig, store: Storage): Network {
    if (config.distribution) {
      const distributionRules = config.distribution(new DistributionRules([]));
      const distributionEngine = new DistributionEngine(distributionRules, store, true);
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
