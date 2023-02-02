import { Authentication } from "./authentication/authentication";
import { AuthenticationNoOp } from "./authentication/authentication-noop";
import { AuthenticationOffline } from "./authentication/authentication-offline";
import { AuthenticationWebClient } from "./authentication/authentication-web-client";
import { Fork } from "./fork/fork";
import { PassThroughFork } from "./fork/pass-through-fork";
import { PersistentFork } from "./fork/persistent-fork";
import { TransientFork } from "./fork/transient-fork";
import { SyncStatusNotifier, WebClient } from "./http/web-client";
import { XhrConnection } from "./http/xhr";
import { IndexedDBLoginStore } from "./indexeddb/indexeddb-login-store";
import { IndexedDBQueue } from "./indexeddb/indexeddb-queue";
import { IndexedDBStore } from "./indexeddb/indexeddb-store";
import { Jinaga } from "./jinaga";
import { FactManager } from "./managers/factManager";
import { MemoryStore } from "./memory/memory-store";
import { ObservableSource } from "./observable/observable";
import { ObservableSourceImpl } from "./observable/observable-source-impl";
import { Storage } from "./storage";

export type JinagaBrowserConfig = {
    httpEndpoint?: string,
    wsEndpoint?: string,
    indexedDb?: string,
    httpTimeoutSeconds?: number
}

export class JinagaBrowser {
    static create(config: JinagaBrowserConfig) {
        const store = createStore(config);
        const observableSource = new ObservableSourceImpl(store);
        const syncStatusNotifier = new SyncStatusNotifier();
        const fork = createFork(config, observableSource, syncStatusNotifier);
        const authentication = createAuthentication(config, observableSource, syncStatusNotifier);
        const factManager = new FactManager(authentication, fork, observableSource);
        return new Jinaga(factManager, syncStatusNotifier);
    }
}

function createStore(config: JinagaBrowserConfig): Storage {
  if (config.indexedDb) {
    return new IndexedDBStore(config.indexedDb);
  }
  else {
    return new MemoryStore();
  }
}

function createFork(
    config: JinagaBrowserConfig,
    feed: ObservableSource,
    syncStatusNotifier: SyncStatusNotifier
): Fork {
    if (config.httpEndpoint) {
        const httpConnection = new XhrConnection(config.httpEndpoint);
        const httpTimeoutSeconds = config.httpTimeoutSeconds || 5;
        const webClient = new WebClient(httpConnection, syncStatusNotifier, {
            timeoutSeconds: httpTimeoutSeconds
        });
        if (config.indexedDb) {
            const queue = new IndexedDBQueue(config.indexedDb);
            const fork = new PersistentFork(feed, queue, webClient);
            return fork;
        }
        else {
            const fork = new TransientFork(feed, webClient);
            return fork;
        }
    }
    else {
        const fork = new PassThroughFork(feed);
        return fork;
    }
}

function createAuthentication(
    config: JinagaBrowserConfig,
    feed: ObservableSource,
    syncStatusNotifier: SyncStatusNotifier
): Authentication {
    if (config.httpEndpoint) {
        const httpConnection = new XhrConnection(config.httpEndpoint);
        const httpTimeoutSeconds = config.httpTimeoutSeconds || 5;
        const webClient = new WebClient(httpConnection, syncStatusNotifier, {
            timeoutSeconds: httpTimeoutSeconds
        });
        if (config.indexedDb) {
            const queue = new IndexedDBQueue(config.indexedDb);
            const fork = new PersistentFork(feed, queue, webClient);
            const loginStore = new IndexedDBLoginStore(config.indexedDb);
            const authentication = new AuthenticationOffline(loginStore, webClient);
            fork.initialize();
            return authentication;
        }
        else {
            const authentication = new AuthenticationWebClient(webClient);
            return authentication;
        }
    }
    else {
        const authentication = new AuthenticationNoOp();
        return authentication;
    }
}