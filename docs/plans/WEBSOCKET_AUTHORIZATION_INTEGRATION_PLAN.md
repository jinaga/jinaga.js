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
        FeedEngine[Feed Engine]
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
    AuthHandler --> FeedEngine
    FeedEngine --> InverseEngine
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
class AuthorizationWebSocketHandler {
  constructor(
    private authorization: Authorization,
    private inverseEngine: InverseSpecificationEngine,
    private bookmarkManager: BookmarkManager
  ) {}

  handleConnection(socket: WebSocket, userIdentity: UserIdentity) {
    socket.on('SUB', async (feed, bookmark) => {
      try {
        // 1. Use Authorization to get initial feed data
        const factFeed = await this.authorization.feed(
          userIdentity,
          this.getSpecificationForFeed(feed),
          [], // start references
          bookmark
        );

        // 2. Stream initial facts
        if (factFeed.tuples.length > 0) {
          const envelopes = await this.authorization.load(
            userIdentity,
            factFeed.tuples.flatMap(tuple => tuple.facts)
          );
          socket.send(serializeGraph(envelopes));
        }

        // 3. Set up inverse specification listeners for reactive updates
        const specification = this.getSpecificationForFeed(feed);
        const inverses = invertSpecification(specification);
        
        const inverseListeners = inverses.map(inverse => 
          this.inverseEngine.addSpecificationListener(
            inverse.inverseSpecification,
            async (results) => {
              if (inverse.operation === 'add') {
                // New facts that match inverse - stream them
                const newEnvelopes = await this.authorization.load(
                  userIdentity,
                  results.flatMap(r => Object.values(r.tuple))
                );
                socket.send(serializeGraph(newEnvelopes));
                
                // Advance bookmark
                const newBookmark = await this.bookmarkManager.advanceBookmark(feed);
                socket.send(`BOOK\n${JSON.stringify(feed)}\n${JSON.stringify(newBookmark)}\n\n`);
              }
            }
          )
        );

        // 4. Send initial bookmark advancement
        if (factFeed.bookmark !== bookmark) {
          socket.send(`BOOK\n${JSON.stringify(feed)}\n${JSON.stringify(factFeed.bookmark)}\n\n`);
        }

      } catch (error) {
        socket.send(`ERR\n${JSON.stringify(feed)}\n${JSON.stringify(error.message)}\n\n`);
      }
    });
  }

  private getSpecificationForFeed(feed: string): Specification {
    // Map feed ID to specification
    // This would be implemented based on your feed-to-specification mapping
    return { /* specification */ };
  }
}
```

### 3. Inverse Specification Engine

```typescript
class InverseSpecificationEngine {
  constructor(private authorization: Authorization) {}

  addSpecificationListener(
    specification: Specification,
    onResult: (results: ProjectedResult[]) => Promise<void>
  ): SpecificationListener {
    // Implementation that uses authorization for fact loading
    // Uses existing invertSpecification() from src/specification/inverse.ts
    return this.authorization.addSpecificationListener(specification, onResult);
  }
}
```

### 4. Bookmark Manager

```typescript
class BookmarkManager {
  private bookmarks = new Map<string, string>();

  async advanceBookmark(feed: string): Promise<string> {
    const currentBookmark = this.bookmarks.get(feed) || '';
    const newBookmark = generateBookmark(); // Implementation specific
    this.bookmarks.set(feed, newBookmark);
    return newBookmark;
  }

