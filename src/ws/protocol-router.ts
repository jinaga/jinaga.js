import { ControlKeyword, ControlFrame, ProtocolMessageRouterCallbacks } from "./types";
import { ControlFrameHandler } from "./control-frame-handler";

const CONTROL_KEYWORDS: ReadonlySet<string> = new Set(["BOOK", "ERR", "SUB", "UNSUB"]);

export class WebSocketMessageRouter {
  private buffer: string = "";

  constructor(
    private readonly callbacks: ProtocolMessageRouterCallbacks,
    private readonly controlHandler: ControlFrameHandler
  ) {}

  pushChunk(chunk: string): void {
    this.buffer += typeof chunk === "string" ? chunk : String(chunk);
    this.flush();
  }

  private flush(): void {
    const parts = this.buffer.split(/\r?\n/);
    this.buffer = parts.pop() ?? "";

    for (let i = 0; i < parts.length; i++) {
      const line = parts[i];
      if (CONTROL_KEYWORDS.has(line)) {
        const keyword = line as ControlKeyword;
        const payload: string[] = [];
        // Collect until blank terminator; payload lines are JSON-encoded strings
        i++;
        while (i < parts.length) {
          const next = parts[i];
          if (next === "") {
            break;
          }
          payload.push(next);
          i++;
        }
        // If we ran out without a blank line terminator, stash partial back into buffer
        if (i >= parts.length || parts[i] !== "") {
          // Reconstruct the partial frame back into buffer including keyword and payload
          const remainder = [keyword, ...payload].join("\n");
          this.buffer = remainder + (this.buffer ? "\n" + this.buffer : "");
          return;
        }
        // Process complete control frame
        const frame: ControlFrame = { keyword, payload };
        try {
          this.controlHandler.handle(frame);
        } catch (err) {
          // Swallow handler errors; protocol continues
          // Optionally could log; omitted to keep router generic
        }
        continue;
      }

      // Not a control keyword; forward to graph line consumer
      this.callbacks.onGraphLine(line);
    }
  }
}