# GitHub Issue #149: Feed Endpoint Race Condition Fix

## Problem Analysis

### Core Issue
The jinaga-server currently has a race condition in the feed endpoint when clients request feeds with starting facts that don't exist yet. Instead of gracefully handling missing starting facts, the server returns a 403 Forbidden error, which interrupts the persistent connection setup.

### Current Behavior
1. Client makes a feed request with a starting fact reference
2. If the starting fact doesn't exist in the database, the authorization layer treats this as an authorization failure
3. Server returns 403 Forbidden, breaking the persistent connection
4. Client cannot distinguish between actual authorization failures and missing starting facts

### Expected Behavior
1. Client makes a feed request with a starting fact reference
2. If the starting fact doesn't exist, server should return an empty result set immediately
3. Server maintains the persistent connection via server-sent events
4. When the starting fact arrives, server begins streaming actual results
5. Server continues streaming as new facts are added

## Test-First Approach

### Test Model Design
We will use a simple project management model that avoids mocks and relies on production code:

```typescript
class Project {
    static Type = 'Test.Project' as const;
    type = Project.Type;
    
    constructor(
        public readonly creator: User,
        public readonly identifier: string
    ) {}
}

class Reader {
    static Type = 'Test.Reader' as const;
    type = Reader.Type;
    
    constructor(
        public readonly project: Project,
        public readonly user: User,
        public readonly createdAt: Date | string
    ) {}
}

class Task {
    static Type = 'Test.Task' as const;
    type = Task.Type;
    
    constructor(
        public readonly project: Project,
        public readonly createdAt: Date | string
    ) {}
}
```

### Test Environment Setup
- Use in-memory database for fast, isolated tests
- Initialize server with a project and three tasks
- Create test users for different scenarios
- Set up feed specifications that query for tasks based on Reader facts

## Test Scenarios

### Scenario 1: Reader Exists Before Subscription
**Setup:**
1. Initialize server with in-memory database
2. Create a project with identifier "test-project"
3. Create three tasks for the project
4. Create a Reader fact for a new user linking to the project

**Test Steps:**
1. Subscribe to specification: "All tasks for projects where user has Reader access"
2. **Expected:** Subscription returns three tasks immediately
3. Add a new task to the project
4. **Expected:** Subscription streams the new task

**Specification Example:**
```
reader: Reader
task: Task
where task.project = reader.project
```

### Scenario 2: Reader Created After Subscription
**Setup:**
1. Initialize server with in-memory database
2. Create a project with identifier "test-project"
3. Create three tasks for the project
4. Do NOT create Reader fact initially

**Test Steps:**
1. Subscribe to specification: "All tasks for projects where user has Reader access"
2. **Expected:** Subscription returns empty result set (no Reader exists)
3. Create Reader fact for the user
4. **Expected:** Subscription streams all three existing tasks
5. Add a new task to the project
6. **Expected:** Subscription streams the new task

### Scenario 3: No Authorization Failures for Feed Requests
**Setup:**
1. Initialize server with proper authorization rules
2. Create project and tasks for User A
3. Create Reader fact for User A only

**Test Steps:**
1. User B subscribes to same specification (lacks Reader fact)
2. **Expected:** Empty result set (no Reader fact means no authorized results)
3. User B subscribes with completely non-existent starting fact
4. **Expected:** Empty result set (same behavior - no facts means no results)

**Key Insight:** After this fix, the server will never respond with a Forbidden error to feed requests. All authorization "failures" are treated as "no matching facts" and return empty collections.

## Implementation Strategy

### 1. Current Code Analysis
**Key Areas to Examine:**
- [`HttpRouter.feed()`](src/http/router.ts:517-544) - Main feed endpoint
- [`HttpRouter.streamFeed()`](src/http/router.ts:546-654) - Streaming implementation
- [`AuthorizationKeystore.feed()`](src/authorization/authorization-keystore.ts:72-95) - Authorization logic
- [`handleError()`](src/http/router.ts:925-941) - Error handling

**Current Error Flow:**
1. Feed request comes in with starting fact references
2. Authorization layer tries to validate distribution permissions
3. If starting fact doesn't exist, distribution engine fails
4. Throws `Forbidden` exception
5. `handleError()` converts to 403 response

### 2. New Authorization Strategy
**Fundamental Change:**
Feed requests should NEVER return authorization errors. Instead, missing facts (whether starting facts or authorization facts) should result in empty result sets.

