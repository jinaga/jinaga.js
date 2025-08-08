import { Network } from "../managers/NetworkManager";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactReference, Storage } from "../storage";
import { FeedResponse } from "../http/messages";
import { HttpNetwork } from "../http/httpNetwork";
import { WsGraphClient } from "./ws-graph-client";

export class WsGraphNetwork implements Network {
  private readonly wsClient: WsGraphClient;

  constructor(
    private readonly httpNetwork: HttpNetwork,
    store: Storage,
    wsEndpoint: string
  ) {
    this.wsClient = new WsGraphClient(
      async () => wsEndpoint,
      store,
      (feed, bookmark) => this.onBookmarkAdvance(feed, bookmark),
      (err) => this.onGlobalError(err)
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
    onError: (err: Error) => void
  ): () => void {
    // Register a temporary handler for BOOK events for this feed
    this.onResponseHandlers.set(feed, onResponse);
    this.onErrorHandlers.set(feed, onError);
    const unsubscribe = this.wsClient.subscribe(feed, bookmark);
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
}