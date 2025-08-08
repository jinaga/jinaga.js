import { WebSocketServer, WebSocket } from "ws";
import { Authorization } from "../authorization/authorization";
import { Specification } from "../specification/specification";
import { invertSpecification } from "../specification/inverse";
import { serializeGraph } from "../http/serializer";
import { FactEnvelope, FactReference } from "../storage";
import { UserIdentity } from "../user-identity";

export type FeedResolver = (feed: string) => Specification;

export class AuthorizationWebSocketHandler {
  constructor(
    private readonly authorization: Authorization,
    private readonly resolveFeed: FeedResolver
  ) {}

  handleConnection(socket: WebSocket, userIdentity: UserIdentity | null) {
    // Expect SUB/UNSUB frames in the same line-based framing as client
    socket.on("message", async (data: any) => {
      const text = typeof data === "string" ? data : String(data);
      await this.processIncoming(socket, userIdentity, text);
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
        // Consume blank line
        i++;
        await this.handleSub(socket, userIdentity, feed, bookmark);
        continue;
      }
      if (line === "UNSUB") {
        // Consume feed and blank line
        i += 2;
        continue;
      }
      // Ignore other lines (graph data is not expected from client)
    }
  }

  private async handleSub(socket: WebSocket, userIdentity: UserIdentity | null, feed: string, bookmark: string) {
    try {
      const specification = this.resolveFeed(feed);
      const start: FactReference[] = [];
      const factFeed = await this.authorization.feed(userIdentity, specification, start, bookmark);

      if (factFeed.tuples.length > 0) {
        const references: FactReference[] = factFeed.tuples.flatMap(t => Object.values(t.tuple));
        const envelopes: FactEnvelope[] = await this.authorization.load(userIdentity, references);
        const body = serializeGraph(envelopes);
        socket.send(body);
      }

      if (factFeed.bookmark && factFeed.bookmark !== bookmark) {
        socket.send(`BOOK\n${JSON.stringify(feed)}\n${JSON.stringify(factFeed.bookmark)}\n\n`);
      }

      // Inverse specification integration will be added in a later sub-phase
    } catch (e: any) {
      const message = e && e.message ? e.message : String(e);
      socket.send(`ERR\n${JSON.stringify(feed)}\n${JSON.stringify(message)}\n\n`);
    }
  }
}