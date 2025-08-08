# WebSocket Integrated Implementation Plan

## Overview
Coordinated implementation of both WebSocket Protocol Refactoring and Authorization Integration plans. This plan ensures proper sequencing, dependency management, and integration testing between the two plans.

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
- [ ] Create `AuthorizationWebSocketHandler` class
- [ ] Inject Authorization implementation
- [ ] Handle WebSocket connections
- [ ] Process SUB/UNSUB messages

#### 3.2 Feed Authorization Integration
- [ ] Use `authorization.feed()` for initial data loading
- [ ] Stream authorized facts via WebSocket
- [ ] Handle authorization errors
- [ ] Validate user identity

#### 3.3 Inverse Specification Integration
- [ ] Create `InverseSpecificationEngine`
- [ ] Use `invertSpecification()` for reactive updates
- [ ] Set up specification listeners
- [ ] Handle add/remove operations

#### 3.4 Bookmark Management Integration
- [ ] Create `BookmarkManager`
- [ ] Integrate bookmark advancement with authorization
- [ ] Send BOOK frames after updates
- [ ] Handle bookmark validation

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
- [ ] Test inverse specification integration
- [ ] Test authorization context propagation
- [ ] Test bookmark management with authorization
- [ ] Performance testing with authorization overhead

#### 5.2 End-to-End Testing
- [ ] Full client-server integration testing
- [ ] Real-world scenario testing
- [ ] Performance benchmarking
- [ ] Stress testing

## Dependencies and Handoff Points

### Critical Dependencies
1. **Protocol Refactoring → Authorization Integration**: Authorization integration cannot begin until protocol refactoring is complete
2. **Authorization Integration → FactFeed Enhancement**: FactFeed changes depend on authorization integration being stable
3. **All Phases → Comprehensive Testing**: Final testing phase depends on all implementation phases

### Handoff Criteria
- **Phase 1 → Phase 2**: All WebSocket protocol commands working, HTTP deserializer cleaned up, performance benchmarks met
- **Phase 2 → Phase 3**: Authorization context support added, integration tests passing
- **Phase 3 → Phase 4**: Authorization integration working, inverse specifications functional
- **Phase 4 → Phase 5**: FactFeed interface enhanced, backward compatibility verified

## Risk Mitigation

### Technical Risks
- **Complexity Increase**: New architecture adds complexity
  - *Mitigation*: Incremental implementation with thorough testing
- **Performance Impact**: Additional parsing overhead
  - *Mitigation*: Performance benchmarking and optimization
- **Interface Changes**: FactFeed enhancement
  - *Mitigation*: Make authorization context optional for backward compatibility

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
- [ ] Authorization handler working with WebSocket connections
- [ ] Initial feed loading uses `authorization.feed()`
- [ ] Reactive updates use `invertSpecification()`
- [ ] Bookmarks properly managed and advanced
- [ ] WebSocket streaming works with authorization

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

## Testing Strategy

### Unit Testing
- [ ] Protocol router functionality
- [ ] Control frame handler
- [ ] Authorization handler
- [ ] Inverse specification engine
- [ ] Bookmark manager

### Integration Testing
- [ ] WebSocket client with protocol router
- [ ] Authorization integration with WebSocket
- [ ] FactFeed interface with authorization context
- [ ] End-to-end client-server communication

### Performance Testing
- [ ] Message processing speed
- [ ] Memory usage optimization
- [ ] Authorization overhead measurement
- [ ] Stress testing

## Monitoring and Validation

### Key Metrics
- [ ] WebSocket connection success rate
- [ ] Message processing latency
- [ ] Authorization check performance
- [ ] Memory usage patterns
- [ ] Error rates and types

### Validation Checkpoints
- [ ] Phase completion criteria met
- [ ] Performance benchmarks achieved
- [ ] Integration tests passing
- [ ] Backward compatibility verified
- [ ] Documentation updated

## Notes

### Architecture Decisions
- **Sequential Implementation**: Protocol refactoring must complete before authorization integration
- **Backward Compatibility**: All changes maintain existing functionality
- **Incremental Testing**: Each phase includes comprehensive testing
- **Clear Handoffs**: Well-defined criteria for moving between phases

### Performance Considerations
- Protocol routing adds minimal overhead
- Authorization checks may add latency
- Memory usage optimization for multiple connections
- Efficient bookmark management

### Future Extensibility
- Easy to add new WebSocket commands
- Support for other protocols (gRPC, etc.)
- Authorization context extensibility
- Protocol versioning support
