import { GraphDeserializer } from "../http/deserializer";
import { FactEnvelope, FactReference, Storage, saveAndNotify } from "../storage";
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

/**
 * One frame as it arrived on the socket: either a line of the graph stream or
 * a bookmark from a BOOK control frame.
 *
 * Both kinds go into one queue, which is what makes a bookmark take effect
 * only after every graph line that reached the socket before it. The reader
 * awaits each batch's save before asking for another frame, so by the time it
 * dequeues a bookmark, everything ahead of that bookmark is durable.
 */
type QueuedFrame =
  | { kind: "line", line: string }
  | { kind: "bookmark", feed: string, bookmark: string };

export class WsGraphClient {
  private socket: any | null = null;
  private readonly activeFeeds = new Map<string, ActiveFeed>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private connecting = false;
  private hasEverConnected = false;

  private pendingFrames: QueuedFrame[] = [];
  private waitingResolver: ((frame: QueuedFrame | null) => void) | null = null;
  private router: WebSocketMessageRouter | null = null;

  constructor(
    private readonly getWsUrl: () => Promise<string>,
    private readonly store: Storage,
    private readonly onBookmark: BookmarkListener,
    private readonly onErrorGlobal: (err: Error) => void,
    private readonly getUserIdentity?: () => Promise<UserIdentity | null>,
    private readonly onFactsAdded?: (envelopes: FactEnvelope[]) => Promise<void>
  ) {}

  subscribe(feed: string, bookmark: string, feedRefreshIntervalSeconds: number): () => void {
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
              // Queue the bookmark behind the graph lines that arrived before
              // it, so the reader applies it in arrival order.
              this.enqueue({ kind: "bookmark", feed, bookmark });
            },
            (feed, message) => {
              Trace.warn(`Feed error for ${feed}: ${message}`);
            }
          );
          this.router = new WebSocketMessageRouter(
            {
              onGraphLine: (line: string) => {
                this.enqueue({ kind: "line", line });
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
    const deserializer = new GraphDeserializer(
      async () => {
        return await this.readLine();
      },
      // In a live WebSocket stream there is no natural end-of-stream; flush each fact immediately
      1
    );

    (async () => {
      try {
        await deserializer.read(async (envelopes: FactEnvelope[]) => {
          // Phase 3.4: notify the facts added listener for observer
          // notifications, with exactly what the store reports as added
          // (issue #337).
          await saveAndNotify(this.store, envelopes, added => this.notify(added));
        });
      } catch (err) {
        this.onErrorGlobal(err as Error);
      }
    })();
  }

  /**
   * Run the facts-added notification for one saved batch, and keep a failure
   * out of the reader.
   *
   * The batch is already saved when this runs, so a rejection here means the
   * notification failed and nothing else. Letting it escape would end the
   * reader on a socket that is still open, which stops ingestion until that
   * socket closes. Report it and let the reader go on to the next frame; a
   * bookmark still cannot pass a frame that was never saved, because the
   * reader applies bookmarks from the same queue.
   *
   * A failed *save* is not contained here. It still ends the reader.
   */
  private async notify(added: FactEnvelope[]): Promise<void> {
    if (!this.onFactsAdded) {
      return;
    }
    try {
      await this.onFactsAdded(added);
    } catch (err) {
      this.onErrorGlobal(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private enqueue(frame: QueuedFrame) {
    this.pendingFrames.push(frame);
    this.pumpWaiting();
  }

  private pumpWaiting() {
    if (this.waitingResolver && this.pendingFrames.length > 0) {
      const resolver = this.waitingResolver;
      this.waitingResolver = null;
      resolver(this.pendingFrames.shift()!);
    }
  }

  private takeFrame(): Promise<QueuedFrame | null> {
    return new Promise<QueuedFrame | null>((resolve) => {
      if (this.pendingFrames.length === 0) {
        // If socket closed and buffer empty, signal EOF
        if (!this.socket || this.socket.readyState === 3 /* CLOSED */) {
          resolve(null);
          return;
        }
        this.waitingResolver = resolve;
        return;
      }
      resolve(this.pendingFrames.shift()!);
    });
  }

  /**
   * The deserializer's line source. Bookmarks sit in the same queue as graph
   * lines, so this applies each one it passes on its way to the next line.
   */
  private async readLine(): Promise<string | null> {
    while (true) {
      const frame = await this.takeFrame();
      if (frame === null) {
        return null;
      }
      if (frame.kind === "line") {
        return frame.line;
      }
      this.applyBookmark(frame.feed, frame.bookmark);
    }
  }

  /**
   * Persist a bookmark that the reader has reached in arrival order.
   *
   * Every graph line ahead of it has been read, and the reader awaited each
   * batch's save before asking for the frame that produced this call, so
   * those facts are durable. The reader also awaits the notification, which
   * this does not need; waiting for it costs the bookmark that much latency
   * and never advances it too far.
   */
  private applyBookmark(feed: string, bookmark: string) {
    const active = this.activeFeeds.get(feed);
    if (active) {
      active.bookmark = bookmark;
      this.onBookmark(feed, bookmark);
    }
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