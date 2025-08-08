import { GraphDeserializer } from "../http/deserializer";
import { FactEnvelope, FactReference, Storage } from "../storage";
import { Trace } from "../util/trace";

// Avoid DOM lib dependency; define minimal WebSocket ctor type
declare const WebSocket: any;

type BookmarkListener = (feed: string, bookmark: string) => void;

type ActiveFeed = {
  feed: string;
  bookmark: string;
};

export class WsGraphClient {
  private socket: any | null = null;
  private buffer: string = "";
  private readonly activeFeeds = new Map<string, ActiveFeed>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private connecting = false;
  private hasEverConnected = false;

  private pendingLines: string[] = [];
  private waitingResolver: ((line: string | null) => void) | null = null;

  constructor(
    private readonly getWsUrl: () => Promise<string>,
    private readonly store: Storage,
    private readonly onBookmark: BookmarkListener,
    private readonly onErrorGlobal: (err: Error) => void
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
        const url = await this.getWsUrl();
        const socket = new WebSocket(url);
        this.socket = socket;

        socket.onopen = () => {
          this.hasEverConnected = true;
          this.reconnectAttempt = 0;
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
          this.buffer += chunk;
          this.flushLines();
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
          const saved = await this.store.save(envelopes);
          if (saved.length > 0) {
            Trace.counter("facts_saved", saved.length);
          }
        });
      } catch (err) {
        this.onErrorGlobal(err as Error);
      }
    })();
  }

  private flushLines() {
    // Split buffer by newlines, keep trailing partial in buffer
    const parts = this.buffer.split(/\r?\n/);
    this.buffer = parts.pop() ?? "";
    this.pendingLines.push(...parts);
    this.pumpWaiting();
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
    // Interleave control frames parsing here
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
        if (line === "SUB" || line === "UNSUB" || line === "BOOK" || line === "ERR") {
          this.handleControlFrame(line).then(() => {
            // After control frame handled, continue reading next line
            tryDequeue();
          }).catch(err => this.onErrorGlobal(err));
          return;
        }
        resolve(line);
      };
      tryDequeue();
    });
  }

  private async handleControlFrame(keyword: string): Promise<void> {
    const readJsonLine = async () => {
      const l = await this.readLine();
      if (l === null) throw new Error("Unexpected EOF in control frame");
      return JSON.parse(l);
    };
    if (keyword === "BOOK") {
      const feed: string = await readJsonLine();
      const bookmark: string = await readJsonLine();
      const empty = await this.readLine();
      if (empty !== "") throw new Error("Expected blank line after BOOK");
      const active = this.activeFeeds.get(feed);
      if (active) {
        active.bookmark = bookmark;
        this.onBookmark(feed, bookmark);
      }
      return;
    }
    if (keyword === "ERR") {
      const feed: string = await readJsonLine();
      const message: string = await readJsonLine();
      const empty = await this.readLine();
      if (empty !== "") throw new Error("Expected blank line after ERR");
      Trace.warn(`Feed error for ${feed}: ${message}`);
      return;
    }
    if (keyword === "SUB") {
      // Server should not send SUB back; read until blank line to realign
      while ((await this.readLine()) !== "") { /* discard */ }
      return;
    }
    if (keyword === "UNSUB") {
      while ((await this.readLine()) !== "") { /* discard */ }
      return;
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