# WebSocket Integrated Implementation Plan

## Overview
Coordinated implementation of both WebSocket Protocol Refactoring and Authorization Integration plans. This plan ensures proper sequencing, dependency management, and integration testing between the two plans.

## Distribution Rules + Authentication Interaction (Findings)
- Distribution access control is implemented in `DistributionEngine` using `DistributionRules`. It evaluates whether a user (as a FactReference) can receive a given feed via `canDistributeToAll`.
- HTTP flows pass authentication via headers (see `AuthenticationProvider.getHeaders()`), while distribution enforcement occurs in `NetworkDistribution` by providing the current user fact to `DistributionEngine`.
- WebSocket flows currently pass identity via `uid` query string and perform authorization-based reads/loads, but do not yet enforce distribution rules on SUB.
- To align with HTTP behavior, the WebSocket server should evaluate distribution rules on SUB and emit `ERR` frames on violations.

## Implementation Phases

### Phase 1: Foundation (Protocol Refactoring)
**Dependencies**: None
**Duration**: 2-3 weeks
**Deliverables**: Clean protocol separation, working WebSocket client

#### 1.1 Protocol Router Implementation
- [x] Create `WebSocketMessageRouter` class
- [x] Implement `ProtocolMessage` and `ControlFrame` interfaces
- [x] Add message routing logic
- [x] Write comprehensive unit tests

#### 1.2 Control Frame Handler Implementation
- [x] Create `ControlFrameHandler` class
- [x] Implement BOOK/ERR/SUB/UNSUB command handling
- [x] Add bookmark management logic
- [ ] Write unit tests for each command type

#### 1.3 WebSocket Client Refactoring
- [x] Integrate protocol router into `WsGraphClient`
- [x] Separate graph buffer from protocol handling
- [x] Update socket event handling
- [x] Maintain backward compatibility

#### 1.4 HTTP Deserializer Cleanup
- [x] Remove WebSocket command detection from `GraphDeserializer`
- [x] Restore HTTP-only functionality
- [ ] Update tests and documentation

#### 1.5 Validation and Optimization
- [ ] Performance testing and benchmarking
- [ ] Integration testing
- [ ] Code review and cleanup

### Phase 2: Authorization Integration Preparation
**Dependencies**: Phase 1 complete
**Duration**: 1 week
**Deliverables**: Authorization-ready WebSocket client

#### 2.1 Authorization Context Support
- [x] Add authorization context types to protocol router
- [x] Prepare bookmark management for authorization integration
- [x] Add user identity support to WebSocket client (optional URL param)
- [x] Update type definitions for authorization context

#### 2.2 Integration Testing
- [ ] Test protocol router with authorization context
- [ ] Verify bookmark management works with authorization
- [ ] Test error handling with authorization errors
- [ ] Verify reconnection behavior with authorization

### Phase 3: Authorization Integration
**Dependencies**: Phase 2 complete
**Duration**: 2-3 weeks
**Deliverables**: Authorization-enabled WebSocket server

#### 3.1 Authorization Handler Implementation
- [x] Create `AuthorizationWebSocketHandler` class
- [x] Inject Authorization implementation
- [x] Handle WebSocket connections
- [x] Process SUB/UNSUB messages

#### 3.2 Feed Authorization Integration
- [x] Use `authorization.feed()` for initial data loading
- [x] Stream authorized facts via WebSocket
- [x] Handle authorization errors
- [x] Validate user identity

#### 3.3 Inverse Specification Integration
- [x] Create `InverseSpecificationEngine`
- [x] Use `invertSpecification()` for reactive updates (add only)
- [x] Set up listener removal on UNSUB/close
- [x] Handle remove operations

#### 3.4 Bookmark Management Integration
- [x] Create `BookmarkManager`
- [x] Integrate bookmark advancement with authorization
- [x] Send BOOK frames after updates
- [x] Handle bookmark validation

### Phase 4: Enhanced FactFeed Interface
**Dependencies**: Phase 3 complete
**Duration**: 1 week
**Deliverables**: Backward-compatible FactFeed enhancement

#### 4.1 FactFeed Interface Enhancement
- [ ] Add optional authorization context to FactFeed interface
- [ ] Add specification and user identity fields
- [ ] Include authorization context
- [ ] Update related interfaces

#### 4.2 Backward Compatibility
- [ ] Ensure existing code continues to work
- [ ] Add migration utilities if needed
- [ ] Update documentation

### Phase 5: Comprehensive Testing
**Dependencies**: All phases complete
**Duration**: 1-2 weeks
**Deliverables**: Fully tested and validated implementation

#### 5.1 Integration Testing
- [x] Test inverse specification integration
- [x] Test authorization context propagation (server-side bookmark sync)
- [x] Test bookmark management with authorization (including SUB sync)
- [ ] Performance testing with authorization overhead
- [ ] Test WebSocket SUB distribution rule enforcement with `ERR` frames on violations

