# WebSocket Subscription Protocol — Test-Driven Implementation Plan

This plan implements the protocol in
[`websocket-protocol-spec.md`](./websocket-protocol-spec.md) across **jinaga.js**
(client + shared codec) and **jinaga-server** (server), replacing the prototype under
`src/ws/`. Every phase starts with tests derived from the spec's invariants (the
tags — W1, C3, S4, T1 … — refer to §10–§12 of the spec). A phase is done when its
tests pass and all previous phases' tests still pass.

## Guiding decisions

1. **Code placement.** The wire codec (frame parser/emitter, graph integration) and
   the client live in `jinaga.js`. The server handler moves to `jinaga-server`: it
   needs `ws`, `FeedCache`, and `SubscriptionAuthorizer`, all of which live there.
   `jinaga.js` stops exporting `AuthorizationWebSocketHandler`, `BookmarkManager`,
   and `InverseSpecificationEngine` (currently exported but unusable without the
   server's building blocks — and `BookmarkManager` fabricates bookmarks, violating
   S2).
2. **Shared conformance fixtures.** A set of golden wire transcripts (text files:
   valid streams, malformed streams, chunk-split variants) lives in
   `jinaga.js/test/ws/fixtures/` and is copied verbatim into jinaga-server's test
   tree. Both sides must parse/emit identically; the fixtures are the cross-repo
   contract.
3. **Deterministic tests.** All timing behavior (pings, watchdogs, backoff, lease)
   is driven through an injectable clock/timer so tests use fake timers; no test
   sleeps. All randomness (jitter) through an injectable RNG.
4. **The existing prototype is scaffolding.** `src/ws/protocol-router.ts`,
   `control-frame-handler.ts`, `ws-graph-client.ts`, `wsGraphNetwork.ts` are
   rewritten in place, keeping names where the responsibility is unchanged. Existing
   tests (`test/ws/*Spec.ts`) are ported to the new frame order (ACK before data) in
   Phase 1 and extended, not deleted.

---

## Part A — jinaga.js (client and codec)

### Phase A1 — Frame codec (parser + emitter)

Rewrite `protocol-router.ts` as a pure, transport-independent codec:
`FrameReader` (push chunks in, complete frames out) and `FrameWriter`.

Tests first (`test/ws/frameCodecSpec.ts`):

- Golden parse of every frame type incl. `PING`/`PONG` and 3-payload `ERR` [W2].
- **Chunk invariance property test**: for each golden transcript, parse results are
  identical for every re-chunking (byte-by-byte, random splits, all-in-one) [W1, T3].
- Partial trailing frame retained across pushes; completed on next chunk [W1].
- Unknown uppercase keyword skipped through blank line (forward compat, §3).
- Malformed input (non-keyword non-JSON line, binary flag, oversized line) → single
  fatal codec error, not silent skip [§6.2 `4400` path].
- Interleaving: control frames never split fact blocks; graph lines pass through to
  the graph sink untouched (fixtures with PK decls between blocks).
- Emitter golden tests: emitted bytes match fixtures exactly, one frame per message
  (sender alignment, §1).

### Phase A2 — Connection state machine

New `ws-connection.ts`: owns socket lifecycle, negotiation, liveness, backoff —
no feed knowledge. Consumes the codec; exposes `connect/close/send`, `onFrame`,
`onEpoch` (new connection generation), `onDegrade`.

Tests (`test/ws/connectionSpec.ts`, fake timers, mock WebSocket):

- Subprotocol: offers `jinaga-graph-v1`; rejects connection whose accepted
  subprotocol differs → transport failure, not backoff [§2].
- AUTH-first: `AUTH` emitted as the first frame when credentials exist; SUBs
  pipelined immediately after; in-band renewal re-sends `AUTH` before token expiry
  without dropping the connection [§4.1].
- Watchdog: no inbound frame for `watchdogSeconds` → close + reconnect [W10, L3].
- `PING` frame answered with `PONG`; any inbound frame resets the watchdog [§5.6].
- Backoff: full jitter within `[0, min(30s, 2ⁿs)]` via injected RNG; `n` resets
  after 30 s stable or first ACK; no attempt cap (attempt 50 still schedules) [§7].
- Immediate-reconnect triggers: `online`, `visibilitychange→visible`, close 1001,
  close 1012 — all skip the pending delay [§7]; Node build registers none of the
  browser listeners (environment isolation).
- Close-code matrix [§6.2]: 4401 → calls `reauthenticate()` before next attempt and
  does not retry if it fails; 4403 → degrade signal; range classification — unknown
  44xx fatal, 41xx backoff (4129 with doubled base), 42xx prompt.
- Lease: planned reconnect at `leaseSeconds` (default 50 min) ±10 % jitter; new
  epoch announced; feeds resume seamlessly; configurable off [§7].
