# WebSocket Subscription Design: Critical Evaluation

This document critically evaluates the design in
[`websocket-graph-integration.md`](./websocket-graph-integration.md) and the current
implementation under `src/ws/`, against the requirements of
[issue #127](https://github.com/jinaga/jinaga.js/issues/127) and industry practice for
reliable WebSocket protocols. It is the motivation for the formal specification in
[`websocket-protocol-spec.md`](./websocket-protocol-spec.md) and the plan in
[`websocket-implementation-plan.md`](./websocket-implementation-plan.md).

## 1. What the design gets right

The core ideas in the existing design are sound and are retained:

- **Single multiplexed connection.** One WebSocket carrying many feed subscriptions
  eliminates the per-feed connection churn that starves servers today (issue #127,
  field report from Azure Container Apps: ~60 lingering long-poll streams per feed).
- **Graph protocol reuse.** Streaming facts in the `application/x-jinaga-graph-v1`
  format ([`graph-protocol.md`](./graph-protocol.md)) preserves signatures, deduplicates
  facts and public keys on the wire, and reuses hardened serializer/deserializer code.
- **Bookmark-driven resume.** Feeds resume from opaque per-feed bookmarks, so a
  reconnect is a stateless re-subscribe — no server-side session state must survive.
- **Facts before bookmark.** The rule that `BOOK` may only follow the facts required to
  reach it is the load-bearing ordering invariant; it makes crash recovery correct
  (see Theorem 1 in [`websocket-protocol-spec.md`](./websocket-protocol-spec.md)).
- **Store-level idempotence.** `save` is insert-if-absent keyed by `(type, hash)`,
  which turns at-least-once delivery into effectively exactly-once application.

## 2. Divergences between the documented protocol and the implementation

The implementation in `src/ws/` and the documents disagree in ways that make the
current docs unusable as a specification. Each divergence is resolved in the new spec.

| # | Divergence | Where | Resolution in spec |
|---|---|---|---|
| D1 | `ACK` frame is implemented (client `src/ws/control-frame-handler.ts:29`, server `src/ws/authorization-websocket-handler.ts:187`) but appears in neither `websocket-graph-integration.md` nor `graph-protocol.md`. | code vs docs | `ACK` is specified, with a defined position in the frame order (immediately after validation, before catch-up). |
| D2 | Framing asymmetry: the client sends one WebSocket message per line (`ws-graph-client.ts:253-264` — a `SUB` is four `send()` calls); the server sends one message per frame. Neither doc states a chunking contract. | code vs docs | The spec defines the logical stream as the concatenation of message payloads (message boundaries carry no meaning) and recommends senders align messages to frame boundaries. |
| D3 | Deserializer batch size: docs say "batches (default 20)"; the WS client constructs `GraphDeserializer(readLine, 1)` (`ws-graph-client.ts:176`) because a WS stream has no natural end. | code vs docs | Spec states flush threshold 1 for WS transport and why. |
| D4 | Server `handleSub` hardcodes `start = []` (`authorization-websocket-handler.ts:118`): the given facts of a feed are never resolved, so any feed whose specification requires given facts cannot be served correctly. | server gap | Feed resolution is specified to go through `FeedCache.getFeed(hash)` → `{ feed, namedStart }`, exactly as the HTTP route does (`jinaga-server` `router.ts:678`). |
| D5 | Bookmark fabrication: `BookmarkManager.advanceBookmark` mints `Date.now():counter` tokens (`src/ws/bookmark-manager.ts:13-17`) unrelated to the store's cursor. `MemoryStore.feed` still returns an empty bookmark (TODO at `memory/memory-store.ts:98-103`). | server gap | Bookmarks are specified as the storage layer's opaque cursor — the same value the HTTP feed returns — never invented by the transport. |
| D6 | `ERR` handling is undefined: the client only logs it (`ws-graph-client.ts:127-129`); no per-feed `onError`, no retry/fatal distinction. The old doc lists this as an open consideration. | both | `ERR` carries a structured error code; codes are partitioned into retryable and fatal, with specified client behavior for each. |
| D7 | Redundant identity injection in both `ws-graph-client.ts:92-104` and `wsGraphNetwork.ts:36-46`. | code | Authentication is specified once, at the connection layer (§4.1 below). |
| D8 | The BOOK-after-persist guarantee is implemented against a single `lastSavePromise` (`ws-graph-client.ts:113-126`), not per feed. Correct only because the flush threshold is 1. | code | The spec states the client-side invariant (I6) explicitly so the implementation constraint is visible and testable. |

## 3. Design defects (gaps in the design itself, not just the implementation)

### 3.1 The refresh-churn problem is reintroduced through the back door

`Subscriber.start` installs a `setInterval` that disconnects and reconnects every
`feedRefreshIntervalSeconds` (default 90; `src/observer/subscriber.ts:30-43`,
`NetworkManager.ts:176`). Over the WS transport this issues `UNSUB` + `SUB` for every
feed every 90 seconds — periodic churn on a connection whose entire purpose is to
eliminate periodic churn. Worse, `WsGraphClient.scheduleReconnect` suppresses
reconnection while `activeFeeds.size === 0` (`ws-graph-client.ts:230-232`), so a
transient close during the refresh gap can leave a feed unsubscribed until the next
timer tick.

**Resolution.** Connection liveness becomes the transport's responsibility
(heartbeats, §3.2), not the subscriber's. The `Network` contract is extended so a
transport can declare that its streams are persistent; `Subscriber` installs the
refresh timer only for transports that need it (HTTP long-poll). See core change C1 in
the implementation plan.

### 3.2 No liveness mechanism at all

Neither the design nor the implementation has ping/pong or heartbeats. This is the
single most important reliability gap, because it recreates the exact failure from the
field report on issue #127: a half-open connection (ingress didn't propagate the
peer's disconnect) looks healthy forever. Consequences today:

- The server cannot distinguish a dead client from a quiet one; subscriptions and
  inverse listeners leak until the process restarts (there is no 5-minute timeout on
  the WS path — the one safety net the HTTP path had).
- The client cannot detect a dead server: browsers do not surface protocol-level
  ping/pong to JavaScript, and a dead TCP peer produces no `close` event for minutes.
- Idle connections are silently severed by intermediary idle timeouts (commonly
  60–240 s across cloud load balancers), and neither side notices.

**Resolution.** Two complementary mechanisms, specified in §5 of the protocol spec:
server-initiated protocol-level pings (RFC 6455 §5.5.2) for server-side dead-peer
detection, plus an application-level `PING` frame server→client so browser clients can
run a receive-watchdog. Intervals are chosen against the cloud platform timeout matrix
in [`websocket-deployment.md`](./websocket-deployment.md).

### 3.3 Authentication is an afterthought

The implementation puts the bearer token in an `authorization` query parameter
(`wsGraphNetwork.ts:24-29`) plus a `uid` parameter. Query strings are logged by
proxies, load balancers, and access logs — this leaks credentials in every environment
the user cares about (App Service, ALB, Cloud Run access logging all record URLs).
There is also no story for token expiry on a connection that lives for hours, and no
origin check at upgrade time.

**Resolution.** Specified in §4 of the protocol spec: first-message authentication —
the client's first frame is `AUTH token` (the pattern proven by graphql-ws's
`ConnectionInit`), keeping credentials out of URLs, headers, and access logs
entirely; the server enforces an auth timeout (`4408`) and derives the same
middleware-derived identity as HTTP. Token expiry on a long-lived connection is
handled by **in-band renewal** (re-send `AUTH` with a fresh token; no reconnect),
and the server closes with `4401` when credentials lapse anyway. `4401` is
fatal-with-same-token: the client must obtain a fresh token before reconnecting
(`reauthenticate()` hook already exists on `AuthenticationProvider`).

