import { Authentication } from "./authentication/authentication";
import { AuthenticationImpl } from "./authentication/authentication-impl";
import { AuthenticationNoOp } from "./authentication/authentication-noop";
import { AuthenticationOffline } from "./authentication/authentication-offline";
import { Feed } from "./feed/feed";
import { FeedImpl } from "./feed/feed-impl";
import { PersistentFork } from "./fork/persistent-fork";
import { TransientFork } from "./fork/transient-fork";
import { SyncStatus, SyncStatusNotifier, WebClient } from "./http/web-client";
import { XhrConnection } from "./http/xhr";
import { IndexedDBLoginStore } from "./indexeddb/indexeddb-login-store";
import { IndexedDBQueue } from "./indexeddb/indexeddb-queue";
import { IndexedDBStore } from "./indexeddb/indexeddb-store";
import { ensure, FactDescription, Jinaga, Preposition, Trace, Tracer } from "./jinaga";
import { MemoryStore } from "./memory/memory-store";
import { User, UserName } from "./model/user";
import { Storage } from "./storage";
import { Watch } from "./watch/watch";

export { Jinaga, Watch, SyncStatus, Preposition, Trace, Tracer, ensure, FactDescription, User, UserName };

export type JinagaBrowserConfig = {
    httpEndpoint?: string,
    wsEndpoint?: string,
    indexedDb?: string,
    httpTimeoutSeconds?: number
}

export class JinagaBrowser {
    static create(config: JinagaBrowserConfig) {
        const store = createStore(config);
        const feed = new FeedImpl(store);
        const syncStatusNotifier = new SyncStatusNotifier();
        const authentication = createAuthentication(config, feed, syncStatusNotifier);
        return new Jinaga(authentication, null, syncStatusNotifier);
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

function createAuthentication(
    config: JinagaBrowserConfig,
    feed: Feed,
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
            const authentication = new AuthenticationOffline(fork, loginStore, webClient);
            fork.initialize();
            return authentication;
        }
        else {
            const fork = new TransientFork(feed, webClient);
            const authentication = new AuthenticationImpl(fork, webClient);
            return authentication;
        }
    }
    else {
        const authentication = new AuthenticationNoOp(feed);
        return authentication;
    }
}