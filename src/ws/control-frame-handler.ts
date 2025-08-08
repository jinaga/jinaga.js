import { ControlFrame } from "./types";

export class ControlFrameHandler {
  constructor(
    private readonly onBookmark: (feed: string, bookmark: string) => void,
    private readonly onErrorMessage: (feed: string, message: string) => void
  ) {}

  handle(frame: ControlFrame): void {
    const { keyword, payload } = frame;
    if (keyword === "BOOK") {
      if (payload.length !== 2) {
        throw new Error(`Invalid BOOK frame payload length: ${payload.length}`);
      }
      const feed = JSON.parse(payload[0]) as string;
      const bookmark = JSON.parse(payload[1]) as string;
      this.onBookmark(feed, bookmark);
      return;
    }
    if (keyword === "ERR") {
      if (payload.length !== 2) {
        throw new Error(`Invalid ERR frame payload length: ${payload.length}`);
      }
      const feed = JSON.parse(payload[0]) as string;
      const message = JSON.parse(payload[1]) as string;
      this.onErrorMessage(feed, message);
      return;
    }
    // Ignore SUB/UNSUB sent from server (defensive)
  }
}