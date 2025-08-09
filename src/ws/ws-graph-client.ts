import { GraphDeserializer } from "../http/deserializer";
import { FactEnvelope, FactReference, Storage } from "../storage";
import { Trace } from "../util/trace";
import { WebSocketMessageRouter } from "./protocol-router";
import { ControlFrameHandler } from "./control-frame-handler";
import { UserIdentity } from "../user-identity";

// Avoid DOM lib dependency; define minimal WebSocket ctor type

// Minimal WebSocket instance interface for this file
interface MinimalWebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((this: MinimalWebSocket, ev: any) => any) | null;
  onclose: ((this: MinimalWebSocket, ev: any) => any) | null;
  onerror: ((this: MinimalWebSocket, ev: any) => any) | null;
  onmessage: ((this: MinimalWebSocket, ev: { data: string }) => any) | null;
}

// Minimal WebSocket constructor type
declare const WebSocket: {
  new (url: string): MinimalWebSocket;
};
type BookmarkListener = (feed: string, bookmark: string) => void;

type ActiveFeed = {
  feed: string;
  bookmark: string;
};

export class WsGraphClient {
  private socket: any | null = null;
  private readonly activeFeeds = new Map<string, ActiveFeed>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private connecting = false;
  private hasEverConnected = false;

  private pendingLines: string[] = [];
  private waitingResolver: ((line: string | null) => void) | null = null;
  private router: WebSocketMessageRouter | null = null;
  private lastSavePromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly getWsUrl: () => Promise<string>,
    private readonly store: Storage,
    private readonly onBookmark: BookmarkListener,
    private readonly onErrorGlobal: (err: Error) => void,
    private readonly getUserIdentity?: () => Promise<UserIdentity | null>,
    private readonly onFactsAdded?: (envelopes: FactEnvelope[]) => Promise<void>
  ) {}

  subscribe(feed: string, bookmark: string): () => void {
    this.activeFeeds.set(feed, { feed, bookmark });
    this.ensureConnected().then(() => this.sendSub(feed, bookmark)).catch(err => this.onErrorGlobal(err instanceof Error ? err : new Error(String(err))));
    return () => {
      this.activeFeeds.delete(feed);
      this.sendUnsub(feed).catch(() => {/* ignore */});
    };
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && this.socket.readyState === 1) return;
    if (this.connecting) {
      await new Promise<void>(resolve => {
        const check = () => {
          if (!this.connecting) resolve();
          else setTimeout(check, 50);
        };
        check();
      });
      return;
    }

    if (typeof WebSocket === "undefined") {
      throw new Error("WebSocket is not available in this environment");
    }

    this.connecting = true;
    try {
      await this.openSocket();
    } finally {
      this.connecting = false;
    }
  }

  private openSocket(): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      try {
        let url = await this.getWsUrl();
        // Optionally append identity as query param if not already included
        if (this.getUserIdentity) {
          try {
            const id = await this.getUserIdentity();
            if (id) {
              const parsed = new URL(url);
              if (!parsed.searchParams.has("uid")) {
                parsed.searchParams.set("uid", `${encodeURIComponent(id.provider)}:${encodeURIComponent(id.id)}`);
                url = parsed.toString();
              }
            }
          } catch { /* ignore */ }
        }
        const socket = new WebSocket(url);
        this.socket = socket;

        socket.onopen = () => {
          this.hasEverConnected = true;
          this.reconnectAttempt = 0;
          // Instantiate router and handler per-connection
          const handler = new ControlFrameHandler(
            (feed, bookmark) => {
              // Defer BOOK processing to next macrotask, then await latest save
              setTimeout(() => {
                this.lastSavePromise
                  .catch(() => {})
                  .then(() => {
                    const active = this.activeFeeds.get(feed);
                    if (active) {
                      active.bookmark = bookmark;
                      this.onBookmark(feed, bookmark);
                    }
                  });
              }, 0);
            },
            (feed, message) => {
              Trace.warn(`Feed error for ${feed}: ${message}`);
            }
          );
          this.router = new WebSocketMessageRouter(
            {
              onGraphLine: (line: string) => {
                this.pendingLines.push(line);
                this.pumpWaiting();
              },
            },
            handler
          );

          // Start graph reader
          this.startGraphReader();
          // Resubscribe all feeds
          for (const { feed, bookmark } of this.activeFeeds.values()) {
            this.sendSub(feed, bookmark).catch(err => Trace.warn(String(err)));
          }
          resolve();
        };

        socket.onmessage = (event: any) => {
          const chunk = typeof event.data === "string" ? event.data : String(event.data);
          this.router?.pushChunk(chunk);
        };

        socket.onerror = () => {
          if (!this.hasEverConnected) {
            this.onErrorGlobal(new Error("WebSocket error"));
          }
        };

        socket.onclose = () => {
          this.scheduleReconnect();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private startGraphReader() {
    const deserializer = new GraphDeserializer(async () => {
      return await this.readLine();
    });

    (async () => {
      try {
        await deserializer.read(async (envelopes: FactEnvelope[]) => {
          const savePromise = this.store.save(envelopes);
          // Track the latest save so control frames can wait for persistence
          this.lastSavePromise = savePromise.then(() => {});
          const saved = await savePromise;
          if (saved.length > 0) {
            Trace.counter("facts_saved", saved.length);
            // Phase 3.4: Notify facts added listener for observer notifications
            if (this.onFactsAdded) {
              await this.onFactsAdded(saved);
            }
          }
        });
      } catch (err) {
        this.onErrorGlobal(err as Error);
      }
    })();
  }

  private pumpWaiting() {
    if (this.waitingResolver && this.pendingLines.length > 0) {
      const resolver = this.waitingResolver;
      this.waitingResolver = null;
      const line = this.pendingLines.shift()!;
      resolver(line);
    }
  }

  private readLine(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const tryDequeue = () => {
        if (this.pendingLines.length === 0) {
          // If socket closed and buffer empty, signal EOF
          if (!this.socket || this.socket.readyState === 3 /* CLOSED */) {
            resolve(null);
            return;
          }
          this.waitingResolver = resolve;
          return;
        }
        const line = this.pendingLines.shift()!;
        resolve(line);
      };
      tryDequeue();
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (this.activeFeeds.size === 0) {
      return; // No active subscriptions; do not reconnect
    }
    const delayMs = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempt));
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 15);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.ensureConnected();
      } catch (err) {
        this.scheduleReconnect();
      }
    }, delayMs);
  }

  private async sendSub(feed: string, bookmark: string): Promise<void> {
    await this.sendFramed(["SUB", JSON.stringify(feed), JSON.stringify(bookmark), ""]);
  }

  private async sendUnsub(feed: string): Promise<void> {
    await this.sendFramed(["UNSUB", JSON.stringify(feed), ""]);
  }

  private async sendFramed(lines: string[]): Promise<void> {
    if (!this.socket || this.socket.readyState !== 1) {
      await this.ensureConnected();
    }
    try {
      for (const l of lines) {
        this.socket!.send(l + "\n");
      }
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}