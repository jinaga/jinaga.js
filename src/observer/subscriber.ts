import { Network } from "../managers/NetworkManager";
import { Storage, FactEnvelope, FactReference } from "../storage";
import { Trace } from "../util/trace";

export class Subscriber {
  private refCount: number = 0;
  private bookmark: string = "";
  private resolved: boolean = false;
  private disconnect: (() => void) | undefined;
  private timer: NodeJS.Timer | undefined;
  private rejectStart?: (reason?: any) => void;
  private retryCount = 0;
  private maxImmediateRetries = 3;
  private isRetrying = false;

  constructor(
    private readonly feed: string,
    private readonly network: Network,
    private readonly store: Storage,
    private readonly notifyFactsAdded: (envelopes: FactEnvelope[]) => Promise<void>,
    private readonly refreshIntervalSeconds: number = 90
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
    const bookmarkPromise = this.store.loadBookmark(this.feed);
    
    return new Promise<void>(async (resolve, reject) => {
      this.bookmark = await bookmarkPromise;
      this.resolved = false;
      this.rejectStart = reject;
      this.retryCount = 0; // Reset retry count
      this.isRetrying = false;

      const attemptConnection = () => {
        if (this.disconnect) {
          this.disconnect();
        }
        this.disconnect = this.connectToFeed(resolve, () => {
          // On error, implement exponential backoff for immediate retries
          if (this.retryCount < this.maxImmediateRetries) {
            const delay = Math.pow(2, this.retryCount) * 1000; // 1s, 2s, 4s...
            setTimeout(() => {
              this.retryCount++;
              attemptConnection();
            }, delay);
          } else {
            // Fall back to periodic timer after max immediate retries
            this.retryCount = 0; // Reset for next cycle
            // The setInterval timer will handle periodic retries
          }
        });
      };

      // Set timer for periodic retries (after initial success)
      this.timer = setInterval(attemptConnection, this.refreshIntervalSeconds * 1000);
      // Initial attempt
      attemptConnection();
    });
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
    // Reject the start promise if it hasn't resolved yet
    if (!this.resolved && this.rejectStart) {
      this.rejectStart(new Error('Subscriber stopped before connection established'));
      this.rejectStart = undefined;
    }
  }

  private connectToFeed(resolve: (value: void | PromiseLike<void>) => void, onError: (err: Error) => void) {
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
        this.rejectStart = undefined;
        this.retryCount = 0; // Reset retry count on success
        this.isRetrying = false;
        resolve();
      }
    }, err => {
      Trace.warn(`Feed connection failed for ${this.feed}, will retry in ${this.refreshIntervalSeconds} seconds: ${err.message}`);
      onError(err); // Log the error, but do not reject the start promise
    }, this.refreshIntervalSeconds);
  }
}