**Implementation Approach:**
1. Modify authorization layer to treat missing starting facts as "no results" rather than "forbidden"
2. Change `AuthorizationKeystore.feed()` to catch missing fact scenarios
3. Return empty `FactFeed` instead of throwing `Forbidden` exceptions
4. Maintain streaming connections even with empty initial results

**Implementation Points:**
- Modify `AuthorizationKeystore.feed()` to handle missing starting facts gracefully
- Update distribution engine error handling to return empty results
- Ensure streaming setup works with empty initial results
- Remove `Forbidden` exceptions from feed request paths

### 3. Streaming Behavior Modifications
**Current Streaming Flow:**
1. Get initial results via `streamAllInitialResults()`
2. Set up real-time listeners via `invertSpecification()`
3. Stream updates as they arrive

**Modified Flow for Missing Starting Facts:**
1. Check if starting facts exist
2. If missing: Return empty initial result, but still set up listeners
3. When starting facts arrive via listeners, begin streaming actual results
4. Continue normal streaming behavior

### 4. Error Handling Updates
**Current Error Types:**
- `Forbidden` (403) - Authorization failures
- `Invalid` (400) - Validation errors

**New Error Handling:**
- Feed requests never throw `Forbidden` - always return empty results for missing facts
- Invalid specifications (malformed queries) should still return 400
- Only non-feed endpoints should return 403 for actual authorization failures
- Streaming connections should always be established, even with empty initial results

## Expected Outcomes

### Test Success Criteria

**Scenario 1 Success:**
- Initial subscription returns 3 tasks immediately
- New task addition streams 1 additional task
- No errors or connection interruptions

**Scenario 2 Success:**
- Initial subscription returns empty result set (not error)
- Reader creation triggers streaming of 3 existing tasks
- New task addition streams 1 additional task
- Connection remains stable throughout

**Overall Success:**
- No 403 errors for any feed requests (missing facts return empty results)
- Persistent connections work reliably in all scenarios
- Feed requests never fail due to authorization - only return empty results
- Streaming behavior works correctly when facts arrive later

### Performance Considerations
- Fact existence checks should be efficient (indexed lookups)
- Streaming setup should not be significantly slower
- Memory usage should remain reasonable for persistent connections

### Backward Compatibility
- Existing clients should continue to work (empty results instead of errors)
- Non-feed endpoints maintain existing authorization behavior
- API contract improved (more predictable feed behavior)
- Clients can rely on feed requests never failing with 403 errors

## Implementation Phases

### Phase 1: Test Infrastructure
1. Create test model (Project/Reader/Task)
2. Set up in-memory database test environment
3. Create helper functions for test data setup

### Phase 2: Test Implementation
1. Implement Scenario 1 test
2. Implement Scenario 2 test
3. Verify tests fail with current implementation

### Phase 3: Core Fix
1. Add starting fact existence validation
2. Modify feed endpoints to handle missing facts gracefully
3. Update authorization layer error handling

### Phase 4: Streaming Enhancements
1. Ensure streaming works with missing starting facts
2. Test real-time updates when starting facts arrive
3. Verify connection stability

### Phase 5: Validation & Documentation
1. Run comprehensive tests
2. Verify backward compatibility
3. Update API documentation
4. Add troubleshooting guide

## Risk Mitigation

### Potential Issues
1. **Performance Impact:** Fact existence checks could slow down requests
   - *Mitigation:* Use efficient database queries with proper indexing
   
2. **Race Conditions:** Starting facts might arrive during validation
   - *Mitigation:* Use consistent read isolation levels
   
3. **Memory Leaks:** Persistent connections with missing facts
   - *Mitigation:* Implement proper connection cleanup and timeouts

4. **Security Concerns:** Always returning empty results might seem like bypassing security
   - *Mitigation:* This is actually more secure - no information leakage about what facts exist

### Testing Strategy
- Unit tests for individual components
- Integration tests for end-to-end scenarios
- Performance tests for high-load situations
- Security tests to ensure no authorization bypass

## Success Metrics

1. **Functional:** All test scenarios pass consistently
2. **Performance:** No significant degradation in feed response times
3. **Reliability:** Persistent connections remain stable with missing starting facts
4. **Security:** Feed requests provide no information about unauthorized facts (empty results)
5. **Usability:** Clear distinction between different types of errors

This plan provides a comprehensive approach to fixing the race condition while maintaining system reliability and security.