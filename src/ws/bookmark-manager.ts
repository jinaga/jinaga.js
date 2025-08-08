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
}