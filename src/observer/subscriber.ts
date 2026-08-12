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
  private retryCount = 0;
  private maxImmediateRetries = 3;
  private isConnecting = false; // Guard flag to prevent concurrent connection attempts

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

  start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Set reject immediately so stop() can cancel before the bookmark loads.
      this.resolved = false;
      this.reject = reject;
      this.retryCount = 0;
      this.isConnecting = false;

      this.store.loadBookmark(this.feed).then(bookmark => {
        this.bookmark = bookmark;

        const attemptConnection = () => {
          Trace.info(`[Subscriber] attemptConnection called - feed: ${this.feed}, retryCount: ${this.retryCount}, isConnecting: ${this.isConnecting}`);

          // Guard: Prevent concurrent connection attempts
          if (this.isConnecting) {
            Trace.warn(`[Subscriber] Connection attempt already in progress, skipping - feed: ${this.feed}`);
            return;
          }

          this.isConnecting = true;

          if (this.disconnect) {
            this.disconnect();
          }

          this.disconnect = this.connectToFeed(resolve, (err) => {
            Trace.warn(`[Subscriber] Connection error - feed: ${this.feed}, retryCount: ${this.retryCount}, error: ${err.message}`);

            if (this.retryCount < this.maxImmediateRetries) {
              const delay = Math.pow(2, this.retryCount) * 1000; // 1s, 2s, 4s...
              Trace.info(`[Subscriber] Scheduling retry - feed: ${this.feed}, retryCount: ${this.retryCount}, delay: ${delay}ms`);
              setTimeout(() => {
                this.retryCount++;
                this.isConnecting = false; // Clear flag before retry
                attemptConnection();
              }, delay);
            } else {
              // Fall back to periodic timer after max immediate retries
              Trace.info(`[Subscriber] Max retries reached - feed: ${this.feed}, falling back to periodic timer`);
              this.retryCount = 0;
              this.isConnecting = false; // Clear flag to allow interval timer to retry
            }
          });
        };

        this.timer = setInterval(() => {
          Trace.info(`[Subscriber] Interval timer triggered - feed: ${this.feed}, resolved: ${this.resolved}`);
          attemptConnection();
        }, this.refreshIntervalSeconds * 1000);

        attemptConnection();
      }).catch(reject);
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
    // If the start() promise is still pending (no successful response yet),
    // reject it so the awaiting caller is not permanently suspended.
    if (!this.resolved && this.reject) {
      this.reject(new Error('Subscriber stopped before first successful connection'));
      this.reject = undefined;
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
        this.isConnecting = false; // Clear flag on successful connection
        this.retryCount = 0;
        this.reject = undefined;
        resolve();
      }
    }, err => {
      // Don't log AbortError as it's expected during periodic reconnection.
      if (err.name !== 'AbortError') {
        Trace.warn(`[Subscriber] Feed connection failed for ${this.feed}: ${err.message}`);
        onError(err);
      } else {
        this.isConnecting = false;
      }
    }, this.refreshIntervalSeconds);
  }
}