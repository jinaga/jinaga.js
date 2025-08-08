# WebSocket Authorization Integration Design

## Overview

This document outlines the design for integrating the Authorization interface with WebSocket-based fact streaming, using inverse specifications for reactive updates. The client uses the standard Jinaga browser factory, while the server injects Authorization implementations to handle feed operations and reactive updates.

## Architecture Overview

### Client-Side Components (Standard Jinaga Browser Factory)

The client follows the standard Jinaga browser factory pattern without direct Authorization interface usage:

```typescript
// Standard client initialization
const jinaga = JinagaBrowser.create({
  httpEndpoint: 'https://api.example.com',
  wsEndpoint: 'wss://api.example.com/ws',
  indexedDb: 'jinaga-store',
  feedRefreshIntervalSeconds: 60
});

// Standard observer/watch pattern
const observer = jinaga.watch(specification, async (result) => {
  // Handle reactive updates
  return Promise.resolve();
});
```

### Server-Side Components (Authorization Injection)

The server injects Authorization implementations into a WebSocket handler that handles:

1. **Initial Feed Loading**: Uses `authorization.feed()` to load initial facts
2. **Inverse Specifications**: Uses `invertSpecification()` for reactive updates
3. **Bookmark Management**: Manages bookmark advancement after updates
4. **WebSocket Streaming**: Streams facts and sends BOOK frames

## Component Architecture

### Client-Side Architecture

```mermaid
graph TB
    subgraph "Client-Side (Standard Factory)"
        JinagaBrowser[JinagaBrowser.create()]
        FactManager[FactManager]
        NetworkManager[NetworkManager]
        WsGraphNetwork[WsGraphNetwork]
        Subscriber[Subscriber]
        Store[Storage]
    end
    
    subgraph "Network Interface"
        Network[Network Interface]
        feeds[feeds()]
        fetchFeed[fetchFeed()]
        streamFeed[streamFeed()]
        load[load()]
    end
    
    JinagaBrowser --> FactManager
    FactManager --> NetworkManager
    NetworkManager --> WsGraphNetwork
    WsGraphNetwork --> Network
    NetworkManager --> Subscriber
    FactManager --> Store
```

### Server-Side Architecture

```mermaid
graph TB
    subgraph "Server-Side (Authorization Injection)"
        WSServer[WebSocket Server]
        AuthHandler[Authorization Handler]
        Authorization[Authorization Implementation]
        InverseEngine[Inverse Specification Engine]
        BookmarkManager[Bookmark Manager]
    end
    
    subgraph "Authorization Interface"
        feed[feed()]
        read[read()]
        load[load()]
        save[save()]
        verifyDistribution[verifyDistribution()]
    end
    
    subgraph "Inverse Specifications"
        invertSpec[invertSpecification()]
        specListeners[Specification Listeners]
        reactiveUpdates[Reactive Updates]
    end
    
    WSServer --> AuthHandler
    AuthHandler --> Authorization
    Authorization --> feed
    Authorization --> read
    Authorization --> load
    AuthHandler --> InverseEngine
    InverseEngine --> invertSpec
    invertSpec --> specListeners
    specListeners --> reactiveUpdates
    AuthHandler --> BookmarkManager
```

## Implementation Details

### 1. Enhanced FactFeed Interface

The `FactFeed` interface needs to be augmented to include authorization context:

```typescript
export interface FactFeed {
  tuples: FactTuple[];
  bookmark: string;
  // Optional authorization context - backward compatible
  authorizationContext?: {
    specification?: Specification;
    userIdentity?: UserIdentity;
    metadata?: Record<string, any>;
  };
}
```

### 2. Authorization WebSocket Handler

```typescript
// Implemented in src/ws/authorization-websocket-handler.ts
```

### 3. Inverse Specification Engine

```typescript
// Implemented in src/ws/inverse-specification-engine.ts
```

### 4. Bookmark Manager

```typescript
// Implemented in src/ws/bookmark-manager.ts
```

## Runtime Integration Flow

### Phase 1: Client Initialization ✅