#### 5.2 End-To-End and Error Handling
- [x] Full client-server integration testing (ws handler unit/integration)
- [ ] Real-world scenario testing
- [ ] Performance benchmarking
- [ ] Stress testing
- [ ] Validate that distribution rule violations emit `ERR` frames and do not register listeners

### Phase 6: Distribution Rule Enforcement on WebSocket
**Dependencies**: Phases 2-3 complete
**Duration**: 1 week
**Deliverables**: Consistent access control across HTTP and WebSocket

- [ ] Inject `DistributionEngine` into WebSocket server
- [ ] Resolve feed specification and named start from `feed` id for SUB
- [ ] Evaluate `canDistributeToAll` for the connecting user identity
- [ ] On violation, emit `ERR` frame (`ERR\n<feed>\n<message>\n\n`) and skip listener registration
- [ ] Add unit/integration tests for allowed/denied cases
- [ ] Document interaction with HTTP auth headers and WS `uid` identity

## Dependencies and Handoff Points

### Critical Dependencies
1. **Protocol Refactoring → Authorization Integration**: Authorization integration cannot begin until protocol refactoring is complete
2. **Authorization Integration → FactFeed Enhancement**: FactFeed changes depend on authorization integration being stable
3. **All Phases → Comprehensive Testing**: Final testing phase depends on all implementation phases
4. **Distribution Rules → WS Enforcement**: WebSocket distribution checks depend on mapping `feed` to specification + start

### Handoff Criteria
- **Phase 1 → Phase 2**: All WebSocket protocol commands working, HTTP deserializer cleaned up, performance benchmarks met
- **Phase 2 → Phase 3**: Authorization context support added, integration tests passing
- **Phase 3 → Phase 4**: Authorization integration working, inverse specifications functional
- **Phase 4 → Phase 5**: FactFeed interface enhanced, backward compatibility verified
- **Phase 6 → Completion**: Distribution rule enforcement active on WS; `ERR` frames emitted on violations; tests passing

## Risk Mitigation

### Technical Risks
- **Complexity Increase**: New architecture adds complexity
  - *Mitigation*: Incremental implementation with thorough testing
- **Performance Impact**: Additional parsing overhead
  - *Mitigation*: Performance benchmarking and optimization
- **Interface Changes**: FactFeed enhancement
  - *Mitigation*: Make authorization context optional for backward compatibility
- **Feed Mapping**: Need reliable mapping from feed id to specification + start
  - *Mitigation*: Centralize feed resolution on server; reuse HTTP feed cache where applicable

### Integration Risks
- **Protocol Refactoring Dependencies**: Authorization integration depends on protocol refactoring
  - *Mitigation*: Sequential implementation with clear handoff points
- **Component Coordination**: Bookmark management overlap
  - *Mitigation*: Single BookmarkManager shared by both plans
- **Naming Conflicts**: Router vs Handler terminology
  - *Mitigation*: Use distinct naming (MessageRouter vs AuthHandler)

### Rollback Strategy
- [ ] Keep current implementation as fallback
- [ ] Feature flag to switch between implementations
- [ ] Comprehensive testing before production deployment
- [ ] Monitoring and alerting for performance regressions

## Success Criteria

### Phase 1 Success Criteria
- [x] All WebSocket protocol commands handled correctly
- [x] HTTP deserializer no longer contains WebSocket code
- [ ] Performance matches or exceeds current implementation
- [x] All existing tests pass without modification
- [x] New architecture supports protocol evolution

### Phase 2 Success Criteria
- [x] Authorization context support added to protocol router
- [x] Bookmark management prepared for authorization integration
- [x] User identity support added to WebSocket client
- [ ] Integration tests with authorization context passing

### Phase 3 Success Criteria
- [x] Authorization handler working with WebSocket connections
- [x] Initial feed loading uses `authorization.feed()`
- [x] Reactive updates use `invertSpecification()` for adds
- [x] Bookmarks properly managed and advanced
- [x] Listener lifecycle handled for UNSUB/close
- [x] Remove operations processed

### Phase 4 Success Criteria
- [ ] Enhanced FactFeed interface is backward compatible
- [ ] Authorization context properly propagated
- [ ] All dependent components updated
- [ ] Migration utilities available if needed

### Phase 5 Success Criteria
- [ ] All integration tests passing
- [ ] Performance benchmarks maintained or improved
- [ ] End-to-end functionality verified
- [ ] Documentation complete and accurate
- [ ] WebSocket distribution rule enforcement tested with `ERR` frames

### Phase 6 Success Criteria
- [ ] Distribution rules enforced on SUB
- [ ] Violations emit `ERR` frames
- [ ] No listeners registered for denied feeds
- [ ] Behavior consistent with HTTP distribution enforcement
