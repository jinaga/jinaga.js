import { HttpError } from "../http/errors";
import { Network } from "../managers/NetworkManager";
import { Storage, FactEnvelope, FactReference } from "../storage";
import { Trace } from "../util/trace";

export class Subscriber {
  private refCount: number = 0;
  private bookmark: string = "";
  private resolved: boolean = false;
  private disconnect: (() => void) | undefined;
  private timer: NodeJS.Timer | undefined;
  private reject: ((reason?: any) => void) | undefined;
  private reregistering: boolean = false;

  constructor(
    private readonly feed: string,
    private readonly network: Network,
    private readonly store: Storage,
    private readonly notifyFactsAdded: (envelopes: FactEnvelope[]) => Promise<void>,
    private readonly refreshIntervalSeconds: number,
    /**
     * Ask the owner to register this feed with the replicator again, because
     * the replicator says it no longer holds it (issue #243). Optional so a
     * Subscriber can still be constructed without one; a subscription that has
     * no way to re-register simply keeps its old retry behavior.
     */
    private readonly reregisterFeed?: () => Promise<void>
  ) {}

  addRef() {
    this.refCount++;
    return this.refCount === 1;
  }

  release() {
    this.refCount--;
    return this.refCount === 0;
  }

  async start(): Promise<void> {
    this.bookmark = await this.store.loadBookmark(this.feed);
    try {
      await new Promise<void>((resolve, reject) => {
        this.resolved = false;
        this.reject = reject;
        // Refresh the connection at the configured interval.
        this.disconnect = this.connectToFeed(resolve, reject);
        this.timer = setInterval(() => {
          if (this.disconnect) {
            this.disconnect();
          }
          this.disconnect = this.connectToFeed(resolve, reject);
        }, this.refreshIntervalSeconds * 1000);
      });
    } finally {
      // Clear the reject reference so we don't hold a closure after start() settles.
      this.reject = undefined;
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.disconnect) {
      this.disconnect();
      this.disconnect = undefined;
    }
    // If the start() promise is still pending (no successful response yet),
    // reject it so the awaiting caller is not permanently suspended.
    if (!this.resolved && this.reject) {
      this.reject(new Error('Subscriber stopped before first successful connection'));
      this.reject = undefined;
    }
  }

  private connectToFeed(resolve: (value: void | PromiseLike<void>) => void, reject: (reason?: any) => void) {
    return this.network.streamFeed(this.feed, this.bookmark, async (factReferences, nextBookmark) => {
      const knownFactReferences: FactReference[] = await this.store.whichExist(factReferences);
      const unknownFactReferences: FactReference[] = factReferences.filter(fr => !knownFactReferences.includes(fr));
      if (unknownFactReferences.length > 0) {
        const graph = await this.network.load(unknownFactReferences);
        await this.store.save(graph);
        if (graph.length > 0) {
          Trace.counter("facts_saved", graph.length);
        }
        await this.store.saveBookmark(this.feed, nextBookmark);
        this.bookmark = nextBookmark;
        await this.notifyFactsAdded(graph);
      } else {
        // Treat empty-reference responses as bookmark advance from WS graph transport
        if (nextBookmark && nextBookmark !== this.bookmark) {
          await this.store.saveBookmark(this.feed, nextBookmark);
          this.bookmark = nextBookmark;
        }
      }
      if (!this.resolved) {
        this.resolved = true;
        resolve();
      }
    }, err => {
      // Do not reject on errors to allow FetchConnection's retry logic to work.
      // The promise will resolve when the first successful data is received.
      // Don't log AbortError as it's expected during periodic reconnection.
      if (err.name !== 'AbortError') {
        Trace.warn(`Subscriber connection error: ${err}`);
      }
      // A 404 on GET /feeds/:hash is the replicator's documented way of saying
      // the route is known but the registration is gone -- it restarted, or a
      // policy reload rebuilt its feed cache. Retrying the same URL can never
      // fix that, so ask the owner to register the feed again (issue #243).
      // Before this the subscription just retried forever and went quiet: the
      // one path that re-registered was start()'s promise rejecting, which
      // only happens before the first delivery ever arrives, so a subscription
      // that had been running a while could never take it.
      if (err instanceof HttpError && err.statusCode === 404) {
        this.reregister();
      }
    }, this.refreshIntervalSeconds);
  }

  /**
   * Re-register this feed, at most once at a time. Every attempt in the
   * stream's backoff loop reports the same 404, so an unguarded call here
   * would turn one lost registration into a POST storm.
   */
  private reregister() {
    if (this.reregistering || !this.reregisterFeed) {
      return;
    }
    this.reregistering = true;
    this.reregisterFeed()
      .catch(err => {
        Trace.warn(`Could not re-register feed ${this.feed}: ${err}`);
      })
      .then(() => {
        this.reregistering = false;
      });
  }
}