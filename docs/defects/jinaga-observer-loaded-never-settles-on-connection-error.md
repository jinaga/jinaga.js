# Bug Report: `observer.loaded()` never settles when a subscriber connection error occurs

**Library:** jinaga
**Version:** 6.7.15
**Environment:** Browser (JinagaBrowser), IndexedDB local store, SSE feed transport
**Severity:** High — causes stale data to be displayed without any indication of failure
**Discovered:** 2026-03-27

---

## Summary

When a Jinaga subscriber encounters a connection error during the initial reconciliation phase,
`observer.loaded()` neither resolves nor rejects. Callers that `await observer.loaded()` are
permanently suspended. Additionally, `observer.stop()` does not settle the pending promise, so
if the observer is torn down while the connection is still failing, the promise is leaked
and can never be collected.

A secondary issue is that in the **warm-cache path** (when the local IndexedDB MRU record exists),
the `Observer.start()` sequence calls `cacheResolve(true)` and then `await fetch()`. If the fetch
hangs due to a connection error, `loadResolve()` is never called, so `loaded()` is permanently
pending in exactly the window where callers are most likely to rely on it.

---

## Background: The `Observer` API contract

`Observer` exposes two lifecycle promises:

| Method | Documented intent |
|---|---|
| `cached()` | Resolves to `true` if local IndexedDB has data for this subscription; `false` if not. |
| `loaded()` | Resolves when the server has been fully reconciled (all outstanding facts delivered). |

The intended usage pattern is:
```typescript
const cacheReady = await observer.cached();
if (!cacheReady) {
    // Cold start — wait for server reconciliation before rendering
    await observer.loaded();
}
// Now safe to render (though loaded() would tell you when it's fully current)
```

Callers who want to know when the subscription is fully up-to-date with the server call
`await observer.loaded()`.

---

## Root cause analysis

### Step 1 — `ObserverImpl.start()` (warm-cache path)

```js
// dist/observer/observer.js  ~line 87
} else {
    // Warm cache path: MRU date exists
    yield this.read();        // Read IndexedDB → fire subscriber callbacks
    cacheResolve(true);       // cached() resolves to true ← caller can render
    yield this.fetch(keepAlive); // ← HANGS if subscriber connection error occurs
    loadResolve();            // ← NEVER CALLED if fetch() hangs
}
```

In the warm-cache path, `loadResolve()` only executes if `fetch()` completes successfully.
If the feed connection fails, `fetch()` awaits indefinitely, so `loaded()` never resolves.

### Step 2 — `Subscriber.start()` never rejects

`fetch(keepAlive=true)` delegates to `NetworkManager.subscribe()`, which calls
`subscriber.start()`. That method creates a Promise and passes `resolve` and `reject` into
`connectToFeed()`:

```js
// dist/observer/subscriber.js
start() {
    return new Promise((resolve, reject) => {
        this.resolved = false;
        this.disconnect = this.connectToFeed(resolve, reject);
        this.timer = setInterval(() => {
            if (this.disconnect) this.disconnect();
            this.disconnect = this.connectToFeed(resolve, reject);
        }, this.refreshIntervalSeconds * 1000);
    });
}
```

Inside `connectToFeed`, the error callback deliberately does **not** call `reject`:

```js
// dist/observer/subscriber.js
err => {
    // Do not reject on errors to allow FetchConnection's retry logic to work.
    // The promise will resolve when the first successful data is received.
    if (err.name !== 'AbortError') {
        Trace.warn(`Subscriber connection error: ${err}`);  // ← only log
    }
    // ← reject is never called
}
```

This is intentional: the subscriber retries on the `setInterval` cycle. The Promise resolves
when the **first successful response arrives**. If no successful response ever arrives, the
Promise is permanently pending.

### Step 3 — `observer.stop()` does not settle `loadedPromise`

```js
// dist/observer/observer.js
stop() {
    this.stopped = true;
    for (const listener of this.listeners) {
        this.factManager.removeSpecificationListener(listener);
    }
    if (this.feeds.length > 0) {
        this.factManager.unsubscribe(this.feeds);  // → subscriber.stop()
    }
    // ← loadedPromise is NOT settled
}
```

`subscriber.stop()` clears the retry timer and disconnects the feed:

```js
stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
    if (this.disconnect) { this.disconnect(); this.disconnect = undefined; }
    // ← the Promise from start() is now permanently pending
}
```

With the timer cleared and the connection closed, there is no remaining mechanism that can
ever call `resolve()` or `reject()` on the Promise returned by `subscriber.start()`.
`observer.loaded()` is therefore permanently leaked.

---

## Concrete scenario that triggers the bug

This race condition is reproducible during SPA navigation:

1. User navigates **away** from a page that holds a Jinaga subscription.
2. React teardown calls `observer.stop()`.
3. User immediately navigates **back**.
4. A new `observer.start()` is called for the same specification.
5. The new subscriber attempts to connect. Due to the rapid navigation, the previous
   SSE/WebSocket connection is being torn down at the transport level, causing
   `TypeError: network error` in the new subscriber's first connection attempt.
6. The error is logged: `[WARNING] Subscriber connection error: TypeError: network error`
7. The retry timer fires (default: every 90 seconds for `JinagaBrowser`).
8. **In the cold-cache path:** `observer.loaded()` hangs until the retry succeeds (~90 s).
   The caller's `await loaded()` is suspended; the UI shows a perpetual "loading" state.
9. **In the warm-cache path:** `cached()` already resolved to `true`, so a caller who
   checked `cached()` and skipped `loaded()` sees "ready" from stale IndexedDB data
   while `loaded()` is permanently pending on the hung `subscriber.start()` Promise.
