# Self-Inverse Restoration Implementation Plan

## Overview
Restore self-inverse functionality to fix subscription callback failures when given facts arrive after subscription initialization, particularly for specifications with nested projections. This addresses a regression where removing self-inverse logic broke reactive subscriptions that depend on given facts being added dynamically.

## Background Documentation

**Critical Context**:
- [Voting Round Subscription Issue](../analysis/voting-round-subscription-issue.md) - Real-world case from launchkings-admin application demonstrating the problem
- [Self-Inverse History](../analysis/self-inverse-history.md) - Detailed history of previous implementation, why it was removed, and what was lost

**These documents provide essential context for understanding**:
- Why this restoration is necessary
- What workarounds are currently required in production
- What infinite loop issues to avoid
- How self-inverse previously worked

## Progress Summary
- ❌ **Phase 1: Failing Test Creation** - PENDING
- ❌ **Phase 2: Self-Inverse Core Restoration** - PENDING
- ❌ **Phase 3: Integration and Validation** - PENDING

**Current Status**: Analysis complete. Comprehensive logging and test suite created documenting the issue. Ready to begin TDD implementation.

## Prerequisites
- [x] Root cause analysis completed
- [x] Comprehensive logging added to observer, observable, and inverse modules
- [x] 33 test cases created documenting race conditions and edge cases
- [x] User confirmed votingRound workaround required (ensuring persistence before subscribe)
- [ ] Review previous self-inverse implementation in git history (commit before 85cf396)
- [ ] Understand infinite loop issues that led to removal
- [ ] Identify safe subset of self-inverse scenarios to support

## Phase 1: Failing Test Creation (TDD Red) ❌

### 1.1 Create Voting Round Scenario Test
**Location**: `test/specification/selfInverseSpec.ts`

**Required Steps**:
- [ ] Create new test file for self-inverse behavior
- [ ] Model the voting round scenario from launchkings-admin application
- [ ] Create VotingRound, Vote, and related fact types
- [ ] Implement test that simulates natural usage without workarounds

### 1.2 Test Scenario Definition
**Test**: "should invoke callback when given fact arrives after subscription"

**Scenario Steps**:
- [ ] Start with empty storage (no VotingRound persisted yet)
- [ ] Create VotingRound instance but don't persist
- [ ] Call j.subscribe(voteSpec, votingRound, callback) immediately
- [ ] Then persist VotingRound via j.fact(votingRound)
- [ ] VotingRound arrives via notification system
- [ ] Assert callback IS invoked with vote results

**Without Fix**: Test fails - callback never invoked
**With Fix**: Test passes - callback invoked when given arrives

### 1.3 Additional Edge Case Tests
**Location**: `test/specification/selfInverseSpec.ts`

**Required Steps**:
- [ ] Test with flat specification (no nested projections)
- [ ] Test with nested specification (Office → Manager pattern)
- [ ] Test with multiple given facts arriving out of order
- [ ] Test with given arriving via long-polling vs local save
- [ ] Test that infinite loops don't occur (regression prevention)

### 1.4 Acceptance Criteria

**Functional Requirements**:
- [ ] Failing test clearly demonstrates callback not invoked when given arrives late
- [ ] Test uses realistic fact model (VotingRound/Vote or Company/Office/Manager)
- [ ] Test does NOT include workarounds (no pre-persistence of given)
- [ ] Test asserts expected (correct) behavior, not anomalous behavior
- [ ] Test includes detailed logging showing when given arrives vs when callback should fire

**Testing Approach**:
- [ ] Run test suite, confirm new tests fail with clear error messages
- [ ] Verify failure mode matches production issue (callback not invoked)
- [ ] Document expected vs actual behavior in test comments
- [ ] Ensure tests will pass once self-inverse is implemented

## Phase 2: Self-Inverse Core Restoration (TDD Green) ❌

### 2.1 Analyze Previous Implementation
**Location**: Review git history before commit 85cf396

**Required Steps**:
- [ ] Examine previous self-inverse detection logic
- [ ] Identify what scenarios required self-inverse
- [ ] Document why it was removed (infinite loop issues)
- [ ] Determine minimal safe subset to restore

### 2.2 Implement Self-Inverse Detection
**Location**: `src/specification/inverse.ts`

**Required Steps**:
- [ ] Add logic to detect when self-inverse is needed
- [ ] Focus on simple case: single given, any specification structure
- [ ] Avoid complex predecessor chain analysis that caused infinite loops
- [ ] Create self-inverse specification structure

### 2.3 Register Self-Inverse Listeners
**Location**: `src/observer/observer.ts`

**Required Steps**:
- [ ] Modify addSpecificationListeners() to include self-inverse
- [ ] Register listener for given fact type
- [ ] Implement re-read mechanism when given arrives
- [ ] Ensure no duplicate notifications
- [ ] Handle edge case where given already exists

### 2.4 Integration with Notification System
**Location**: `src/observable/observable.ts`

**Required Steps**:
- [ ] Ensure ObservableSource can handle given type listeners
- [ ] Verify notification flow works for self-inverse
- [ ] Add logging for self-inverse triggering
- [ ] Test with both MemoryStore and IndexedDBStore

### 2.5 Acceptance Criteria

