import { WebSocketServer, WebSocket } from "ws";
import { Authorization } from "../authorization/authorization";
import { Specification } from "../specification/specification";
import { invertSpecification } from "../specification/inverse";
import { serializeGraph } from "../http/serializer";
import { FactEnvelope, FactReference, ProjectedResult, ReferencesByName } from "../storage";
import { UserIdentity } from "../user-identity";
import { InverseSpecificationEngine } from "./inverse-specification-engine";
import { BookmarkManager } from "./bookmark-manager";
import { SpecificationListener } from "../observable/observable";
import { DistributionEngine } from "../distribution/distribution-engine";

export type FeedResolver = (feed: string) => Specification;
export type FeedInfoResolver = (feed: string) => { specification: Specification; namedStart: ReferencesByName };

type Subscription = {
  feed: string;
  listeners: SpecificationListener[];
};

export class AuthorizationWebSocketHandler {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly buffers = new WeakMap<WebSocket, string>();

  constructor(
    private readonly authorization: Authorization,
    private readonly resolveFeed: FeedResolver,
    private readonly inverseEngine: InverseSpecificationEngine,
    private readonly bookmarks: BookmarkManager,
    private readonly distributionEngine?: DistributionEngine,
    private readonly resolveFeedInfo?: FeedInfoResolver
  ) {}

  handleConnection(socket: WebSocket, userIdentity: UserIdentity | null) {
    this.buffers.set(socket, "");
    socket.on("message", async (data: any) => {
      const text = typeof data === "string" ? data : String(data);
      await this.pushChunk(socket, userIdentity, text);
    });

    socket.on("close", () => {
      // Cleanup all listeners on disconnect
      for (const sub of this.subscriptions.values()) {
        for (const token of sub.listeners) {
          this.inverseEngine.removeSpecificationListener(token);
        }
      }
      this.subscriptions.clear();
    });
  }

  private async pushChunk(socket: WebSocket, userIdentity: UserIdentity | null, chunk: string) {
    // Append to per-socket buffer and attempt to parse complete frames
    const existing = this.buffers.get(socket) ?? "";
    let buffer = existing + chunk;
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? ""; // remainder without trailing newline

    let i = 0;
    while (i < parts.length) {
      const line = parts[i];
      if (line === "SUB" || line === "UNSUB") {
        const keyword = line;
        i++;
        const payload: string[] = [];
        while (i < parts.length) {
          const next = parts[i];
          if (next === "") {
            break;
          }
            payload.push(next);
            i++;
        }
        // If we have a blank line terminator, ensure we have enough payload lines; otherwise treat as incomplete
        if (i >= parts.length || parts[i] !== "") {
                     // No terminator present; reconstruct remainder and exit
           // Preserve line break so next chunk starts on a new line
           const remainder = [keyword, ...payload].join("\n") + "\n";
           buffer = remainder + (buffer ? buffer : "");
           break;
        }
        const required = keyword === "SUB" ? 2 : 1;
        if (payload.length < required) {
          // Not enough payload yet; push back without consuming terminator.
          // Preserve line break so the next incoming payload line does not concatenate with the keyword or prior payload.
          const remainder = [keyword, ...payload].join("\n") + "\n";
          buffer = remainder + (buffer ? buffer : "");
          break;
        }
        // Consume blank terminator
        i++;
        try {
          if (keyword === "SUB") {
            const feed = JSON.parse(payload[0] || '""');
            const bookmark = JSON.parse(payload[1] || '""');
            await this.handleSub(socket, userIdentity, feed, bookmark);
          } else {
            const feed = JSON.parse(payload[0] || '""');
            this.handleUnsub(feed);
          }
        } catch {
          // Ignore malformed frame
        }
        continue;
      }
      // Unknown line; ignore
      i++;
    }

    // Save updated buffer
    this.buffers.set(socket, buffer);
  }

