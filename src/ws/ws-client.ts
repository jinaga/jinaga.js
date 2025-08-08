/*
 * Lightweight WebSocket client for Jinaga feed subscriptions.
 * - Maintains a single shared connection
 * - Multiplexes multiple feed subscriptions
 * - Automatically reconnects with exponential backoff
 * - Resubscribes active feeds with last known bookmarks after reconnect
 * - Falls back gracefully if WebSocket is unavailable (handled by caller)
 */

import { FactReference } from "../storage";
import { Trace } from "../util/trace";

// Avoid DOM lib dependency; define minimal WebSocket ctor type
declare const WebSocket: any;

export type WsOnResponse = (factReferences: FactReference[], nextBookmark: string) => Promise<void>;
export type WsOnError = (err: Error) => void;

type ActiveSubscription = {
  feed: string;
  lastBookmark: string;
  onResponse: WsOnResponse;
  onError: WsOnError;
};

export class WsClient {
  private socket: any | null = null;
  private readonly subscriptions = new Map<string, ActiveSubscription>();
  private isConnecting = false;
  private hasEverConnected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;

  constructor(private readonly wsEndpoint: string) {}

  subscribe(feed: string, bookmark: string, onResponse: WsOnResponse, onError: WsOnError): () => void {
    const sub: ActiveSubscription = { feed, lastBookmark: bookmark, onResponse, onError };
    this.subscriptions.set(feed, sub);

    this.ensureConnected()
      .then(() => this.send({ type: "subscribe", feed, bookmark }))
      .catch(err => onError(err instanceof Error ? err : new Error(String(err))));

    return () => {
      // Unsubscribe locally and inform server if connected
      this.subscriptions.delete(feed);
      this.send({ type: "unsubscribe", feed }).catch(() => {/* ignore */});
    };
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && this.socket.readyState === 1 /* OPEN */) {
      return;
    }
    if (this.isConnecting) {
      // Wait until the current connection attempt finishes
      await new Promise<void>((resolve) => {
        const check = () => {
          if (!this.isConnecting) resolve();
          else setTimeout(check, 50);
        };
        check();
      });
      return;
    }

    if (typeof WebSocket === "undefined") {
      throw new Error("WebSocket is not available in this environment");
    }

    this.isConnecting = true;
    try {
      await this.openSocket();
    }
    finally {
      this.isConnecting = false;
    }
  }

  private openSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        const socket = new WebSocket(this.wsEndpoint);
        this.socket = socket;

        socket.onopen = () => {
          this.hasEverConnected = true;
          this.reconnectAttempt = 0;
          // Resubscribe all active feeds with last known bookmarks
          for (const { feed, lastBookmark } of this.subscriptions.values()) {
            this.send({ type: "subscribe", feed, bookmark: lastBookmark }).catch(err => Trace.warn(String(err)));
          }
          resolve();
        };

        socket.onmessage = async (event: any) => {
          try {
            const message = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
            await this.handleMessage(message);
          } catch (err) {
            Trace.warn(`WebSocket message handling error: ${String(err)}`);
          }
        };

        socket.onerror = (event: any) => {
          // Browser emits generic event; map to error
          const err = new Error("WebSocket error");
          // Notify all subscribers only on first failure if never connected
          if (!this.hasEverConnected) {
            for (const sub of this.subscriptions.values()) {
              sub.onError(err);
            }
          }
        };

        socket.onclose = () => {
          // Attempt reconnect with backoff
          this.scheduleReconnect();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private async handleMessage(message: any) {
    // Expected server message: { type: 'match', feed, references: FactReference[], bookmark: string }
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "match" && typeof message.feed === "string") {
      const sub = this.subscriptions.get(message.feed);
      if (!sub) return;

      const factReferences: FactReference[] = message.references || [];
      const nextBookmark: string = message.bookmark || sub.lastBookmark;
      sub.lastBookmark = nextBookmark;
      await sub.onResponse(factReferences, nextBookmark);
      return;
    }

    if (message.type === "error" && typeof message.feed === "string") {
      const sub = this.subscriptions.get(message.feed);
      if (sub) {
        sub.onError(new Error(message.message || "WebSocket subscription error"));
      }
      return;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return; // Already scheduled
    }

    // Exponential backoff up to 30 seconds
    const delayMs = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempt));
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 15);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.ensureConnected();
      } catch (err) {
        // If still failing, schedule again
        this.scheduleReconnect();
      }
    }, delayMs);
  }

  private async send(obj: any): Promise<void> {
    if (!this.socket || this.socket.readyState !== 1 /* OPEN */) {
      // If not connected, either connecting or closed; ensure connection first
      await this.ensureConnected();
    }
    try {
      this.socket!.send(JSON.stringify(obj));
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}