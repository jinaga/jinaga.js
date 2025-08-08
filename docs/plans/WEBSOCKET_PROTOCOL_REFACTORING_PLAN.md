# WebSocket Protocol Refactoring Implementation Plan

## Overview
Refactor the WebSocket client architecture to properly separate graph data parsing from protocol command parsing, eliminating the architectural coupling between HTTP deserializer and WebSocket protocol commands.

## Progress Summary
- ❌ **Phase 1: Create New Components** - PENDING
- ❌ **Phase 2: Refactor WebSocket Client** - PENDING
- ❌ **Phase 3: Clean Up HTTP Deserializer** - PENDING
- ❌ **Phase 4: Validation and Optimization** - PENDING
- ❌ **Phase 5: Authorization Integration Preparation** - PENDING

**Current Status**: Planning phase - architecture design complete, implementation pending

## Prerequisites
- [ ] Understanding of current WebSocket client architecture
- [ ] Familiarity with GraphDeserializer implementation
- [ ] Access to WebSocket protocol specification
- [ ] Test environment for WebSocket functionality
- [ ] Performance benchmarking tools
- [ ] Understanding of inverse specification functionality (src/specification/inverse.ts)

## Phase 1: Create New Components ✅
**Location**: `src/ws/protocol-router.ts`, `src/ws/control-frame-handler.ts`

### 1.1 Protocol Router Implementation
**Files**: `src/ws/protocol-router.ts`

**Required Steps**:
- [ ] Create `ProtocolMessage` interface
- [ ] Create `ControlFrame` interface
- [ ] Implement `WebSocketMessageRouter` class
- [ ] Add message routing logic
- [ ] Add control frame parsing methods
- [ ] Write comprehensive unit tests

### 1.2 Control Frame Handler Implementation
**Files**: `src/ws/control-frame-handler.ts`

**Required Steps**:
- [ ] Create `ControlFrameHandler` class
- [ ] Implement BOOK command handling
- [ ] Implement ERR command handling
- [ ] Implement SUB/UNSUB command handling
- [ ] Add bookmark management logic
- [ ] Write unit tests for each command type

### 1.3 Type Definitions
**Files**: `src/ws/types.ts`

**Required Changes**:
- [ ] Define `ProtocolMessage` interface
- [ ] Define `ControlFrame` interface
- [ ] Define command type enums
- [ ] Add JSDoc documentation

## Phase 2: Refactor WebSocket Client 🔄
**Location**: `src/ws/ws-graph-client.ts`

### 2.1 Integrate Protocol Router
**Files**: `src/ws/ws-graph-client.ts`

**Required Steps**:
- [ ] Add protocol router dependency
- [ ] Replace direct buffer handling with router
- [ ] Update message processing flow
- [ ] Maintain backward compatibility
- [ ] Update constructor parameters

### 2.2 Separate Graph Buffer
**Files**: `src/ws/ws-graph-client.ts`

**Required Changes**:
- [ ] Create dedicated graph data buffer
- [ ] Implement `readGraphLine()` method
- [ ] Update `startGraphReader()` method
- [ ] Add graph buffer processing logic
- [ ] Ensure proper buffer management

### 2.3 Update Socket Event Handling
**Files**: `src/ws/ws-graph-client.ts`

**Required Steps**:
- [ ] Modify `socket.onmessage` handler
- [ ] Route messages through protocol router
- [ ] Update error handling
- [ ] Maintain reconnection logic
- [ ] Update connection state management

## Phase 3: Clean Up HTTP Deserializer ❌
**Location**: `src/http/deserializer.ts`

### 3.1 Remove Protocol Commands
**Files**: `src/http/deserializer.ts`

**Required Changes**:
- [ ] Remove WebSocket command detection
- [ ] Remove protocol command filtering
- [ ] Restore original parsing logic
- [ ] Update method documentation
- [ ] Ensure HTTP-only functionality

### 3.2 Update Tests
**Files**: `test/http/deserializerSpec.ts`

**Required Steps**:
- [ ] Verify HTTP deserializer tests pass
- [ ] Remove any WebSocket-specific test cases
- [ ] Add tests for pure HTTP functionality
- [ ] Update test documentation

### 3.3 Documentation Updates
**Files**: `src/http/deserializer.ts`

**Required Changes**:
- [ ] Update class documentation
- [ ] Remove WebSocket references
- [ ] Clarify HTTP-only purpose
- [ ] Update usage examples

## Phase 4: Validation and Optimization ❌
**Location**: Various test files and performance monitoring

### 4.1 Performance Testing
**Files**: `test/ws/performance/`