- No reconnect while no feeds subscribed; connect on first subscribe [§7].

### Phase A3 — Subscription multiplexer

New `ws-subscriptions.ts`: per-feed FSM (§10.2) over the connection, plus the graph
sink → store pipeline.

Tests (`test/ws/subscriptionSpec.ts`):

- SUB sent with persisted bookmark on subscribe; exactly one SUB per feed per epoch;
  epoch change resends the full subscribed set [C3].
- ACK resolves feed start; frames for unknown/unsubscribed feeds ignored [W9 client
  side, §5.2].
- ERR taxonomy [§6.1]: `DISTRIBUTION_DENIED`/`FEED_UNKNOWN` → feed Failed, error
  surfaced to observer path, no resubscribe; `INTERNAL` → resubscribe with backoff;
  `BOOKMARK_INVALID` → bookmark reset to `""`, single resubscribe, second failure
  fatal; unknown code treated as `INTERNAL`.
- **Persist-before-advance**: facts delivered, then BOOK — bookmark saved only after
  `store.save` resolves; with a store whose `save` is delayed, BOOK processing awaits
  it [C1, C4]. Crash-injection variant: simulated teardown between save and
  saveBookmark, then resubscribe re-receives facts, store converges [T1].
- Bookmark never regresses across reconnect storms (property test with random
  disconnect injection) [C2].
- Dedup: same fact arriving in two feeds / two epochs saved once; observer notified
  once (store-delta driven) [T2].
- UNSUB sent on unsubscribe; late BOOK after UNSUB ignored without error [W9].

### Phase A4 — Network integration and the Subscriber core change

Rewrite `wsGraphNetwork.ts` on top of A2/A3; make the minimal core changes:

- **C1 (core):** `Network` gains `readonly persistentStreams?: boolean`.
  `Subscriber` installs its refresh `setInterval` only when the network does **not**
  declare persistent streams; reconnection is then entirely the transport's job.
  (`src/observer/subscriber.ts`, `src/managers/NetworkManager.ts`.)
- Auth: token provided once via connection layer (subprotocol); remove the duplicate
  `uid`/`authorization` query injection from both files [D7, §4.1].

Tests (`test/observer/subscriberSpec.ts` additions, `test/ws/wsNetworkSpec.ts`):

- With `persistentStreams: true`, no interval is created; `stop()` still tears down
  [T6]. With HTTP network, existing refresh behavior unchanged (regression).
- `streamFeed` bridge: BOOK → `onResponse([], bookmark)`; existing empty-reference
  bookmark-advance handling in `Subscriber` covered by regression tests.
- Existing `test/ws/graphWebSocketSpec.ts` E2E ported: subscribe → facts persisted →
  bookmark advanced; extended with reconnect-and-resume against a restartable stub
  server [C3, T1].

### Phase A5 — Transport selection and fallback

New `transport-selector.ts` implementing §8.

Tests (`test/ws/fallbackSpec.ts`):

- No `WebSocket` global → HTTP path used, no error.
- 3 consecutive pre-Open failures → all feeds on HTTP long-poll (existing
  `streamFeed`), refresh timer active for them; WS probe every `probeIntervalSeconds`;
  probe success migrates feeds back make-before-break (HTTP stream torn down only
  after WS ACK) [§8].
- Close 4403 → immediate degrade, no probe retry of WS with same identity.
- After a connection has been Open once, repeated losses stay in backoff (never
  degrade) [§8.4].

### Phase A6 — Client backpressure

- Receive loop pauses socket consumption while the store pipeline is busy (bounded
  buffer), resumes on drain [§9].

Tests: slow store stub → buffered line count stays under bound; no facts lost;
ordering preserved [§9, C4].

---

## Part B — jinaga-server

### Phase B0 — Extract the shared subscription core (refactor, no behavior change)

Extract from `src/http/router.ts` into a transport-neutral `FeedSubscriptionCore`:
feed resolution (`FeedCache.getFeed`), distribution check / intersection
(`SubscriptionAuthorizer`), **paged initial drain** (`streamAllInitialResults`),
inverse-listener + **anchor-listener** registration, delta production per
notification. The HTTP streaming route is re-implemented on the core.

Tests first: characterize current HTTP behavior with the existing integration tests
plus new ones (paged drain > 1 page; anchor listener fires when given fact arrives
late; intersection path) so the refactor is provably behavior-preserving. This
closes D4/D5 and gaps §3.9(1–4) once for both transports.

Change relative to today's code, spec-mandated: listeners attach **before** the
drain, with notification queueing during catch-up [S3]; add test: fact saved between
first and last drain page is delivered exactly once [S3, L2, T2].

### Phase B1 — Upgrade endpoint, negotiation, identity

