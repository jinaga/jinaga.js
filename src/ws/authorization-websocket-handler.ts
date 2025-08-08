import { WebSocketServer, WebSocket } from "ws";
import { Authorization } from "../authorization/authorization";
import { Specification } from "../specification/specification";
import { invertSpecification } from "../specification/inverse";
import { serializeGraph } from "../http/serializer";
import { FactEnvelope, FactReference, ProjectedResult } from "../storage";
import { UserIdentity } from "../user-identity";
import { InverseSpecificationEngine } from "./inverse-specification-engine";
import { BookmarkManager } from "./bookmark-manager";
import { SpecificationListener } from "../observable/observable";

export type FeedResolver = (feed: string) => Specification;

type Subscription = {
  feed: string;
  listeners: SpecificationListener[];
};

export class AuthorizationWebSocketHandler {
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(
    private readonly authorization: Authorization,
    private readonly resolveFeed: FeedResolver,
    private readonly inverseEngine: InverseSpecificationEngine,
    private readonly bookmarks: BookmarkManager
  ) {}

  handleConnection(socket: WebSocket, userIdentity: UserIdentity | null) {
    socket.on("message", async (data: any) => {
      const text = typeof data === "string" ? data : String(data);
      await this.processIncoming(socket, userIdentity, text);
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

  private async processIncoming(socket: WebSocket, userIdentity: UserIdentity | null, chunk: string) {
    const lines = chunk.split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i++];
      if (line === "SUB") {
        const feed = JSON.parse(lines[i++] || "\"\"");
        const bookmark = JSON.parse(lines[i++] || "\"\"");
        i++; // blank line
        await this.handleSub(socket, userIdentity, feed, bookmark);
        continue;
      }
      if (line === "UNSUB") {
        const feed = JSON.parse(lines[i++] || "\"\"");
        i++; // blank line
        this.handleUnsub(feed);
        continue;
      }
    }
  }

  private async handleSub(socket: WebSocket, userIdentity: UserIdentity | null, feed: string, bookmark: string) {
    try {
      const specification = this.resolveFeed(feed);
      const start: FactReference[] = [];
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