# Bug Analysis: Feed Builder Strips Inner Negative Existential Conditions

**Date:** 2026-03-30
**Area:** `jinaga` package — `feed-builder.js` / `specification-sql.ts`
**Symptom:** EventName facts not delivered to clients for events that have been deleted and restored

---

## Observed Symptom

The LaunchKings admin portal Events dropdown shows the raw fact hash prefix (e.g. `65bc55e`) instead of the event's human-readable name ("LATAM test"). The `CodeLaunch.Event.Name` fact exists in the database and the distribution rules authorize it, but it is never delivered to the client via feeds.

## Database State That Triggers the Bug

```
CodeLaunch.Event         1 fact   — id: 65bc55e9-495a-4418-9744-3dea6f8c8f2a
CodeLaunch.Event.Name    1 fact   — value: "LATAM test"  (EXISTS — not missing)
CodeLaunch.Event.Delete  2 facts  — deleted twice
CodeLaunch.Event.Restore 2 facts  — restored twice → event is currently active
```

The event is logically active (every delete has a matching restore), but its presence of any `EventDelete` facts triggers the bug.

---

## Root Cause

### The Specification

The `eventsListInTenant` specification uses `Event.in(tenant)`:

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
// feed-builder.js — buildExistentialCondition()
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

### The Five Feeds for `eventsListInTenant`

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

Because the "LATAM test" event has `EventDelete` facts (regardless of `EventRestore`), the `NOT EXISTS (EventDelete)` clause is false, the event is excluded, and **the query returns zero rows**.

### Why the Listener Doesn't Rescue It

The observer also registers inverse specification listeners. When FeedA delivers `EventRestore` facts, the listener fires and calls `notifyAdded` — which reads EventName from the **local IndexedDB store**. Because FeedE never delivered EventName to the local store, the re-evaluation finds nothing, and names remain absent.

---

## Impact

Any event that has ever been deleted (even if subsequently restored) will have its name and other projection facts permanently withheld from all projection feeds. The event itself still appears (via FeedC — though FeedC has the same bug, so events with any EventDelete also don't appear there). This affects:

- `CodeLaunch.Event.Name` — event name not shown in nav dropdown
- `CodeLaunch.Event.Date` — event dates not shown
- Any other projected facts on events from `eventsListInTenant` or similar specs

In this environment the event was deleted and restored twice, making it the only event and confirming 100% reproduction.

---

## The Fix

### Option A — Support Nested NOT EXISTS in Feed SQL (Correct but Complex)

Extend `buildExistentialCondition` to recursively include negative inner existential conditions:

```js
// feed-builder.js — buildExistentialCondition()
for (const innerExistentialCondition of match.conditions.filter(isExistentialCondition)) {
    if (innerExistentialCondition.exists) {
        // existing logic — keep positive existentials
        const { existentialCondition: newEC, ... } = buildExistentialCondition(...);
        existentialCondition = newEC;
    } else {
        // NEW: also recurse into negative existentials
        const { existentialCondition: newEC, ... } = buildExistentialCondition(
            innerExistentialCondition, innerExistentialCondition.matches, ...
        );
        existentialCondition = { ...existentialCondition, innerConditions: [..., newEC] };
    }
}
```

This also requires:
1. Adding a `innerConditions` (or `notExistsConditions`) field to `ExistentialConditionDescription`
2. Updating `generateNotExistsWhereClause` in `specification-sql.ts` to recurse into nested conditions
3. Updating `notExistsConditionsEqual` in `distribution-engine.ts` if nested conditions need to be compared

### Option B — Omit Outer Not-Exists from Projection Feeds (Simpler)

When `addProjections` builds projection feeds (FeedD, FeedE), start from a version of the specification that **drops all not-exists conditions on the base matches**. Projection feeds would then return facts for all events (active or not), and the full specification read handles the correct filtering.

```js
// feed-builder.js — buildFeeds()
const baseFeed = stripNotExistsConditions(finalFeed); // new helper
const feedsWithProjections = addProjections(baseFeed, unusedGivens, specification.projection.components);
```

This is safe because:
- FeedA and FeedB already handle re-evaluation when delete/restore facts arrive
- The actual filtering is done by `factManager.read()` using the full specification
- Feeds are designed to be a **superset** of relevant facts; over-delivery is intentional

Option B is simpler, has no SQL changes, and aligns with the documented design principle that "feeds are not executed with nested existential conditions."

---

## Files Involved

| File | Role |
|---|---|
| `jinaga/src/specification/feed-builder.ts` | `buildExistentialCondition` — drops inner `!E` conditions |
| `jinaga-server/src/postgres/specification-sql.ts` | `generateNotExistsWhereClause` — only handles flat conditions |
| `jinaga-server/src/distribution/distribution-engine.ts` | `notExistsConditionsEqual` — explicitly skips nested comparison |