Add `ws` dependency. New `src/ws/upgrade.ts`: `noServer` WebSocketServer +
`server.on('upgrade')` handler exported from `JinagaServer` as
`attachWebSocket(httpServer, options)`; `JinagaServer.create` additionally exposes
the objects the handler needs (authorization, feedCache, factManager listeners).

Tests (`test/ws/upgradeSpec.ts`, real `http.Server` on ephemeral port):

- Subprotocol echo `jinaga-graph-v1`; missing/foreign offer → 400/close 1002 [§2].
- First-message auth: `AUTH` validated via the host-supplied token hook; identity
  bound = same `UserIdentity` the HTTP middleware would produce; bad token → close
  4401 before pipelined SUBs are processed; no `AUTH` within `authTimeoutSeconds`
  when auth required → close 4408; in-band renewal rebinds credentials, identity
  change → 4401 [§4.1].
- Origin allow-list enforced when cookie auth enabled [§4.1].

### Phase B2 — Server subscription handler on the shared core

New `src/ws/handler.ts` replacing the prototype `AuthorizationWebSocketHandler`:
per-connection context (identity, subscriptions, serializer dedup state), SUB/UNSUB
processing per §5.1–§5.2, honest bookmarks from the store [S2] (delete
`BookmarkManager`).

Tests (`test/ws/handlerSpec.ts` + shared fixtures):

- Frame order per subscription: ACK → (graph* BOOK)* [W7]; ERR codes for unknown
  feed / denial [§6.1]; given facts resolved via FeedCache (feed with given fact
  serves correct results — the D4 regression test).
- Multi-page catch-up: each page graph*+BOOK, strictly advancing store cursors
  [W8, S2, T4]; page-cap → `ERR INTERNAL`.
- Cross-feed dedup: two overlapping feeds on one connection, shared facts sent once
  [W5]; PK density and topological order asserted by running the client codec over
  captured output [W3, W4].
- Distribution-denied feed leaks nothing even when another feed on the same
  connection is allowed the same facts — assert S1 by construction: sends go through
  a per-feed authorization check.
- UNSUB and connection close detach every listener; listener count returns to
  baseline (hook into `ObservableSource` counts) [S4, T5].

### Phase B3 — Liveness and drain

- Server protocol ping every `pingIntervalSeconds`; reap on pong silence
  [L3]; app-level `PING` frame when output idle [W10].
- SIGTERM → stop accepting upgrades, close all with 1012 staggered across the drain
  window, exit on close-or-grace [§3.10 of the evaluation].

Tests: fake-timer reap test (dead socket's listeners removed within bound — the
issue #127 regression test) [T5]; drain test asserts 1012 received and process exits
before grace expiry.

### Phase B4 — Backpressure

- Pause catch-up while `bufferedAmount > highWaterMark`; coalesce live deltas per
  feed while paused; close 4101 after `slowConsumerSeconds` [§9].

Tests: throttled socket → catch-up pauses (memory bounded), resumes on drain;
sustained stall → 4101; reconnect-and-resume recovers all facts [§9, T1].

### Phase B5 — Cross-repo integration and chaos

In jinaga-server (which depends on the published/linked jinaga package):

- Full-stack test: `JinagaServer.create` + `attachWebSocket` + real jinaga client
  (`JinagaBrowser.create({ httpEndpoint, wsEndpoint })`) over loopback: subscribe,
  save on server, observe on client; latency has no polling component [T6].
- Resume: kill server mid-stream, restart, client reconnects and converges [T1, L4].
- **Chaos test** (single seed-reproducible run): N feeds, random saves, random
  disconnects/server restarts/slow-consumer injections for M virtual minutes; assert
  final client store equals server projection per feed, bookmarks monotone, listener
  baseline restored [T1, T2, C2, T5].
- Fallback E2E: WS endpoint blocked → client converges via HTTP long-poll; unblock →
  probe migrates back [§8].

### Rollout

1. Ship jinaga.js first (codec, client, `persistentStreams`, fallback) — inert
   without a WS endpoint; long-poll behavior unchanged (regression suites A4).
2. Ship jinaga-server with `attachWebSocket` opt-in; replicator image enables it
   behind config.
3. Enable in a staging replicator; verify with the deployment checklist in
   [`websocket-deployment.md`](./websocket-deployment.md) (per-platform ingress
   config); watch the issue #127 metrics (lingering streams, login latency).
4. Default `wsEndpoint` on in clients once server releases are current; long-poll
   remains the automatic fallback (§8), satisfying the last acceptance criterion of
   issue #127.

Deferred (tracked, out of scope): horizontal fan-out across server replicas
(pub/sub for `ObservableSource`), permessage-deflate evaluation, binary framing v2.