10. When the user navigates away again, `observer.stop()` is called, leaking the pending
    `loaded()` promise permanently.

The console evidence from our application:
```
[WARNING] Subscriber connection error: TypeError: network error
@ http://localhost/portal/assets/index-CiXmBdV_.js:85
```

---

## Expected behavior

### For the connection-error case

`observer.loaded()` should reject with the connection error when the subscriber fails and
there is no pending retry that can recover. If the design intent is to retry silently,
`loaded()` should resolve (not reject) once the retry finally succeeds — but it should
never remain permanently pending.

### For `observer.stop()`

Calling `observer.stop()` while `loaded()` is pending should settle the promise — either
by rejecting it (so callers can clean up) or by resolving it as a no-op. A permanently
unsettled promise prevents `async` callers from ever completing, leaks the async execution
context, and may prevent garbage collection of the observer and its associated closure
state.

The analogous pattern in other async lifecycle APIs:

```ts
// AbortController-style: cancellation settles the promise
await fetch(url, { signal: abortController.signal });
// → rejects with AbortError when signal fires
```

---

## Minimal reproduction

The following pseudocode shows the invariant that currently fails:

```typescript
import { JinagaBrowser } from 'jinaga';

const j = JinagaBrowser.create({ ... });

// Simulate a page with a subscription
const observer = j.subscribe(mySpec, myFact, () => {});

// Simulate a connection error during navigation by stopping immediately
observer.stop();

// invariant: loaded() must settle (resolve or reject) after stop()
// actual:    loaded() is permanently pending
const settled = await Promise.race([
    observer.loaded(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 5000))
]);
// → currently times out; should resolve or reject within a bounded time
```

A full repro that exercises the navigation race condition:

```typescript
// Mount
const observer1 = j.subscribe(spec, given, onAdded);
// Immediate unmount (simulates fast back-navigation)
observer1.stop();

// Remount
const observer2 = j.subscribe(spec, given, onAdded);

// observer2.loaded() should eventually settle.
// If the network is momentarily unavailable during the initial connect:
// - The subscriber logs "Subscriber connection error: ..."
// - observer2.loaded() does not reject, and will not resolve until the
//   next retry interval (~90 s by default), or never if stop() is called first.
const raceResult = await Promise.race([
    observer2.loaded().then(() => 'resolved').catch(() => 'rejected'),
    new Promise(resolve => setTimeout(() => resolve('timed out'), 10_000))
]);
console.log(raceResult); // 'timed out' — expected: 'resolved' or 'rejected'

observer2.stop();

// After stop(), observer2.loaded() is permanently pending (leaked).
```

---

## Source references (jinaga 6.7.15)

| File | Location | Issue |
|---|---|---|
| `dist/observer/subscriber.js` | `connectToFeed()` error callback | `reject` is never called on connection error |
| `dist/observer/subscriber.js` | `start()` | Promise is permanently pending if `stop()` is called before first successful response |
| `dist/observer/observer.js` | `start()` warm-cache branch | `loadResolve()` is only called after `fetch()`, which may never complete |
| `dist/observer/observer.js` | `stop()` | `loadedPromise` is not settled on teardown |

---

## Suggested fixes

### Fix 1: Settle `loadedPromise` in `observer.stop()`

```typescript
stop() {
    this.stopped = true;
    for (const listener of this.listeners) {
        this.factManager.removeSpecificationListener(listener);
    }
    if (this.feeds.length > 0) {
        this.factManager.unsubscribe(this.feeds);
    }
    // NEW: settle the loadedPromise if it is still pending
    if (this.loadedReject) {
        this.loadedReject(new Error('Observer stopped before subscription loaded'));
    }
}
```

This requires storing `loadedReject` as an instance field alongside `loadedPromise`.

### Fix 2: Propagate subscriber termination to the start() Promise

When `subscriber.stop()` clears the retry timer, if the Promise has not yet resolved,
it should reject so that the awaiting caller (`NetworkManager.subscribe()`) can propagate
the rejection up through `ObserverImpl.fetch()` to the catch block in `initializeCache()`:

```typescript
stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
    if (this.disconnect) { this.disconnect(); this.disconnect = undefined; }
    // NEW: reject if not yet resolved
    if (!this.resolved && this.reject) {
        this.reject(new Error('Subscriber stopped before first successful connection'));
    }
}
```

### Fix 3 (documentation / guidance): Clarify when callers should await `loaded()`

The current API makes it easy to misinterpret `cached() === true` as "safe to skip
`loaded()`". A documentation note or a separate `synced()` method that always waits for
server reconciliation (regardless of cache state) would help callers write correct code.

---

## Downstream impact in our application

Our application wraps the `Observer` API in `useSubscriptionWithPipeline.ts`. With the
current Jinaga behavior:

- **Cold cache + connection error:** `await observer.loaded()` hangs. The UI shows a
  perpetual loading state until the retry interval fires or the component unmounts.
- **Warm cache + connection error:** Because `cached()` resolves to `true` before `loaded()`
  is awaited, our code sets `cacheState = "ready"` and never awaits `loaded()`. Stale
  IndexedDB data is presented as authoritative with no indicator that server reconciliation
  is still in progress. This is the primary user-visible symptom of our Defect-003.
- **Component unmount during connection error:** `observer.stop()` leaks the `loadedPromise`.
  On heavily navigated sessions this could accumulate leaked async contexts.

The application-side workaround we are evaluating is to always await `loaded()` regardless
of `cached()` state, and to show a "syncing…" indicator until `loaded()` resolves. However,
this workaround can only partially mitigate the bug: if `loaded()` never settles, the syncing
indicator will remain forever, which is still poor UX compared to a proper error state and
retry.
