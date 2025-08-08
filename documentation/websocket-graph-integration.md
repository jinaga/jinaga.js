## WebSocket Graph Transport: Single-Connection Multiplexed Design

### Goals

 - **Single WebSocket connection** multiplexing many subscriptions.
 - **Graph protocol only** for efficiency; remove JSON reference streaming mode.
 - **No backward compatibility** with prior WS drafts; protocol aligned with `documentation/graph-protocol.md`.
 - **Minimal client API changes**; keep `Network` interface stable.

### Requirements

 - One connection per client instance; many feeds per connection.
 - Client can `SUB`/`UNSUB` feeds with bookmarks and receive a single global stream of graph blocks.
 - Server interleaves control frames between graph blocks: `BOOK` (bookmark advance) and `ERR` (per-feed error).
 - Facts are deduplicated across all feeds on a connection and serialized in topological order.
 - Reconnection auto-resubscribes active feeds at last bookmarks.

### Protocol Overview (over WebSocket)

 - The stream is a concatenation of:
   - Graph blocks as specified in `graph-protocol.md`:
     - `PK{n}` declarations (2 lines + blank line)
     - Fact blocks (type, predecessors, fields, 0+ signature pairs) + blank line
   - Control frames (uppercase keyword, one or more JSON lines, then a blank line):
     - `SUB` — client→server
       ```
       SUB
       "<feed-id>"
       "<bookmark>"
       
       ```
     - `UNSUB` — client→server
       ```
       UNSUB
       "<feed-id>"
       
       ```
     - `BOOK` — server→client (bookmark advanced for a feed)
       ```
       BOOK
       "<feed-id>"
       "<bookmark>"
       
       ```
     - `ERR` — server→client (per-feed error)
       ```
       ERR
       "<feed-id>"
       "<message>"
       
       ```
 - Control frames never split a fact block. Public key declarations may appear between fact blocks at any time but must precede their use.
 - For a given feed, `BOOK` must be sent only after all facts required to reach that bookmark have been streamed on the connection.

### Client Integration

#### Components

 - `WsGraphClient`
   - Maintains a single WebSocket connection.
   - Sends `SUB`/`UNSUB` frames; on reconnect, resends `SUB` for all active feeds with last-known bookmarks.
   - Parses incoming data into lines; dispatches control frames vs graph lines.
   - Feeds graph lines to a `GraphDeserializer`, immediately persisting emitted envelopes to the store.
   - Tracks per-feed bookmarks and invokes registered listeners on `BOOK`.

 - `WsGraphNetwork implements Network`
   - `feeds(start, specification)` → delegates to `HttpNetwork`.
   - `fetchFeed(feed, bookmark)` → delegates to `HttpNetwork` for one-off fetches/backfill.
   - `load(references)` → delegates to `HttpNetwork` (used during initial HTTP backfill only).
   - `streamFeed(feed, bookmark, onResponse, onError)`:
     - Subscribes via `WsGraphClient`.
     - When a `BOOK` is received for the feed, persists the bookmark and calls `onResponse([], bookmark)` (no references; facts are already persisted via graph stream).

#### Storage and Deduplication

 - `WsGraphClient` (or `WsGraphNetwork`) accepts a `Storage` instance to persist envelopes from `GraphDeserializer` as they arrive.
 - Deduplication occurs at the store layer; the serializer/deserializer also prevent duplicate blocks on the wire.

#### Minimal Core Change

 - Update `src/observer/subscriber.ts` to treat empty-reference responses as bookmark advances:
   - If `onResponse([], nextBookmark)` is invoked and `nextBookmark !== this.bookmark`, save the bookmark and resolve the start promise if pending.
   - This preserves the `Network` interface and keeps subscription lifecycle logic intact.

### Server Integration (with `Authorization`)