### 3.4 No protocol versioning

`graph-protocol.md` explicitly states the format has no version markers. On a
multiplexed long-lived transport that will evolve (new frame types, compression), the
absence of negotiation means every change is a silent breaking change. WebSocket has a
built-in negotiation mechanism — the subprotocol.

**Resolution.** The client requests subprotocol `jinaga-graph-v1`; the server must
select it or the client treats the connection as failed (this also protects against
talking to a non-Jinaga endpoint through a misconfigured proxy). Future revisions add
`jinaga-graph-v2` while the server keeps serving v1.

### 3.5 No backpressure on either side

- **Server → client:** `socket.send()` is called without ever consulting
  `bufferedAmount`/the `ws` backpressure callback. A slow consumer (mobile client on a
  bad network) causes unbounded buffering in the server process — the same
  resource-exhaustion class the HTTP path suffered, relocated into memory.
- **Client:** `pendingLines` grows without bound if store saves are slower than the
  network delivers lines (`ws-graph-client.ts:200-226`).

**Resolution.** Specified slow-consumer policy: the server suspends producing
catch-up pages for a connection while `bufferedAmount` exceeds a high-water mark and
closes with `4408 Slow consumer` if it stays above the mark past a deadline. This is
safe precisely because of the resume design: a killed client reconnects and resumes
from its last persisted bookmarks with no data loss (Theorem 1). Live-notification
paths coalesce: while suspended, only the latest pending delta per feed is retained.
Client-side, the receive loop stops reading (lets TCP flow control push back) rather
than queueing unboundedly — `pendingLines` is bounded by pausing `pushChunk`
consumption until the deserializer drains.

