import { Authentication } from "./authentication/authentication";
import { AuthenticationNoOp } from "./authentication/authentication-noop";
import { AuthenticationOffline } from "./authentication/authentication-offline";
import { AuthenticationWebClient } from "./authentication/authentication-web-client";
import { Fork } from "./fork/fork";
import { PassThroughFork } from "./fork/pass-through-fork";
import { PersistentFork } from "./fork/persistent-fork";
import { TransientFork } from "./fork/transient-fork";
import { AuthenticationProvider } from "./http/authenticationProvider";
import { FetchConnection } from "./http/fetch";
import { HttpNetwork } from "./http/httpNetwork";
import { SyncStatusNotifier, WebClient } from "./http/web-client";
import { IndexedDBLoginStore } from "./indexeddb/indexeddb-login-store";
import { IndexedDBQueue } from "./indexeddb/indexeddb-queue";
import { IndexedDBStore } from "./indexeddb/indexeddb-store";
import { Jinaga } from "./jinaga";
import { FactManager } from "./managers/factManager";
import { Network, NetworkNoOp } from "./managers/NetworkManager";
import { MemoryStore } from "./memory/memory-store";
import { ObservableSource } from "./observable/observable";
import { PurgeConditions } from "./purge/purgeConditions";
import { validatePurgeSpecification } from "./purge/validate";
import { Specification } from "./specification/specification";
import { Storage } from "./storage";

export type JinagaBrowserConfig = {
    httpEndpoint?: string,
    wsEndpoint?: string,
    indexedDb?: string,
    httpTimeoutSeconds?: number,
    httpAuthenticationProvider?: AuthenticationProvider,
    queueProcessingDelayMs?: number,
    purgeConditions?: (p: PurgeConditions) => PurgeConditions
}

export class JinagaBrowser {
    static create(config: JinagaBrowserConfig) {
        const store = createStore(config);
        const observableSource = new ObservableSource(store);
        const syncStatusNotifier = new SyncStatusNotifier();
        const webClient = createWebClient(config, syncStatusNotifier);
        const fork = createFork(config, store, webClient);
        const authentication = createAuthentication(config, webClient);
        const network = createNetwork(webClient);
        const purgeConditions = createPurgeConditions(config);
        const factManager = new FactManager(fork, observableSource, store, network, purgeConditions);
        return new Jinaga(authentication, factManager, syncStatusNotifier);
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

function createWebClient(
    config: JinagaBrowserConfig,
    syncStatusNotifier: SyncStatusNotifier
): WebClient | null {
    if (config.httpEndpoint) {
        const provider = config.httpAuthenticationProvider;
        const getHeaders = provider
            ? () => provider.getHeaders()
            : () => Promise.resolve({});
        const reauthenticate = provider
            ? () => provider.reauthenticate()
            : () => Promise.resolve(false);
        const httpConnection = new FetchConnection(config.httpEndpoint, getHeaders, reauthenticate);
        const httpTimeoutSeconds = config.httpTimeoutSeconds || 30;
        const webClient = new WebClient(httpConnection, syncStatusNotifier, {
            timeoutSeconds: httpTimeoutSeconds
        });
        return webClient;
    }
    else {
        return null;
    }
}

function createFork(
    config: JinagaBrowserConfig,
    store: Storage,
    webClient: WebClient | null
): Fork {
    if (webClient) {
        if (config.indexedDb) {
            const queue = new IndexedDBQueue(config.indexedDb);
            const queueProcessingDelay = config.queueProcessingDelayMs || 100;
            const fork = new PersistentFork(store, queue, webClient, queueProcessingDelay);
            fork.initialize();
            return fork;
        }
        else {
            const fork = new TransientFork(store, webClient);
            return fork;
        }
    }
    else {
        const fork = new PassThroughFork(store);
        return fork;
    }
}

function createAuthentication(
    config: JinagaBrowserConfig,
    webClient: WebClient | null
): Authentication {
    if (webClient) {
        if (config.indexedDb) {
            const loginStore = new IndexedDBLoginStore(config.indexedDb);
            const authentication = new AuthenticationOffline(loginStore, webClient);
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

function createNetwork(
    webClient: WebClient | null
): Network {
    if (webClient) {
        const network = new HttpNetwork(webClient);
        return network;
    }
    else {
        return new NetworkNoOp();
    }
}

function createPurgeConditions(
    config: JinagaBrowserConfig
): Specification[] {
    if (config.purgeConditions) {
        var specifications = config.purgeConditions(new PurgeConditions([])).specifications;
        var validationFailures: string[] = specifications.map(specification =>
            validatePurgeSpecification(specification)).flat();
        if (validationFailures.length > 0) {
            throw new Error(validationFailures.join("\n"));
        }
        return specifications;
    }
    else {
        return [];
    }
}