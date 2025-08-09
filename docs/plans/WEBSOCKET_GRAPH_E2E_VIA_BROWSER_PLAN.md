# WebSocket Graph E2E via JinagaBrowser Implementation Plan

## Overview
Exercise the WebSocket Graph path end-to-end through `JinagaBrowser` (or `WsGraphNetwork`) using a simulated server that mirrors application behavior. The simulated server accepts an `AuthorizationNoOp` backed by a `MemoryStore`, implements the WebSocket protocol, loads initial feed results via `authorization.feed`, computes inverse specifications via `invertSpecification`, subscribes to those inverses, and streams resulting facts with `BOOK` frames.

This plan selects the higher-fidelity options:
- Implement `MemoryStore.feed` using `SpecificationRunner` to return real tuples and stable bookmarks.
- Trigger inverse listeners by calling `authorization.save(...)` on the server.
- Use a full HTTP + WS server setup for maximum production fidelity.

## Progress Summary
- ✅ **Phase 0: Browser Wiring & WS Auth Hook**
- ✅ **Phase 1: Storage Feed Support**
- ✅ **Phase 2: Server Wiring & Protocol**
- 🔄 **Phase 3: Full HTTP + WS Test Harness (incl. Observer Notification Bridge)**
- ❌ **Phase 4: E2E via `JinagaBrowser.subscribe`**

**Current Status**: Phase 2 complete; server components properly wired with production FactManager, AuthorizationNoOp, InverseSpecificationEngine architecture.

## Prerequisites
- [ ] Node test environment with `ws` available and `globalThis.WebSocket` set in tests
- [ ] Ability to run a minimal HTTP server in tests for feed resolution
- [ ] Access to `AuthorizationNoOp`, `MemoryStore`, `ObservableSource`, `InverseSpecificationEngine`, `AuthorizationWebSocketHandler`
- [ ] Deterministic mapping from feed IDs to `Specification` on the server (`resolveFeed`)

## Phase 0: Browser Wiring & WS Auth Hook ✅
### 0.1 Ensure `WsGraphNetwork` is constructed when `wsEndpoint` is set
**Location**: `src/jinaga-browser.ts`

**Requirements**:
- [x] If `httpEndpoint` and `wsEndpoint` are provided and `WebSocket` is available, construct `HttpNetwork` and wrap it in `WsGraphNetwork` (same as applications).
- [x] No test-only branches.

### 0.2 WebSocket authentication aligned with HTTP
**Locations**: `src/jinaga-browser.ts`, `src/ws/wsGraphNetwork.ts`, `src/ws/ws-graph-client.ts`

**Requirements**:
- [x] Reuse `httpAuthenticationProvider` to obtain the Authorization value when opening WS connection.
- [x] Propagate async `getAuthorizationHeader` (or equivalent) into `WsGraphNetwork` → client URL builder.
- [x] Append token to WS URL as a query parameter (e.g., `authorization`), since browsers cannot set custom WS headers.
- [ ] Server accepts/validates this token equivalently to HTTP Authorization (to be covered in Phase 3 harness).

## Phase 1: Storage Feed Support ✅
### 1.1 Implement `MemoryStore.feed` (better fidelity)
**Location**: `src/memory/memory-store.ts`

**Objective**: Provide initial feed tuples using the same read engine as apps.

**Required Steps**:
- [x] Use `SpecificationRunner.read(start, specification)` to compute `ProjectedResult[]`
- [x] Map each `ProjectedResult` to a `FactTuple` by extracting fact references from `result.tuple`
- [x] Return `FactFeed` with tuples and a stable bookmark string
- [x] Ensure idempotence and predictable ordering

**Completed**: Implementation found in `MemoryStore.feed()` at lines 85-111. Uses `SpecificationRunner.read`, maps results to `FactTuple[]` with sorted fact references, and computes stable bookmarks using object hashing.

**Notes**:
- Bookmark format may be a stable string derived from the result set; server will still advance bookmarks via `BookmarkManager` during reactive updates.

## Phase 2: Server Wiring & Protocol ✅
### 2.1 Construct simulated server components
**Locations**: `test/ws/graphWebSocketSpec.ts`

**Objective**: Mirror production composition in tests.

**Required Steps**:
- [x] Create `serverStore: MemoryStore`
- [x] Create `observable: ObservableSource` using `serverStore`
- [x] Create `serverFactManager` using `PassThroughFork(serverStore)`, `NetworkNoOp`, and empty purge rules
- [x] Create `authorization: AuthorizationNoOp` with `serverFactManager` and `serverStore`
- [x] Create `inverseEngine: InverseSpecificationEngine` from `observable.add/removeSpecificationListener`
- [x] Create `bookmarks: BookmarkManager`
- [x] Create `resolveFeed(feedId) => Specification` for test feeds
- [x] Instantiate `AuthorizationWebSocketHandler(authorization, resolveFeed, inverseEngine, bookmarks)`

**Completed**: All production server components properly instantiated in test harness. Full server architecture mirrors production setup with FactManager managing ObservableSource and MemoryStore.

### 2.2 WebSocket connection handling
**Location**: `src/ws/authorization-websocket-handler.ts`