- [x] Client uses standard Jinaga browser factory
- [x] NetworkManager manages network operations
- [x] WsGraphNetwork implements Network interface
- [x] Subscriber handles feed subscriptions

### Phase 2: Server Authorization Handler ✅

- [x] Create AuthorizationWebSocketHandler class
- [x] Inject Authorization implementation
- [x] Handle WebSocket connections
- [x] Process SUB/UNSUB messages

### Phase 3: Feed Authorization Integration ✅

- [x] Use `authorization.feed()` for initial data loading
- [x] Stream authorized facts via WebSocket
- [x] Handle authorization errors
- [x] Validate user identity (plumbed via ws query param)

### Phase 4: Inverse Specification Integration 🔄

- [x] Create InverseSpecificationEngine
- [x] Use `invertSpecification()` for reactive updates
- [x] Set up specification listeners removal on UNSUB/close
- [x] Handle add/remove operations

### Phase 5: Bookmark Management 🔄

- [x] Create BookmarkManager
- [x] Integrate bookmark advancement with authorization
- [x] Send BOOK frames after updates
- [x] Handle bookmark validation (server-side sync on SUB)

### Phase 6: Enhanced FactFeed Interface ❌

- [x] Augment FactFeed interface with optional authorization context
- [x] Add specification and user identity fields
- [ ] Include authorization context propagation in responses
- [ ] Update related interfaces

### Phase 7: Comprehensive Testing ❌

- [ ] Test inverse specification integration
- [ ] Test authorization context propagation
- [ ] Test bookmark management with authorization (including SUB sync)
- [ ] Performance testing with authorization overhead
- [ ] Integration testing with protocol refactoring

## Success Criteria

- [x] Client uses standard Jinaga browser factory without Authorization knowledge
- [x] Server injects Authorization implementation into WebSocket handler
- [x] Initial feed loading uses `authorization.feed()`
- [x] Reactive updates use `invertSpecification()` (add/remove operations)
- [x] Bookmarks are properly managed and advanced
- [x] Enhanced FactFeed interface shape updated (backward compatible)
- [ ] Test scenario validates all integration points
- [ ] Enhanced FactFeed interface is backward compatible

## Updated Risk Assessment

### Technical Risks
- **Interface Changes**: FactFeed enhancement
  - *Mitigation*: Make authorization context optional for backward compatibility
- **Component Coordination**: Bookmark management overlap
  - *Mitigation*: Single BookmarkManager shared by both plans
- **Inverse Specification Complexity**: Complex inverse logic
  - *Mitigation*: Leverage existing inverse.ts implementation

### Integration Risks
- **Protocol Refactoring Dependencies**: Authorization integration depends on protocol refactoring
  - *Mitigation*: Sequential implementation with clear handoff points
- **Naming Conflicts**: Router vs Handler terminology
  - *Mitigation*: Use distinct naming (MessageRouter vs AuthHandler)

### Rollback Strategy
- [ ] Keep current implementation as fallback
- [ ] Feature flag to switch between implementations
- [ ] Comprehensive testing before production deployment
- [ ] Monitoring and alerting for performance regressions

## Dependencies
- [ ] Protocol Refactoring Plan Phase 1-4 must complete
- [ ] Inverse specification functionality available (src/specification/inverse.ts)
- [ ] Authorization interface stable
- [ ] Testing environment prepared
- [ ] Performance benchmarking tools

## Inter-Plan Dependencies
- [ ] Protocol Refactoring Plan Phase 1-4 must complete before Authorization Integration Plan Phase 2-5
- [ ] Both plans share bookmark management - coordinate implementation
- [ ] Both plans affect WebSocket client - coordinate testing

## Notes

- The client remains unchanged and uses the standard factory pattern
- Authorization is injected only on the server side
- Inverse specifications provide reactive updates without client changes
- Bookmark management integrates with authorization for proper advancement
- The design maintains clean separation between client and server responsibilities
- Enhanced FactFeed interface is backward compatible
- Uses existing inverse specification implementation from src/specification/inverse.ts