**Functional Requirements**:
- [ ] Given: Subscription started with unpersisted given fact, When: Given fact is saved, Then: Root callback is invoked with matching results
- [ ] Given: Subscription with nested spec, When: Given arrives then child facts arrive, Then: Both root and nested callbacks fire
- [ ] Given: Complex specification structure, When: Self-inverse created, Then: No infinite loops occur during inversion
- [ ] Given: Multiple observers on same spec, When: Given arrives, Then: All observers receive notifications
- [ ] Given: Given fact already exists, When: Subscription starts, Then: No duplicate notifications occur

**Testing Approach**:
- [ ] All Phase 1 failing tests now pass
- [ ] Existing 23 passing tests remain passing (no regressions)
- [ ] Run full test suite: `npm test`
- [ ] Verify no infinite loop errors in inverse generation
- [ ] Test with both watch() and subscribe() APIs
- [ ] Manual validation: Test voting round scenario without workarounds

## Phase 3: Integration and Validation ❌

### 3.1 Integration Testing
**Location**: `test/specification/nestedSubscriptionSpec.ts`

**Required Steps**:
- [ ] Unskip all previously skipped race condition tests
- [ ] Verify they now pass with self-inverse
- [ ] Add tests for self-inverse specific scenarios
- [ ] Test interaction with existing observer lifecycle

### 3.2 Performance and Edge Cases
**Location**: Existing test files

**Required Steps**:
- [ ] Verify self-inverse doesn't create duplicate notifications
- [ ] Test memory usage with many observers
- [ ] Test cleanup when observer.stop() called
- [ ] Verify MRU date handling still works correctly
- [ ] Test with long-running subscriptions

### 3.3 Documentation
**Location**: `documentation/` and inline code comments

**Required Steps**:
- [ ] Document when self-inverse is created
- [ ] Explain re-read mechanism in observer.ts
- [ ] Update specification.md with self-inverse behavior
- [ ] Add examples of patterns that benefit from self-inverse
- [ ] Document any limitations or edge cases

### 3.4 Real Application Validation
**Location**: External application (launchkings-admin)

**Required Steps**:
- [ ] Remove votingRound pre-persistence workaround
- [ ] Test natural flow: create fact, subscribe, persist fact
- [ ] Verify callbacks fire correctly
- [ ] Test with complex nested specifications
- [ ] Monitor for any performance degradation

### 3.5 Acceptance Criteria

**Functional Requirements**:
- [ ] Given: VotingRound scenario without workarounds, When: Subscribe then persist, Then: Vote callbacks fire correctly
- [ ] Given: All 33 existing tests, When: Self-inverse implemented, Then: All tests pass
- [ ] Given: Complex nested spec, When: Given arrives late, Then: Full notification chain works (parent and all children)
- [ ] Given: Observer stopped, When: Given arrives, Then: No callbacks fire (cleanup works)
- [ ] Given: Production load, When: Multiple observers active, Then: Performance acceptable (< 10ms overhead per observer)

**Testing Approach**:
- [ ] Full test suite passes: `npm test` shows 0 failures
- [ ] All 10 previously skipped tests now passing
- [ ] Integration test with real IndexedDBStore
- [ ] Manual testing with launchkings-admin application
- [ ] Performance benchmark: Compare before/after observer creation time
- [ ] Memory leak test: Create/destroy 100 observers, verify cleanup
- [ ] Error handling: Test with invalid specifications, verify no crashes

## Success Criteria

**Overall Functional Requirements**:
- [ ] Root callback invoked when given fact persisted after subscription
- [ ] Nested specification callbacks work with late-arriving given facts
- [ ] No regressions in existing functionality
- [ ] No infinite loops during inverse generation
- [ ] Production applications work without persistence workarounds

**Overall Testing Requirements**:
- [ ] 100% of test suite passing (all 33+ tests)
- [ ] Zero skipped tests documenting bugs
- [ ] Real application validation successful
- [ ] Performance benchmarks met (< 10ms overhead)
- [ ] Documentation complete and accurate

**Rollback Criteria**:
If any of these occur, rollback and re-analyze:
- [ ] Infinite loops reappear in inverse generation
- [ ] Existing tests break (regression)
- [ ] Performance degrades by > 50ms per observer
- [ ] Memory leaks detected
- [ ] Specification description or inverse logic becomes unstable

## Implementation Notes

### Key Files to Modify
- `src/specification/inverse.ts` - Self-inverse detection and generation
- `src/observer/observer.ts` - Self-inverse listener registration and re-read mechanism
- `src/observable/observable.ts` - Potential changes to notification handling
- `test/specification/selfInverseSpec.ts` - New test file

### Critical Considerations
1. **Avoid Infinite Loops**: Previous removal was due to infinite loop issues - must carefully validate inverse generation
2. **Deduplication**: Self-inverse triggers re-read, must not duplicate notifications for facts already processed
3. **Lifecycle**: Ensure self-inverse listeners are cleaned up when observer.stop() called
4. **Performance**: Self-inverse adds overhead - benchmark to ensure acceptable
5. **Backward Compatibility**: Should not break existing applications using current patterns

### Testing Strategy
1. **Red**: Create failing tests first (Phase 1)
2. **Green**: Implement minimal solution to pass tests (Phase 2)
3. **Refactor**: Optimize and clean up (Phase 3)
4. **Validate**: Test in real application

### Success Metrics
- **Callback Invocation Rate**: 100% of subscriptions should receive callbacks when matching facts arrive
- **Test Pass Rate**: 100% of test suite passing
- **Performance**: < 10ms overhead per observer creation
- **Memory**: Zero leaks over 100 observer create/destroy cycles
- **Real World**: launchkings-admin works without workarounds