### 3.6 Error semantics and close codes are unspecified

The old doc's "Open Considerations" defers retry behavior on `ERR` vs connection
errors; the implementation logs and continues. There is no allocation of WebSocket
close codes, so every disconnect looks the same to the client — including ones that
must not be retried with the same credentials (auth failure) or the same feed
(distribution denial).

**Resolution.** §6 of the protocol spec defines the full error taxonomy: per-feed
`ERR` codes (fatal per feed: `FEED_UNKNOWN`, `DISTRIBUTION_DENIED`,
`BOOKMARK_INVALID`; the last instructs the client to clear its bookmark and restart
the feed from empty — the recovery path when a server is restored from backup), and
connection close codes with the retry policy encoded in the code range (44xx fatal,
41xx backoff, 42xx prompt — after Pusher's protocol), so even unknown future codes
have a defined client reaction.

### 3.7 Reconnection is half-designed

The current backoff is `min(30s, 1s·2^n)` with a hard cap of 15 attempts and **no
jitter** (`ws-graph-client.ts:228-243`). No jitter means synchronized reconnect storms
after a server restart — the thundering herd that takes freshly deployed replicas back
down. A hard attempt cap means a laptop that sleeps through 15 backoff cycles never
reconnects. And there is no integration with Page Visibility / `online` events, which
[`connection-lifecycle-analysis.md`](./connection-lifecycle-analysis.md) already
identified as the top mobile gap.

**Resolution.** Full-jitter exponential backoff, no attempt cap (the cap is on delay,
not attempts), immediate reconnect on `online`/`visibilitychange`, and planned
reconnection before platform-imposed maximum connection lifetimes ("connection
lease"). Parameters in §7 of the protocol spec.

### 3.8 Fallback to long-polling is named but not designed

Issue #127's acceptance criteria require long-polling fallback. The old design says
`WsGraphNetwork` delegates `fetchFeed`/`load` to HTTP but never says when the client
gives up on WS for `streamFeed`. Corporate proxies and some ingress configurations
break WS while HTTP works; without a designed fallback, those users get no
subscriptions at all.

**Resolution.** A transport-selection layer (§8 of the protocol spec): try WS; if the
connection fails before ever becoming healthy N consecutive times (default 3), fall
back to the existing HTTP `streamFeed` path for all feeds; re-probe WS periodically
(default every 5 minutes) and migrate back when it succeeds. Once a WS connection has
been healthy, connection loss goes through backoff, not fallback — distinguishing
"WS is broken here" from "the network blipped" is what keeps behavior stable.

### 3.9 Server integration gaps (jinaga-server)

The design document describes server behavior against the `Authorization` interface,
but the shipped handler misses the parts that make the HTTP path correct. The HTTP
`streamFeed` (`jinaga-server` `router.ts:699-848`) does four things the WS handler
does not:

1. **Paged initial drain** — `streamAllInitialResults` pages through the store
   until the bookmark stabilizes; the WS handler does a single `authorization.feed`
   call, silently truncating catch-up to one page.
2. **Given-fact resolution** via `FeedCache` (D4 above).
3. **Anchor listeners** for subscriptions whose given fact hasn't arrived yet
   (jinaga.js#129).
4. **Distribution intersection** (`verifyDistributionOrIntersect`, jinaga.js#130) —
   the WS path only supports the all-or-nothing distribution check.

In addition, fan-out relies on the in-process `ObservableSource`; that constraint
(subscriptions see only saves that arrive through the same process) must be documented
as a deployment constraint until a pub/sub layer exists, and it interacts with cloud
scale-out (see [`websocket-deployment.md`](./websocket-deployment.md)).

**Resolution.** The WS `handleSub` is specified to reuse the same building blocks as
the HTTP route — `FeedCache.getFeed`, `SubscriptionAuthorizer.feedWithDistribution` /
`feedPreVerified`, paged drain, inverse + anchor listeners — so the two transports
cannot drift. The implementation plan sequences this as a refactor-to-shared-core
before the WS handler lands in jinaga-server.

### 3.10 No graceful shutdown

Nothing sends a close frame on deploy/scale-in. Cloud platforms deliver SIGTERM with a
grace period (typically 30 s); a server that just dies strands every client in
half-open state until their watchdogs fire.

**Resolution.** On drain, the server stops accepting upgrades, sends close code
`1012 (Service Restart)` to every connection — staggered across the drain window so
the reconnect wave is spread — and exits when sockets are closed or the grace period
elapses. Clients reconnect after a uniformly random delay (no backoff growth),
because the fleet is restarting, not failing.

## 4. Evaluation against issue #127 acceptance criteria

| Acceptance criterion | Old design + current code | With this revision |
|---|---|---|
| Client can establish a WS connection for subscriptions | ✅ works | ✅ plus versioned subprotocol and upgrade-time auth |
| Server pushes new matching facts in real time | ⚠️ works for feeds without given facts, single page only | ✅ full parity with HTTP path (paged drain, anchors, intersection) |
| Resilient to interruptions; reestablishes subscriptions | ⚠️ backoff without jitter, capped attempts, no liveness detection, churned by refresh timer | ✅ heartbeats, watchdog, uncapped jittered backoff, lifecycle events, connection lease |
| Fallback to long polling remains available | ❌ not designed | ✅ transport selection with re-probe |

## 5. Summary of protocol changes proposed

Relative to the wire format the code implements today:

1. `ACK` is documented and moved to immediately after validation (before catch-up).
2. `ERR` gains a machine-readable error code line: `ERR / feed / code / message`.
3. New server→client `PING` frame (empty payload); new client→server `PONG`.
4. New client→server `AUTH` frame (first-message authentication with in-band
   renewal); subprotocol negotiation `jinaga-graph-v1`; no token in the query string.
5. Close-code allocation with range-encoded retry policy (44xx/41xx/42xx).
6. Bookmarks are store cursors; `BOOKMARK_INVALID` error resets a feed.
7. Framing contract stated explicitly (byte-stream semantics; alignment recommended).

Everything else — graph blocks, `SUB`/`UNSUB`/`BOOK` shapes, facts-before-BOOK — is
unchanged from the current implementation, deliberately: the migration cost of items
1–7 is one coordinated minor release of `jinaga` and `jinaga-server`, before any
external deployment of the WS transport exists.