Use the server’s implementation of `@authorization.ts` (interface exported as `Authorization`) to gate and produce feed data.

 - Connection context per socket:
   - Authenticated `UserIdentity` (or null for anonymous, if permitted).
   - Active subscriptions: map of `feedId → bookmark`.
   - Sent-facts set for dedupe: `(type, hash)` pairs across the entire connection.

 - On `SUB feed bookmark`:
   - Validate distribution with `authorization.verifyDistribution(user, [feedSpec], namedStart)` or equivalent feed gate.
   - Produce delta via `authorization.feed(user, feedSpec, start, bookmark)` → `{ references, bookmark }`.
   - Resolve references to envelopes using `authorization.load(user, references)`.
   - Serialize envelopes with `GraphSerializer` to the shared stream (dedup across feeds/connection), then emit `BOOK feed bookmark`.

 - On new facts relevant to feeds:
   - For each affected feed, compute next delta and stream envelopes first (deduped), then `BOOK` once all required facts have been sent.

 - On `UNSUB feed`: stop producing deltas for that feed and clear its bookmark from the connection context.

 - On errors: send `ERR feed message`.

### Verification Strategy

 - Unit and Round-Trip Tests
   - Serializer/deserializer round-trips for graphs with varied predecessors and signatures.
   - Golden tests matching the examples in `documentation/graph-protocol.md`.

 - Control/Framing Tests
   - Interleave control frames between fact blocks; ensure parser never splits blocks.
   - Error cases: out-of-order `PK` index, missing blank lines, malformed JSON, unknown PK reference, out-of-range predecessor index, truncated stream mid-block.

 - Streaming and Performance
   - Large graphs: ensure `GraphDeserializer` batches (current default 20) and that persistence is incremental.
   - Backpressure tolerance via batching assertions.

 - Multiplexing
   - Two or more feeds on one socket with overlapping facts; assert no duplicate saves and correct per-feed `BOOK` ordering.

 - Reconnection
   - Drop and re-establish the connection; client resends `SUB` with last bookmarks; server resumes. Assert no duplicate facts and monotonic bookmarks.

### Integration Tests (Real Socket)

 - Spin up a test WS server (e.g., `ws`) bound to an ephemeral port.
 - Server harness implements control frame parsing and uses `GraphSerializer` for graph output; integrates with an in-memory `Authorization` stub backed by fixtures.
 - Client under test uses `WsGraphClient` + `WsGraphNetwork` + `NetworkManager` + `MemoryStore`.
 - Scenarios:
   - Initial subscribe with HTTP backfill; subsequent updates over WS graph + `BOOK`.
   - Multiple feeds, overlapping facts; dedupe confirmed.
   - Reconnect and resume from bookmarks.
   - Per-feed `ERR` propagation.

### Planned Code Changes

 - Add
   - `src/ws/ws-graph-client.ts` — single-connection client, line framing, SUB/UNSUB, `GraphDeserializer` integration.
   - `src/ws/wsGraphNetwork.ts` — `Network` implementation that uses `WsGraphClient` and persists envelopes; falls back to HTTP only for feeds/fetch/load.
   - Tests: `test/ws/graphWebSocketSpec.ts` with fixtures under `test/fixtures/graph/`.

 - Change
   - `src/observer/subscriber.ts` — save bookmark on empty-reference responses; resolve start on first bookmark.
   - `src/index.ts` — export the new WS graph client/network.

 - Remove (after migration)
   - `src/ws/ws-client.ts` and `src/ws/wsNetwork.ts` (legacy JSON reference streaming).

### Open Considerations

 - Batch size: `GraphDeserializer` currently batches every 20 envelopes; tuneable via constructor if needed.
 - Backpressure: ensure store saves are awaited to avoid unbounded buffering.
 - Error semantics: define client’s retry behavior on `ERR` vs connection errors.
 - Bookmark semantics: `BOOK` is the only signal advancing a feed; the client must persist facts before accepting `BOOK`.

This design enables efficient, multiplexed real-time synchronization over a single WebSocket using the existing graph protocol, minimizing changes to the client’s public API while integrating cleanly with server-side `Authorization`.