**Required Steps**:
- [ ] Create performance benchmarks
- [ ] Measure message processing speed
- [ ] Compare old vs new implementation
- [ ] Optimize bottlenecks
- [ ] Document performance characteristics

### 4.2 Integration Testing
**Files**: `test/ws/graphWebSocketSpec.ts`

**Required Changes**:
- [ ] Update existing WebSocket tests
- [ ] Add new protocol command tests
- [ ] Test error handling scenarios
- [ ] Verify bookmark functionality
- [ ] Test reconnection behavior

### 4.3 Integration Testing with Authorization
**Files**: `test/ws/authorization-integration-spec.ts`

**Required Steps**:
- [ ] Test protocol router with authorization context
- [ ] Verify bookmark management works with authorization
- [ ] Test error handling with authorization errors
- [ ] Verify reconnection behavior with authorization

### 4.4 Code Review and Cleanup
**Files**: All modified files

**Required Steps**:
- [ ] Conduct comprehensive code review
- [ ] Remove unused code
- [ ] Optimize memory usage
- [ ] Add missing documentation
- [ ] Ensure consistent coding style

## Phase 5: Authorization Integration Preparation ❌
**Location**: `src/ws/ws-graph-client.ts`

### 5.1 Prepare for Authorization Integration
**Files**: `src/ws/ws-graph-client.ts`

**Required Steps**:
- [ ] Add authorization context support to protocol router
- [ ] Prepare bookmark management for authorization integration
- [ ] Add user identity support to WebSocket client
- [ ] Update type definitions for authorization context

### 5.2 Coordinate with Authorization Integration Plan
**Files**: `src/ws/types.ts`

**Required Changes**:
- [ ] Add authorization context types
- [ ] Add user identity types
- [ ] Update protocol message types for authorization
- [ ] Ensure compatibility with Authorization Integration Plan

## Success Criteria
- [ ] All WebSocket protocol commands handled correctly
- [ ] HTTP deserializer no longer contains WebSocket code
- [ ] Performance matches or exceeds current implementation
- [ ] All existing tests pass without modification
- [ ] New architecture supports protocol evolution
- [ ] Clear separation of concerns achieved
- [ ] Comprehensive test coverage for new components
- [ ] Ready for Authorization Integration Plan integration

## Risk Mitigation

### Technical Risks
- **Complexity Increase**: New architecture adds complexity
  - *Mitigation*: Incremental implementation with thorough testing
- **Performance Impact**: Additional parsing overhead
  - *Mitigation*: Performance benchmarking and optimization
- **Memory Usage**: Multiple buffers instead of single buffer
  - *Mitigation*: Memory profiling and buffer optimization
- **Naming Conflicts**: Router vs Handler terminology
  - *Mitigation*: Use distinct naming (MessageRouter vs AuthHandler)

### Integration Risks
- **Protocol Refactoring Dependencies**: Authorization integration depends on protocol refactoring
  - *Mitigation*: Sequential implementation with clear handoff points
- **Component Coordination**: Bookmark management overlap
  - *Mitigation*: Single BookmarkManager shared by both plans

### Rollback Strategy
- [ ] Keep current implementation as fallback
- [ ] Feature flag to switch between implementations
- [ ] Comprehensive testing before production deployment
- [ ] Monitoring and alerting for performance regressions

## Dependencies
- [ ] WebSocket protocol specification finalized
- [ ] Team review of architecture design
- [ ] Performance requirements defined
- [ ] Testing environment prepared
- [ ] Monitoring tools configured
- [ ] Authorization Integration Plan coordination

## Inter-Plan Dependencies
- [ ] Protocol Refactoring Plan Phase 1-4 must complete before Authorization Integration Plan Phase 2-5
- [ ] Both plans share bookmark management - coordinate implementation
- [ ] Both plans affect WebSocket client - coordinate testing

## Notes

### Architecture Decisions
- **Protocol Router Pattern**: Chosen for clear separation of concerns
- **Dedicated Control Handler**: Provides extensibility for new commands
- **Backward Compatibility**: Maintains existing WebSocket client interface
- **Authorization Preparation**: Protocol refactoring prepares for authorization integration

### Performance Considerations
- Protocol routing adds minimal overhead
- Separate buffers may increase memory usage
- Parallel processing potential for future optimization

### Testing Strategy
- Unit tests for each new component
- Integration tests for WebSocket functionality
- Performance benchmarks for regression detection
- Protocol command testing for all supported commands
- Authorization integration testing

### Future Extensibility
- Easy to add new WebSocket commands
- Support for other protocols (gRPC, etc.)
- Potential for protocol versioning
- Framework for message type routing
- Authorization context support
