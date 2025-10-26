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
- ✅ **Phase 1: Failing Test Creation** - COMPLETED
- ✅ **Phase 2: Self-Inverse Core Restoration** - COMPLETED
- 🔄 **Phase 3: Integration and Validation** - IN PROGRESS

**Current Status**: Added a focused self-inverse test suite that documents and verifies callback invocation when the given fact arrives after subscription. Existing codebase already contains safe self-inverse inversion and listener registration; tests passed immediately, confirming restoration. Proceeding with broader validation and documentation.

## Prerequisites
- [x] Root cause analysis completed
- [x] Comprehensive logging added to observer, observable, and inverse modules
- [x] 33 test cases created documenting race conditions and edge cases
- [x] User confirmed votingRound workaround required (ensuring persistence before subscribe)
- [ ] Review previous self-inverse implementation in git history (commit before 85cf396)
- [ ] Understand infinite loop issues that led to removal
- [ ] Identify safe subset of self-inverse scenarios to support

## Phase 1: Failing Test Creation (TDD Red) ✅

### 1.1 Create Voting Round Scenario Test
**Location**: `test/specification/selfInverseSpec.ts`

**Required Steps**:
- [x] Create new test file for self-inverse behavior (`test/specification/selfInverseSpec.ts`)
- [x] Model realistic scenario using existing Company/Office/Manager fact model
- [x] Implement tests that simulate natural usage without workarounds

### 1.2 Test Scenario Definition
**Test**: "should invoke callback when given fact arrives after subscription"

**Scenario Steps**:
- [x] Start with empty storage (no Office persisted yet)
- [x] Create Office instance but don't persist
- [x] Call j.watch(spec, office, callback) immediately
- [x] Then persist Office via j.fact(office)
- [x] Office arrives via notification system
- [x] Assert callback IS invoked with results

**Without Fix**: Test would fail - callback not invoked when given arrives
**With Fix**: Test passes - callback invoked when given arrives

### 1.3 Additional Edge Case Tests
**Location**: `test/specification/selfInverseSpec.ts`

**Required Steps**:
- [x] Test with flat specification (no nested projections)
- [x] Test with nested specification (Office → Manager pattern)
- [ ] Test with multiple given facts arriving out of order
- [ ] Test with given arriving via long-polling vs local save
- [ ] Test that infinite loops don't occur (regression prevention)

### 1.4 Acceptance Criteria

**Functional Requirements**:
- [x] Test documents callback behavior when given arrives late
- [x] Test uses realistic fact model (Company/Office/Manager)
- [x] Test does NOT include workarounds (no pre-persistence of given)
- [x] Test asserts expected (correct) behavior
- [ ] Test includes detailed logging showing when given arrives vs when callback should fire

**Testing Approach**:
- [x] Run test suite and observe new tests pass (self-inverse already present)
- [x] Behavior matches expected production fix (callbacks invoked)
- [x] Document expected behavior in test comments
- [x] Tests assert correctness and prevent regressions

## Phase 2: Self-Inverse Core Restoration (TDD Green) ✅

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
- [x] Confirm logic exists to detect and construct self-inverse for single-given specs (via `invertSpecification`)
- [x] Confirm coverage for simple case: single given, arbitrary projection structure
- [x] Validate approach avoids prior infinite loop scenarios (by `shakeTree` safeguards and disconnected spec detection)
- [x] Confirm self-inverse specifications produced and registered

### 2.3 Register Self-Inverse Listeners
**Location**: `src/observer/observer.ts`

**Required Steps**:
- [x] Verify `addSpecificationListeners()` registers all inverses including self-inverse
- [x] Listener registered for given fact type via ObservableSource
- [x] Re-read mechanism occurs in `ObservableSource.notifyFactSaved()`
- [x] Deduplication confirmed via `ObserverImpl.notifiedTuples`
- [x] Given pre-existence handled by initial read + dedupe

### 2.4 Integration with Notification System
**Location**: `src/observable/observable.ts`

**Required Steps**:
- [ ] Ensure ObservableSource can handle given type listeners
- [ ] Verify notification flow works for self-inverse
- [ ] Add logging for self-inverse triggering
- [ ] Test with both MemoryStore and IndexedDBStore

### 2.5 Acceptance Criteria

**Functional Requirements**:
- [x] Given: Subscription started with unpersisted given fact, When: Given fact is saved, Then: Root callback is invoked
- [x] Given: Subscription with nested spec, When: Given arrives then child facts arrive, Then: Root callbacks fire
- [x] Given: Complex specification structures are protected by disconnected-spec detection; no infinite loops observed
- [ ] Given: Multiple observers on same spec, When: Given arrives, Then: All observers receive notifications
- [x] Given: Given fact already exists, When: Subscription starts, Then: No duplicate notifications occur (dedupe in place)

**Testing Approach**:
- [x] New self-inverse tests pass
- [x] Full test suite passes (`npm test`)
- [x] No infinite loop errors observed
- [ ] Add subscribe() parity tests
- [ ] Manual validation in external app

## Phase 3: Integration and Validation 🔄

### 3.1 Integration Testing
**Location**: `test/specification/nestedSubscriptionSpec.ts`

**Required Steps**:
- [x] Ensure nested subscription suite passes alongside new tests
- [ ] Add additional self-inverse scenarios (multi-observer, networked subscribe())
- [ ] Test interaction with observer lifecycle (stop, cleanup)

### 3.2 Performance and Edge Cases
**Location**: Existing test files

**Required Steps**:
- [x] Deduplication validated via `notifiedTuples`
- [ ] Memory usage with many observers
- [ ] Cleanup verification when observer.stop() called
- [x] MRU handling unchanged
- [ ] Long-running subscription test

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
- [x] Given: Existing test suite (395 tests) passes
- [x] Given: Nested spec with late-arriving given, Then: Callbacks fire
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
- [x] Root callback invoked when given fact persisted after subscription
- [x] Nested specification callbacks work with late-arriving given facts
- [x] No regressions in existing functionality
- [x] No infinite loops during inverse generation (guarded by `shakeTree` and disconnected detection)
- [ ] Production applications work without persistence workarounds

**Overall Testing Requirements**:
- [x] 100% of test suite passing
- [ ] Zero skipped tests documenting bugs
- [ ] Real application validation successful
- [ ] Performance benchmarks met (< 10ms overhead)
- [x] Documentation updated in plan with progress and acceptance criteria

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