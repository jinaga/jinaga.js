# Bug Analysis: Feed Builder Strips Inner Negative Existential Conditions

**Date:** 2026-03-30
**Area:** This repo: `src/specification/feed-builder.ts`; external/downstream server: `jinaga-server` — `feed-builder.js` / `specification-sql.ts`
**Symptom:** EventName facts not delivered to clients for events that have been deleted and restored

---

## Observed Symptom

An admin portal Events dropdown shows the raw fact hash prefix (e.g. `65bc55e`) instead of the event's human-readable name. The `App.Event.Name` fact exists in the database and the distribution rules authorize it, but it is never delivered to the client via feeds.

## Database State That Triggers the Bug

```
App.Event         N facts  — id: 00000000-0000-0000-0000-000000000001
App.Event.Name    N facts  — value: "Example event"  (EXISTS — not missing)
App.Event.Delete  2 facts  — deleted twice
App.Event.Restore 2 facts  — restored twice → event is currently active
```

The event is logically active (every delete has a matching restore), but its presence of any `EventDelete` facts triggers the bug.

---

## Root Cause

### The Specification

A representative specification uses `Event.in(tenant)`:

```typescript
static in(tenant: LabelOf<Tenant>) {
    return tenant.successors(Event, event => event.tenant)
        .notExists(event =>
            event.successors(EventDelete, d => d.event)
                .notExists(d =>
                    d.successors(EventRestore, r => r.eventDelete)
                )
        );
}
```

The full `!E` condition is:
```
!E { EventDelete [ u2->event = u1,  !E { EventRestore [ u3->eventDelete = u2 ] } ] }
```
Meaning: *no un-restored EventDelete exists for this event*.

### What `buildFeeds` Produces

`buildFeeds` calls `buildExistentialCondition` to create a simplified version of negative existential conditions for use in feed specifications. The relevant code:

```js
// feed-builder.ts — buildExistentialCondition()
for (const match of matches) {
    existentialCondition = {
        ...existentialCondition,
        matches: [...existentialCondition.matches, {
            ...match,
            conditions: match.conditions.filter(isPathCondition)  // strips ALL existential conditions
        }]
    };

    for (const innerExistentialCondition of match.conditions.filter(isExistentialCondition)) {
        if (innerExistentialCondition.exists) {
            // ✓ positive inner existentials are recursively included
        }
        // ✗ negative inner existentials (exists=false) are silently dropped
    }
}
```

The inner `!E{EventRestore}` condition has `exists=false` and is therefore **dropped**. The simplified condition produced is:

```
!E { EventDelete [ u2->event = u1 ] }
```
Meaning: *no EventDelete at all*.

### The Five Feeds for the Specification

`buildFeeds` produces these feeds:

| Feed | Purpose | Condition on Event |
|---|---|---|
| FeedA | Detect EventRestore arrivals | none (bare join) |
| FeedB | Detect EventDelete arrivals | none (bare join) |
| FeedC | Deliver Event facts | `!E{EventDelete}` ← simplified |
| FeedD | Detect EventName supersession | `!E{EventDelete}` ← inherited |
| FeedE | **Deliver EventName facts** | `!E{EventDelete}` ← **BUG** |

FeedE inherits FeedC's simplified condition via `addProjections(FeedC, ...)`. FeedE's SQL is therefore:

