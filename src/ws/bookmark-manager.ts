export class BookmarkManager {
  private readonly bookmarks = new Map<string, string>();
  private counter = 0;

  getBookmark(feed: string): string {
    return this.bookmarks.get(feed) ?? "";
  }

  setBookmark(feed: string, bookmark: string): void {
    this.bookmarks.set(feed, bookmark);
  }

  async advanceBookmark(feed: string): Promise<string> {
    const next = `${Date.now()}:${this.counter++}`;
    this.bookmarks.set(feed, next);
    return next;
  }

  /**
   * If a bookmark is already known for the feed and differs from the provided value,
   * return the known bookmark so callers can synchronize the client.
   * Returns null if no sync is necessary.
   */
  syncBookmarkIfMismatch(feed: string, provided: string): string | null {
    const current = this.bookmarks.get(feed);
    if (current && current !== provided) {
      return current;
    }
    return null;
  }
}