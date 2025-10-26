# Self-Inverse Implementation History

## Overview
This document describes the self-inverse functionality that existed in Jinaga's inverse specification system prior to commit 85cf396, why it was removed, and the implications of that removal.

## What Was Self-Inverse?

### Purpose
Self-inverse was a mechanism that allowed specifications to be reactive to their own **given facts** being added to the system, not just to result facts.

### The Problem It Solved

In normal inverse specification generation:
- Observers listen for **result types** to be added (e.g., Office, Manager, President)
- They do NOT listen for **given types** to be added (e.g., Company when it's the given)
- If a given fact arrives after subscription, no mechanism triggers re-evaluation

**Example Problem Scenario:**

```typescript
const spec = model.given(Office).match((office, facts) =>
    office.company.predecessor().selectMany(company =>
        facts.ofType(President)
            .join(president => president.office.company, company)
            .select(president => Jinaga.hash(president))
    )
);

// Watch for presidents
const observer = j.watch(spec, office, callback);

// If 'office' is added AFTER the watch is established,
// the callback won't trigger because there's no inverse
// listener for Office type arrival
```

### How Self-Inverse Worked

#### 1. Detection Logic

The system detected when a specification needed self-inverse by checking:
- Exactly one given fact
- First operation involves predecessor navigation (moving from given to its predecessors)
- Specification has multiple matches (indicating `selectMany` pattern)

From the test context provided:
```typescript
// Detection logic identified patterns like:
// - office.company.predecessor().selectMany(...)
// - Specifications starting with .predecessor() that then branch out
```

#### 2. Self-Inverse Creation

When conditions were met, the system created a special inverse:

```typescript
const selfInverse: SpecificationInverse = {
    inverseSpecification: specification,  // Original specification, not inverted
    operation: "add",                     // Trigger on addition
    givenSubset: [givenName],            // The given fact's label name
    parentSubset: [givenName],           // Same as given
    path: "",                            // Root path (not nested)
    resultSubset: []                     // Empty - this IS the root
};
```

Key characteristics:
- `inverseSpecification` was the **original specification**, not truly inverted
- When given fact was saved, this inverse would trigger
- Would execute the **full original specification** from the newly arrived given
- Ensured results were found and callback invoked

#### 3. Reactive Behavior

When given fact arrived:
1. `ObservableSource.notifyFactSaved(givenFact)` fired
2. Self-inverse listener matched (listening for given type)
3. Triggered `onResult()` with the given fact as starting point
4. Re-executed full specification query
5. Found matching results and invoked callback

## Why It Was Removed

### Commit 85cf396 Removal

The self-inverse functionality was removed due to several issues:

### 1. Infinite Loop Problems

**The Issue**: In complex specification structures, self-inverse generation could create infinite loops during the inversion process.

**Evidence**: Test file `test/specification/infiniteLoopSpec.ts` was created to document and prevent infinite loop issues:

```typescript
// Test case showing disconnected specification that caused infinite loop
const specification: Specification = {
    given: [{ label: { name: "p1", type: "User" }, conditions: [] }],
    matches: [
        { unknown: { name: "u1", type: "GameChallenge" }, conditions: [...] },
        { unknown: { name: "u2", type: "GameHub" }, conditions: [] },
        { unknown: { name: "u3", type: "Player" }, conditions: [] },
        // Complex interconnected matches...
    ],
    projection: { type: "composite", components: [] }
};

// This would cause infinite loop in shakeTree() or inversion logic
```

**Root Cause**: The `shakeTree()` function in `src/specification/inverse.ts` (lines 85-129) could enter infinite loops when:
- Matches had circular dependencies
- Labels weren't properly connected to the graph
- Self-inverse added another layer of complexity to an already complex inversion process

### 2. Complexity and Maintainability

**The Problem**: Self-inverse added 47+ lines of complex code to the inverse generation process:
- Detection logic was subtle and hard to reason about
- Required special casing in multiple places
- Interacted with shakeTree in non-obvious ways
- Made the inversion process harder to debug

### 3. Disconnected Specification Detection

The removal coincided with improvements to disconnected specification detection (`src/specification/UnionFind.ts`). The team likely decided that:
- Disconnected specs should be rejected outright
- Self-inverse was trying to paper over deeper structural issues
- Better to fail fast than create complex workarounds

### 4. Experimental Status

Comments in tests suggested self-inverse was experimental:
```typescript
// With broader self-inverse coverage, specifications that reference givens get self-inverses
```

This indicates it was:
- Being iteratively refined
- Not fully baked
- Causing maintenance burden relative to benefit

## The Regression

### What Was Lost

Removing self-inverse eliminated the ability for subscriptions to:
1. **React to given fact arrivals** - If given added after subscription, no callback
2. **Recover from failed initial reads** - If initial query returns empty, no retry mechanism
3. **Handle async persistence timing** - No way to re-query after data fully synchronized

### When It Manifests

The regression appears when:
1. **Given fact not yet persisted** when subscription starts
2. **IndexedDB still indexing** when initial read executes
3. **Complex nested specifications** that are timing-sensitive
4. **Async operations** creating windows between persist and query

### Real-World Impact

**LaunchKings Admin Example**:
- Added nested specification to show votes within rounds
- Initial read failed due to IndexedDB timing
- No self-inverse to retry when round arrived
- Callback never invoked
- **Required workaround**: Two-stage useEffect to ensure persistence before subscribe

This pattern is now **required in all applications** using:
- Nested specifications
- Dynamic given facts
- Subscribe/watch with facts that might arrive asynchronously

## Technical Deep Dive

### The Detection Logic (How It Worked)

The self-inverse detection looked for specific patterns:

```typescript
// Pattern 1: Predecessor navigation at start
office.company.predecessor()

// Pattern 2: SelectMany after predecessor
.selectMany(company => ...)

// Pattern 3: Single given fact
model.given(Office)  // Not model.given(Office, User)
```

When ALL conditions met:
- Create self-inverse listening for given type (Office)
- When Office saved, trigger full specification execution
- Ensure reactive behavior even when given arrives late

### The Infinite Loop Problem (Why It Failed)

**Scenario that caused loops**:

```typescript
// Specification with circular dependencies
const spec = {
    given: [User],
    matches: [
        { u1: GameChallenge, conditions: [{ path to u2 }] },
        { u2: GameHub, conditions: [] },  // No path - causes shake tree to loop
        { u3: Player, conditions: [] },
        { u4: GameSession, conditions: [{ path to u2 }] },
        // u2 has no path conditions but u1 and u4 reference it
    ]
};
```

In `shakeTree()`:
1. Try to move match for given to front
2. Invert path conditions and move them
3. Move matches with no paths down
4. **Loop detected**: Match returns to original position
5. Throw error: "Labels not connected to the rest of the graph"

**Self-inverse made this worse by**:
- Adding another inversion layer
- Creating self-referential specs
- Complicating the shakeTree logic

### The Fix-Removal Tradeoff

**Removed** (to fix):
- Self-inverse complexity
- Infinite loop potential
- Maintenance burden

**Lost** (regression):
- Reactive given fact handling
- Recovery from failed reads
- Natural async fact handling

## Current State Without Self-Inverse

### Limitations

Applications must now:
1. **Ensure given facts exist** before subscribing
2. **Use workarounds** like two-stage useEffect patterns
3. **Handle timing manually** instead of relying on reactive system
4. **Accept callback failures** in certain async scenarios

### Affected Patterns

**Broken Patterns**:
```typescript
// This DOESN'T work reliably:
const round = new VotingRound(event, new Date());
const observer = j.subscribe(spec, round, callback);
await j.fact(round);  // Too late - subscription already started
```

**Required Workaround**:
```typescript
// This works but is awkward:
const round = await j.fact(new VotingRound(event, new Date()));
await new Promise(resolve => setTimeout(resolve, 100)); // Wait for indexing
const observer = j.subscribe(spec, round, callback);
```

## Path Forward

### Restoration Goals

A careful restoration of self-inverse should:
1. **Fix the regression** - Make callbacks fire when given arrives late
2. **Avoid infinite loops** - Use safer detection logic
3. **Minimal scope** - Support simple cases, reject complex ones
4. **Clear failure modes** - Fail fast on unsupported patterns

### Safe Subset to Support

**Support self-inverse for**:
- Single given fact specifications
- Any projection structure (including nested)
- Where given fact is a concrete type (not complex pattern)

**Do NOT support**:
- Multiple given facts
- Given facts with complex conditions
- Patterns that previously caused infinite loops
- Disconnected specifications

### Testing Requirements

Must verify:
- Voting round scenario works without workarounds
- No infinite loops in complex cases
- Performance acceptable (< 10ms overhead)
- Existing tests still pass
- Clear error messages for unsupported patterns

## References

- **Implementation Plan**: `docs/plans/SELF_INVERSE_RESTORATION_PLAN.md`
- **Test Suite**: `test/specification/nestedSubscriptionSpec.ts` - 33 tests documenting race conditions
- **Infinite Loop Prevention**: `test/specification/infiniteLoopSpec.ts` - Guards against regression
- **Inverse Logic**: `src/specification/inverse.ts` - Core inversion implementation
- **Observer Logic**: `src/observer/observer.ts` - Where self-inverse listeners would register