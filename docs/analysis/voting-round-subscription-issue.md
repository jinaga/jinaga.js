# Voting Round Subscription Issue Analysis

## Overview
This document describes a real-world subscription callback failure that occurred in the launchkings-admin application when adding nested specifications to the projection structure.

## The Application Context

**Application**: LaunchKings Admin Dashboard  
**File**: `/Users/michaelperry/projects/Improving/codelaunch/launchkings/app/launchkings-admin/src/events/useEventVotes.ts`  
**Storage**: IndexedDB (via `src/indexeddb/indexeddb-store.ts`)

### The Fact Model

```
VotingRound (given)
  └── Vote (nested specification)
```

The application tracks votes within voting rounds for launch events.

## The Problem

### Original Code Pattern (Workaround Required)

```typescript
// First useEffect: Create the voting round
useEffect(() => {
  const createVotingRound = async () => {
    const round = await j.fact(new VotingRound(event, new Date()));
    setVotingRound(round);
  };
  createVotingRound();
}, [event]);

// Second useEffect: Subscribe ONLY after voting round is created
useEffect(() => {
  if (!votingRound) return;  // Wait for persistence
  
  const observer = j.subscribe(voteSpec, votingRound, (result) => {
    // This callback should fire when votes arrive
    console.log('Vote received:', result);
  });
  
  return () => observer.stop();
}, [votingRound]);  // Depends on votingRound being persisted
```

### The Anomaly

**Observed Behavior**:
- Specification and given passed to subscribe match facts on replicator
- Facts observed being sent to client via long-polling connection
- **Subscription callback was NEVER invoked**
- No errors thrown
- Application appears to work but UI doesn't update

### What Changed

**Before (Working)**:
- Specification had flat projection (no nested specifications)
- Callback fired reliably when facts arrived

**After (Broken)**:
- Added nested specification to projection to show votes within rounds
- Callback stopped firing entirely
- Not even the root callback was invoked

### The Workaround

The code explicitly **separates voting round creation from subscription** to ensure:
1. VotingRound fact is created and persisted to IndexedDB
2. IndexedDB transaction completes and indexes are built
3. ONLY THEN does subscription begin

**This workaround should not be necessary** - the system should handle given facts arriving at any time.

## Root Cause Analysis

### The Failure Mechanism

Even with the workaround ensuring `votingRound` is persisted before subscribing, a race condition exists:

1. **T1**: `votingRound` persisted to IndexedDB
2. **T2**: useEffect triggers, `j.subscribe()` called
3. **T3**: `ObserverImpl.start()` begins initialization
4. **T4**: `read()` executes query against IndexedDB
5. **[RACE WINDOW]**: IndexedDB may not have completed indexing edges/ancestors for complex nested queries
6. **T5**: Query returns empty or incomplete results
7. **T6**: `notifyAdded()` called with empty results
8. **T7**: Root callback never invoked (no results to process)
9. **T8**: VotingRound facts arrive via long-polling
10. **T9**: No self-inverse listener exists to trigger re-read
11. **T10**: System stuck in failed state - callback never fires

### Why Nested Specifications Triggered It

**Flat Specification**:
- Simple query structure
- Fewer IndexedDB index lookups
- Fast execution
- Completes before race window
- Works reliably ✅

**Nested Specification**:
- Complex query with nested joins
- Multiple edge index lookups required
- Slower execution
- Hits the race window
- Fails silently ❌

## Missing Self-Inverse Mechanism

### What Was Removed

Prior to commit 85cf396, Jinaga had "self-inverse" functionality that would:
1. Detect when a specification needed to react to its own given fact arrival
2. Create an inverse specification listening for the given fact type
3. When given fact was saved, trigger re-execution of the full specification
4. Ensure callbacks eventually fire even if initial read failed

### Why It Would Have Solved This

With self-inverse, the timeline would be:

1. **T1-T7**: Same as above (initial read might fail)
2. **T8**: VotingRound saved/arrives
3. **T9**: **Self-inverse listener fires** ← This is the key difference
4. **T10**: **Re-executes `read()` with now-available fact**
5. **T11**: **Query succeeds, callback invoked** ✅

### Why Workaround Is Inadequate

The workaround helps but doesn't fully solve the issue because:
- IndexedDB indexing is asynchronous
- Complex nested queries need more time to complete
- Race window still exists between persistence and query
- Without self-inverse, no recovery if initial query fails

## Impact Assessment

### Severity
**HIGH** - Application appears to work but critical callbacks don't fire, causing:
- UI doesn't update with new data
- Silent failures (no errors thrown)
- User confusion (data exists but doesn't display)
- Requires workarounds that complicate code

### Scope
Affects any application that:
- Uses `subscribe()` or `watch()` with nested specifications
- Has async timing between fact creation and subscription
- Depends on callbacks firing when facts arrive
- Uses complex specifications with multiple joins

### Regression Timeline
- **Before nested specs**: Worked reliably with flat projections
- **After adding nested specs**: Callback failures began
- **Current state**: Workarounds required for reliable operation

## Related Documentation

- [Self-Inverse History](./self-inverse-history.md) - Details of previous implementation
- [Nested Subscription Test Suite](../../test/specification/nestedSubscriptionSpec.ts) - 33 tests documenting race conditions
- [Implementation Plan](../plans/SELF_INVERSE_RESTORATION_PLAN.md) - TDD plan to restore functionality

## Conclusion

The voting round subscription issue demonstrates a critical gap in Jinaga's reactive specification system. When self-inverse was removed to address infinite loop issues, it created a regression where subscriptions with complex nested specifications can fail permanently if their initial read doesn't succeed. Restoring self-inverse functionality with proper safeguards against infinite loops is necessary to eliminate the need for workarounds and ensure reliable callback invocation.