  getBookmark(feed: string): string {
    return this.bookmarks.get(feed) || '';
  }
}
```

## Runtime Integration Flow

### Phase 1: Client Initialization ✅

- [x] Client uses standard Jinaga browser factory
- [x] NetworkManager manages network operations
- [x] WsGraphNetwork implements Network interface
- [x] Subscriber handles feed subscriptions

### Phase 2: Server Authorization Handler 🔄

- [ ] Create AuthorizationWebSocketHandler class
- [ ] Inject Authorization implementation
- [ ] Handle WebSocket connections
- [ ] Process SUB/UNSUB messages

### Phase 3: Feed Authorization Integration ❌

- [ ] Use `authorization.feed()` for initial data loading
- [ ] Stream authorized facts via WebSocket
- [ ] Handle authorization errors
- [ ] Validate user identity

### Phase 4: Inverse Specification Integration ❌

- [ ] Create InverseSpecificationEngine
- [ ] Use `invertSpecification()` for reactive updates
- [ ] Set up specification listeners
- [ ] Handle add/remove operations

### Phase 5: Bookmark Management ❌

- [ ] Create BookmarkManager
- [ ] Integrate bookmark advancement with authorization
- [ ] Send BOOK frames after updates
- [ ] Handle bookmark validation

### Phase 6: Enhanced FactFeed Interface ❌

- [ ] Augment FactFeed interface with optional authorization context
- [ ] Add specification and user identity fields
- [ ] Include authorization context
- [ ] Update related interfaces

### Phase 7: Comprehensive Testing ❌

- [ ] Test inverse specification integration
- [ ] Test authorization context propagation
- [ ] Test bookmark management with authorization
- [ ] Performance testing with authorization overhead
- [ ] Integration testing with protocol refactoring

## Test Scenario Integration

```typescript
describe('Authorization + WebSocket + Inverse Integration', () => {
  test('server uses authorization to stream facts and reactively updates', async () => {
    // 1. Client setup (standard factory)
    const jinaga = JinagaBrowser.create({
      wsEndpoint: 'ws://localhost:8080'
    });
    
    const observer = jinaga.watch(specification, async (result) => {
      // Handle reactive updates
      return Promise.resolve();
    });

    // 2. Server setup (authorization injection)
    const wss = new WebSocketServer({ port: 8080 });
    const authorization = new AuthorizationNoOp(factManager, store);
    const inverseEngine = new InverseSpecificationEngine(authorization);
    const bookmarkManager = new BookmarkManager();
    
    const handler = new AuthorizationWebSocketHandler(
      authorization,
      inverseEngine,
      bookmarkManager
    );

    wss.on('connection', (socket) => {
      const userIdentity = createTestUserIdentity();
      handler.handleConnection(socket, userIdentity);
    });

    // 3. Test flow
    await observer.loaded();
    
    // Verify authorization was used for initial feed
    expect(authorization.feed).toHaveBeenCalledWith(
      userIdentity,
      specification,
      [],
      ''
    );
    
    // Verify inverse specifications were set up
    expect(inverseEngine.addSpecificationListener).toHaveBeenCalled();
    
    // Verify bookmark advancement
    expect(bookmarkManager.advanceBookmark).toHaveBeenCalled();
  });
});
```

## Key Integration Points

### Client-Side (Standard Factory)
1. **JinagaBrowser.create()**: Standard factory creates all components
2. **NetworkManager**: Manages network operations through injected Network
3. **WsGraphNetwork**: WebSocket-specific Network implementation
4. **Subscriber**: Handles feed subscriptions and bookmark management
5. **No Authorization**: Client doesn't know about Authorization interface

### Server-Side (Authorization Injection)
1. **Authorization Handler**: Injects Authorization implementation
2. **Feed Authorization**: Uses `authorization.feed()` for initial data
3. **Inverse Specifications**: Uses `invertSpecification()` for reactive updates
4. **Bookmark Management**: Manages bookmark advancement after updates
5. **WebSocket Streaming**: Streams facts and sends BOOK frames

### FactFeed Augmentation
1. **Enhanced Interface**: Add optional authorization context to FactFeed
2. **Authorization Context**: Include authorization context in feed responses
3. **Bookmark Integration**: Ensure bookmarks are properly managed through authorization

## Success Criteria

- [ ] Client uses standard Jinaga browser factory without Authorization knowledge
- [ ] Server injects Authorization implementation into WebSocket handler
- [ ] Initial feed loading uses `authorization.feed()`
- [ ] Reactive updates use `invertSpecification()`
- [ ] Bookmarks are properly managed and advanced
- [ ] WebSocket streaming works with authorization
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
