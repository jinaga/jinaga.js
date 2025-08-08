import { Network } from "../managers/NetworkManager";
import { Specification } from "../specification/specification";
import { FactEnvelope, FactReference } from "../storage";
import { FeedResponse } from "../http/messages";
import { HttpNetwork } from "../http/httpNetwork";
import { WsClient } from "./ws-client";

export class WsNetwork implements Network {
  constructor(
    private readonly httpNetwork: HttpNetwork,
    private readonly wsClient: WsClient
  ) {}

  feeds(start: FactReference[], specification: Specification): Promise<string[]> {
    // Feed identification still via HTTP
    return this.httpNetwork.feeds(start, specification);
  }

  fetchFeed(feed: string, bookmark: string): Promise<FeedResponse> {
    // One-off fetch remains HTTP for initial loads
    return this.httpNetwork.fetchFeed(feed, bookmark);
  }

  streamFeed(
    feed: string,
    bookmark: string,
    onResponse: (factReferences: FactReference[], nextBookmark: string) => Promise<void>,
    onError: (err: Error) => void
  ): () => void {
    // Use WebSocket stream; returns unsubscribe
    return this.wsClient.subscribe(feed, bookmark, onResponse, onError);
  }

  load(factReferences: FactReference[]): Promise<FactEnvelope[]> {
    return this.httpNetwork.load(factReferences);
  }
}