**Behavior**:
- [ ] On `SUB`, call `authorization.feed` to load initial tuples
- [ ] If tuples exist, call `authorization.load` and send serialized graph
- [ ] Send `BOOK` with initial or advanced bookmark
- [ ] Compute inverses via `invertSpecification`
- [ ] Register inverse listeners via `inverseEngine`; when results arrive:
  - For add: `authorization.load` the refs and stream graph, then `BOOK`
  - For remove: just `BOOK`

## Phase 3: Full HTTP + WS Test Harness ❌
### 3.1 HTTP server (feeds resolution)
**Locations**: Test-only HTTP server module

**Objective**: Mirror production feed resolution contract.

**Required Steps**:
- [ ] Implement `POST /feeds` returning `{ feeds: ["feed1", ...] }`
- [ ] Optionally validate an Authorization bearer token
- [ ] Keep `/load` unused for this test (graph streamed over WS)

### 3.2 WebSocket server
**Locations**: Test harness, using `ws` `WebSocketServer`

**Required Steps**:
- [ ] On connection, attach `AuthorizationWebSocketHandler`
- [ ] Let the handler process `SUB`/`UNSUB` and stream graph + `BOOK`

### 3.3 Client configuration
**Locations**: `src/jinaga-browser.ts`, `src/ws/wsGraphNetwork.ts`

**Required Steps**:
- [ ] Instantiate `Jinaga` via `JinagaBrowser.create` with `httpEndpoint`, `wsEndpoint`, and an `httpAuthenticationProvider`
- [ ] `Jinaga.subscribe` should resolve feeds via HTTP, then stream via WS
- [ ] Use `MemoryStore` on the client (default when IndexedDB not provided)

### 3.4 Observer-notification bridge (client side)
**Objective**: Facts streamed over WS trigger `Jinaga.subscribe` observers without requiring HTTP `load`.

**Required Steps**:
- [ ] Add an optional "facts added" callback on the WS network.
- [ ] In `WsGraphNetwork`, add `setFactsAddedListener(listener)` to register a callback.
- [ ] In `WsGraphClient`, after persisting envelopes via the store, invoke the registered callback with the saved envelopes.
- [ ] In `FactManager` construction (when network supports it), register `factsAdded => this.factsAdded(factsAdded)` so observers are notified via `ObservableSource`.

## Phase 4: E2E via `JinagaBrowser.subscribe` ❌
### 4.1 Test flow
**Location**: `test/ws/graphWebSocketSpec.ts` (or a new e2e spec)

**Required Steps**:
- [ ] Define a minimal domain/specification and call `j.subscribe(...)`
- [ ] Verify that initial graph (if any) is persisted and `BOOK` advances
- [ ] Trigger server-side saves via `authorization.save` (see Phase 5) and assert:
  - [ ] Facts streamed over WS are persisted on the client
  - [ ] `BOOK` advances per update
  - [ ] Observer callback is invoked with expected results

## Phase 5: Triggering Reactive Updates (Chosen Path) ❌
### 5.1 Server-trigger using `authorization.save`
**Objective**: Maximum fidelity for inverse notifications.

**Required Steps**:
- [ ] In test, construct envelopes for new facts
- [ ] Call `authorization.save(null, envelopes)` on the server
- [ ] Expect inverse listeners to fire and WS to emit graph + `BOOK`

## Success Criteria
- [ ] `JinagaBrowser` constructs and injects `WsGraphNetwork` when `wsEndpoint` is set (and HTTP present), same as in applications
- [ ] WS connection carries an auth token derived from the HTTP auth provider via querystring
- [ ] `MemoryStore.feed` returns tuples using `SpecificationRunner` with stable initial bookmark
- [ ] Simulated server streams initial graph and `BOOK` on `SUB`
- [ ] Inverses computed via `invertSpecification` trigger reactive graph streaming
- [ ] Server-side `authorization.save` results in client persistence and `BOOK` advancement
- [ ] Facts streamed over WS trigger observer notifications via `Jinaga.subscribe`
- [ ] E2E passes using `JinagaBrowser.subscribe` with full HTTP + WS setup

## Alternatives (Documented for Flexibility)
- **Alternative feed implementation (lower effort)**:
  - Implement `MemoryStore.feed` to return `{ tuples: [], bookmark }` only. Initial results come empty; reactive updates still work. Suitable when initial dataset is irrelevant.

- **Alternative reactive trigger (simpler, less fidelity)**:
  - Save directly to the server store and notify observers:
    - `serverStore.save(envelopes)` then `observable.notify(envelopes)`
  - Bypasses `authorization.save`; good for unit-style tests where auth/signing is out of scope.

- **Alternative test setup (lighter-weight)**:
  - Replace the HTTP server with an in-process stub for `feeds()` returning a fixed array (e.g., `['feed1']`). Continue to use the real WS server for streaming.

## Dependencies
- [ ] `ws` library (server and client in Node tests)
- [ ] Minimal HTTP server in tests (e.g., Node `http` or `express`)
- [ ] `JinagaBrowser` wiring to construct `WsGraphNetwork` when `wsEndpoint` is provided

## Notes
- The WS client cannot set custom headers in browsers; if auth is needed, propagate tokens via query parameters from the HTTP auth provider when constructing the WS URL.
- Bookmarks: initial bookmark returned from `MemoryStore.feed` should be treated as a starting position; reactive updates advance via `BookmarkManager` in the server.

## Current Status
- 🔄 Phase 1 in progress; other phases pending.
