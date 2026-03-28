# Observer Subscription Cancellation

## Background

When `observer.stop()` is called, the observer must clean up two categories
of resources:

1. **Specification listeners** — synchronous; removed immediately in `stop()`.
2. **Network subscriptions** — asynchronous; require calling `subscriber.stop()`
   through `NetworkManager.unsubscribe()`.

Category 2 has a timing gap. Feed IDs are stored in `ObserverImpl.feeds` only
after `factManager.subscribe()` resolves, which in turn only resolves after
`Subscriber.start()` receives its first server response. If `stop()` is called
before that first response arrives, `this.feeds` is still empty and the
subscriber cannot be reached.

```
observer.stop()          [feeds = []]
    │
    ├── removes listeners           ← immediate
    ├── unsubscribe(this.feeds)     ← no-op: feeds is []
    └── loadResolve()               ← loaded() settles immediately ✓

                    ┊
         (server responds at some later time)
                    ┊

ObserverImpl.fetch() resumes
    └── Fix 3: this.stopped → unsubscribe(feeds)  ← deferred cleanup ✓
```

The deferred cleanup (Fix 3, added in the defect fix) ensures the subscriber
is eventually released once the server responds. In production this gap is
bounded by the server's first-response latency. However it is not immediate,
and in adversarial conditions (offline, unreachable server) the subscriber and
its reconnect timer will linger until connectivity is restored.

## The Required Refactoring

Full deterministic cancellation requires a **cancellation signal** that
`ObserverImpl.stop()` can set and that propagates synchronously through the
subscription call chain without waiting for a server response.

### Proposed Design

#### 1. Add a cancellation token to `ObserverImpl`

```typescript
// src/observer/observer.ts
private abortController: AbortController = new AbortController();

public stop() {
    this.stopped = true;
    this.abortController.abort();          // ← signal cancellation
    // ... remove listeners, settle loadedPromise ...
}
```

The `AbortController` / `AbortSignal` pair is the Web-standard mechanism for
this pattern and is already available in the Node.js and browser runtimes
that Jinaga targets.

#### 2. Thread the signal through `FactManager` and `NetworkManager`

```typescript
// src/managers/factManager.ts
async subscribe(
    start: FactReference[],
    specification: Specification,
    signal: AbortSignal           // ← new parameter
): Promise<string[]> {
    return this.networkManager.subscribe(start, specification, signal);
}

// src/managers/NetworkManager.ts
async subscribe(
    start: FactReference[],
    specification: Specification,
    signal: AbortSignal           // ← new parameter
): Promise<string[]> {
    // ...
    const promises = subscribers.map(async subscriber => {
        if (subscriber.addRef()) {
            await subscriber.start(signal);   // ← pass to Subscriber
        }
    });
    // ...
}
```

#### 3. Honor the signal inside `Subscriber.start()`

```typescript
// src/observer/subscriber.ts
async start(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    this.bookmark = await this.store.loadBookmark(this.feed);

    // Abort immediately if stop() was called while we awaited the bookmark.
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
        await new Promise<void>((resolve, reject) => {
            // Reject the promise the moment the signal fires.
            signal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });

            this.resolved = false;
            this.disconnect = this.connectToFeed(resolve, reject);
            this.timer = setInterval(() => {
                if (this.disconnect) this.disconnect();
                this.disconnect = this.connectToFeed(resolve, reject);
            }, this.refreshIntervalSeconds * 1000);
        });
    } finally {
        // Existing cleanup (timer, disconnect, reject ref) stays here.
        this.stop();
    }
}
```

When `observer.stop()` calls `abortController.abort()`, the `'abort'` event
fires synchronously, the inner promise rejects immediately, and
`NetworkManager.subscribe()` catches the rejection and calls
`unsubscribe(feeds)` — which reaches `subscriber.stop()` and clears the
timer, all without waiting for the server.

#### 4. Remove Fix 3 (now redundant)

With the signal propagating cancellation synchronously, the post-`subscribe()`
stopped-check in `ObserverImpl.fetch()` becomes dead code and can be deleted:

```typescript
// src/observer/observer.ts  (after refactoring — Fix 3 removed)
private async fetch(keepAlive: boolean) {
    if (keepAlive) {
        this.feeds = await this.factManager.subscribe(
            this.given, this.specification, this.abortController.signal
        );
        // No stopped-check needed: if aborted, subscribe() threw before returning.
    } else {
        await this.factManager.fetch(this.given, this.specification);
    }
}
```

### Interaction with Reference Counting

`NetworkManager.subscribe()` already has a catch block that calls
`this.unsubscribe(feeds)` when any subscriber fails. An `AbortError` thrown
by `subscriber.start()` will trigger that same path — `subscriber.release()`
is called, and if the ref-count reaches zero, `subscriber.stop()` runs.

`subscriber.stop()` must therefore be idempotent (it already is: it guards
each resource with an undefined-check before using it).

### What Does Not Change

- The `refreshIntervalSeconds` reconnection logic inside `Subscriber` is
  unaffected. The signal only cancels the *initial wait* for the first
  server response; once the subscriber is running (resolved) the periodic
  reconnect is managed by `stop()` as before.
- The `Network.streamFeed` interface does not need to change. The signal
  is consumed entirely within `Subscriber`.
- The `ObserverImpl` public API (`cached()`, `loaded()`, `stop()`) is
  unchanged from the caller's perspective.

## Migration Path

1. Add `AbortController` to `ObserverImpl` (non-breaking internally).
2. Add the optional `signal?: AbortSignal` parameter to
   `FactManager.subscribe`, `NetworkManager.subscribe`, and
   `Subscriber.start` — optional so call sites outside `ObserverImpl` do not
   need to change at once.
3. Wire `abortController.abort()` into `stop()`.
4. Once all call sites pass the signal, make the parameter required and
   delete Fix 3.

Each step is independently reviewable and safe to merge.