  private async handleSub(socket: WebSocket, userIdentity: UserIdentity | null, feed: string, bookmark: string) {
    try {
      const specification = this.resolveFeed(feed);
      const start: FactReference[] = [];

      // Optional distribution enforcement: if engine and resolver provided, validate access
      if (this.distributionEngine && this.resolveFeedInfo) {
        try {
          const { specification: feedSpec, namedStart } = this.resolveFeedInfo(feed);
          let userRef: FactReference | null = null;
          if (userIdentity) {
            const userFact = await this.authorization.getOrCreateUserFact(userIdentity);
            userRef = { type: userFact.type, hash: userFact.hash };
          }
          const result = await this.distributionEngine.canDistributeToAll([feedSpec], namedStart, userRef);
          if (result.type === "failure") {
            const message = `Not authorized: ${result.reason}`;
            socket.send(`ERR\n${JSON.stringify(feed)}\n${JSON.stringify(message)}\n\n`);
            return; // Do not proceed with subscription
          }
        } catch (e: any) {
          const message = e && e.message ? e.message : String(e);
          socket.send(`ERR\n${JSON.stringify(feed)}\n${JSON.stringify(message)}\n\n`);
          return;
        }
      }

      // If server already has a more recent bookmark for this feed, sync it to client
      const serverKnown = this.bookmarks.syncBookmarkIfMismatch(feed, bookmark);
      if (serverKnown) {
        socket.send(`BOOK\n${JSON.stringify(feed)}\n${JSON.stringify(serverKnown)}\n\n`);
      }

      const factFeed = await this.authorization.feed(userIdentity, specification, start, bookmark);

      if (factFeed.tuples.length > 0) {
        const references: FactReference[] = factFeed.tuples.flatMap(t => t.facts);
        const envelopes: FactEnvelope[] = await this.authorization.load(userIdentity, references);
        socket.send(serializeGraph(envelopes));
      }

      // Set initial bookmark if changed
      const nextBookmark = factFeed.bookmark || bookmark;
      if (nextBookmark && nextBookmark !== bookmark) {
        this.bookmarks.setBookmark(feed, nextBookmark);
        socket.send(`BOOK\n${JSON.stringify(feed)}\n${JSON.stringify(nextBookmark)}\n\n`);
      }

      // Register inverse specification listeners for reactive updates
      const inverses = invertSpecification(specification);
      const listenerTokens: SpecificationListener[] = [];
      for (const inv of inverses) {
        const token = this.inverseEngine.addSpecificationListener(inv.inverseSpecification, async (results: ProjectedResult[]) => {
          if (inv.operation === "add") {
            const refs: FactReference[] = results.flatMap(r => Object.values(r.tuple));
            if (refs.length > 0) {
              const envs = await this.authorization.load(userIdentity, refs);
              socket.send(serializeGraph(envs));
            }
            const advanced = await this.bookmarks.advanceBookmark(feed);
            socket.send(`BOOK\n${JSON.stringify(feed)}\n${JSON.stringify(advanced)}\n\n`);
          } else if (inv.operation === "remove") {
            // No facts to send; just advance bookmark to signal change
            const advanced = await this.bookmarks.advanceBookmark(feed);
            socket.send(`BOOK\n${JSON.stringify(feed)}\n${JSON.stringify(advanced)}\n\n`);
          }
        });
        listenerTokens.push(token);
      }
      this.subscriptions.set(feed, { feed, listeners: listenerTokens });
    } catch (e: any) {
      const message = e && e.message ? e.message : String(e);
      socket.send(`ERR\n${JSON.stringify(feed)}\n${JSON.stringify(message)}\n\n`);
    }
  }

  private handleUnsub(feed: string) {
    const sub = this.subscriptions.get(feed);
    if (sub) {
      for (const token of sub.listeners) {
        this.inverseEngine.removeSpecificationListener(token);
      }
      this.subscriptions.delete(feed);
    }
  }
}