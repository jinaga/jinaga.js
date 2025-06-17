# WebSocket Review

This document contains a review of the WebSocket implementation and related documents:

- [WebSocket Network Architecture](./websocket-network-architecture.md)
- [WebSocket Implementation Plan](./websocket-implementation-plan.md)

## Requested Changes

- [X] Change the signature of `streamFeed` in `WebSocketClient`; replace `onResponse` with `onEnvelope` and `onBookmark`.
- [X] Remove the `EnhancedFeedResponse`; it is not necessary after `onResponse` is replaced.
- [ ] Change the `streamFeed` signature on the `Network` interface to be in alignment with `WebSocketClient`.
- [ ] Change the `Subscriber` fybctuib `connectToFeed` to use the new `streamFeed` signature.
- [ ] Implement the `streamFeed` method on `HttpNetwork` in terms of long polling.
- [ ] Create a new `WebSocketNetwork` class that extends `HttpNetwork` and re-implements `streamFeed` in terms of web sockets.
- [ ] Use the `wsEndpoint` configuration in `JinagaBrowserConfig` (src/jinaga-browser.ts) to determine which `Network` implementation to create; if both `wsEndpoint` and `httpEndpoint` are set, create a `WebSocketNetwork`; if only `httpEndpoint` is set, create an `HttpNetwork`; otherwise, create a `NetworkNoOp`.
- [ ] Eliminate the `EnhancedNetwork` type; make the changes to the `Network` interface as described above.
- [ ] Eliminate the `StreamFeedResponse` type.
- [ ] Merge the documentation down in to two files
  - WebSocket Network Architecture
  - WebSocket Implementation Plan