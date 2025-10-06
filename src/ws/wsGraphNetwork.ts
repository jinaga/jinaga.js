import { Network } from "../managers/NetworkManager";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactReference, Storage } from "../storage";
import { FeedResponse } from "../http/messages";
import { HttpNetwork } from "../http/httpNetwork";
import { WsGraphClient } from "./ws-graph-client";
import { UserIdentity } from "../user-identity";

export class WsGraphNetwork implements Network {
  private readonly wsClient: WsGraphClient;
  private factsAddedListener?: (envelopes: FactEnvelope[]) => Promise<void>;

  constructor(
    private readonly httpNetwork: HttpNetwork,
    store: Storage,
    wsEndpoint: string,
    getUserIdentity?: () => Promise<UserIdentity | null>,
    getAuthorizationHeader?: () => Promise<string | null>
  ) {
    const getWsUrl = async () => {
      try {
        const url = new URL(wsEndpoint);
        // Append Authorization token if provided (browsers cannot set custom WS headers)
        if (getAuthorizationHeader) {
          try {
            const auth = await getAuthorizationHeader();
            if (auth) {
              url.searchParams.set("authorization", auth);
            }
          }
          catch {
            // ignore auth retrieval failures
          }
        }
        // Optionally append user identity
        if (getUserIdentity) {
          try {
            const id = await getUserIdentity();
            if (id) {
              url.searchParams.set("uid", `${encodeURIComponent(id.provider)}:${encodeURIComponent(id.id)}`);
            }
          }
          catch {
            // ignore identity retrieval failures
          }
        }
        return url.toString();
      }
      catch {
        return wsEndpoint;
      }
    };
    this.wsClient = new WsGraphClient(
      getWsUrl,
      store,
      (feed, bookmark) => this.onBookmarkAdvance(feed, bookmark),
      (err) => this.onGlobalError(err),
      getUserIdentity,
      (envelopes) => this.onFactsAdded(envelopes)
    );
  }

  feeds(start: FactReference[], specification: Specification): Promise<string[]> {
    return this.httpNetwork.feeds(start, specification);
  }

  fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
    return this.httpNetwork.fetchFeed(feed, bookmark);
  }

  streamFeed(
    feed: string,
    bookmark: string,
    onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>,
    onError: (err: Error) => void,
    feedRefreshIntervalSeconds: number
  ): () => void {
    // Register a temporary handler for BOOK events for this feed
    this.onResponseHandlers.set(feed, onResponse);
    this.onErrorHandlers.set(feed, onError);
    const unsubscribe = this.wsClient.subscribe(feed, bookmark, feedRefreshIntervalSeconds);
    return () => {
      this.onResponseHandlers.delete(feed);
      this.onErrorHandlers.delete(feed);
      unsubscribe();
    };
  }

  load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
    return this.httpNetwork.load(factReferences);
  }

  // Internal per-feed event maps
  private readonly onResponseHandlers = new Map<string, (factReferences: FactReference[], nextBookmark: string) => Promise<void>>();
  private readonly onErrorHandlers = new Map<string, (err: Error) => void>();

  private async onBookmarkAdvance(feed: string, bookmark: string) {
    const handler = this.onResponseHandlers.get(feed);
    if (handler) {
      // Facts already persisted via graph stream, notify empty refs with updated bookmark
      await handler([], bookmark);
    }
  }

  private onGlobalError(err: Error) {
    // Broadcast error to all active feeds
    for (const h of this.onErrorHandlers.values()) {
      h(err);
    }
  }

  // Phase 3.4: Observer-notification bridge
  setFactsAddedListener(listener: (envelopes: FactEnvelope[]) => Promise<void>) {
    this.factsAddedListener = listener;
  }

  // Called by WsGraphClient when facts are added via WS
  async onFactsAdded(envelopes: FactEnvelope[]) {
    if (this.factsAddedListener) {
      await this.factsAddedListener(envelopes);
    }
  }
}