```sql
SELECT f_name.hash, sort(array[f_name.fact_id], 'desc') as bookmark
FROM fact f_tenant
JOIN edge e1 ON e1.predecessor_fact_id = f_tenant.fact_id AND e1.role_id = $event_tenant_role
JOIN fact f_event ON f_event.fact_id = e1.successor_fact_id
JOIN edge e2 ON e2.predecessor_fact_id = f_event.fact_id AND e2.role_id = $eventname_event_role
JOIN fact f_name ON f_name.fact_id = e2.successor_fact_id
WHERE f_tenant.fact_type_id = $tenant_type AND f_tenant.hash = $tenant_hash
AND NOT EXISTS (
    SELECT 1 FROM edge e_del
    WHERE e_del.predecessor_fact_id = f_event.fact_id
    AND e_del.role_id = $eventdelete_event_role
    -- ↑ checks for ANY EventDelete, not just un-restored ones
)
AND NOT EXISTS (
    SELECT 1 FROM edge e_prior
    WHERE e_prior.predecessor_fact_id = f_name.fact_id
    AND e_prior.role_id = $eventname_prior_role
)
AND sort(array[f_name.fact_id], 'desc') > $bookmark
ORDER BY bookmark ASC LIMIT 100
```

Because the event has `EventDelete` facts (regardless of `EventRestore`), the `NOT EXISTS (EventDelete)` clause is false, the event is excluded, and **the query returns zero rows**.

### Why the Listener Doesn't Rescue It

The observer also registers inverse specification listeners. When FeedA delivers `EventRestore` facts, the listener fires and calls `notifyAdded` — which reads EventName from the **local IndexedDB store**. Because FeedE never delivered EventName to the local store, the re-evaluation finds nothing, and names remain absent.

---

## Impact

Any event that has ever been deleted (even if subsequently restored) will have its name and other projection facts permanently withheld from all projection feeds. The event itself still appears (via FeedC — though FeedC has the same bug, so events with any EventDelete also don't appear there). This affects:

- `App.Event.Name` — event name not shown in nav dropdown
- `App.Event.Date` — event dates not shown
- Any other projected facts on events from similar specs

In the reproduction case the event was deleted and restored twice, confirming 100% reproduction.

---

## The Fix

In addMatches, when a negative existential condition is encountered, the negating feeds are produced by recursing into addMatches and pushed directly to specifications. The final feed in that set is a positive-parity (restoring) feed, but it is never extended with the parent specification’s projection components. addProjections is only called at the top level in buildFeeds, so any restoring feed produced inside the recursion exits without its projections attached.
Result: any fact type that is a projection on a restored entity — EventName, EventDate, etc. — is never delivered to clients for entities that have ever been deleted and restored.
Solution
Pass the projection components (and their unusedGivens) down into addMatches as parameters. At the point where negating specifications are produced, identify the final (positive-parity) feed and call addProjections on it before pushing to specifications. This mirrors exactly what buildFeeds does at the top level, but applied recursively at each level of negative existential nesting.
Recommended Tests
1. Basic delete/restore delivers projection facts
An entity deleted once and restored once should have its projection facts (e.g. EventName) delivered via feeds. Verify the feed set includes a tuple containing (tenant, event, delete, restore, name).
2. Double delete/restore delivers projection facts
The specific production scenario — deleted twice, restored twice. Same assertion: name facts must appear in a feed.
3. Unrestored delete suppresses projection facts
An entity deleted but not restored should not have projection facts delivered. Verify no feed contains the name in a tuple alongside the deleted event.
4. Never-deleted entity still delivers projection facts
Regression guard: the fix must not break the ordinary feed path. An entity with no deletes should still receive its projection facts via the ordinary feed.
5. Multiple projection components on a restored entity
Where the specification projects both EventName and EventDate, both should appear in restoring feeds. Guards against the fix working for only the first component.
6. Deeply nested restore (three levels)
A restore of a restore scenario, verifying that parity tracking remains correct and projections are appended only to positive-parity feeds, not excluding feeds.​​​​​​​​​​​​​​​​

---

## Files Involved

| File | Role |
|---|---|
| `src/specification/feed-builder.ts` (this repo) | `buildExistentialCondition` — drops inner `!E` conditions; `addMatches` — fix applied here |
| `jinaga-server/src/postgres/specification-sql.ts` (external) | `generateNotExistsWhereClause` — only handles flat conditions |
| `jinaga-server/src/distribution/distribution-engine.ts` (external) | `notExistsConditionsEqual` — explicitly skips nested comparison |
