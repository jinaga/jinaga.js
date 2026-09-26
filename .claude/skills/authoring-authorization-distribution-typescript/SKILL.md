---
name: authoring-authorization-distribution-typescript
description: >
  Use when deciding or implementing who can create a fact (authorization)
  or who can read it back (distribution) in a Jinaga TypeScript app, or
  when a write or a query is being rejected unexpectedly.
---

# Authorization and distribution rules in TypeScript

Two separate, independently-enforced concerns: **authorization** decides
who may *create* a fact; **distribution** decides who may *read* it back.
A model can get one right and the other wrong — always check both.

## Authorization: deny by default, including for `User` itself

```typescript
import { AuthorizationRules } from "jinaga";

export const authorization = (a: AuthorizationRules) => a
    .any(User)
    .type(Project, project => project.creator);
```

**Every fact type needs an explicit rule, with no exceptions — including
the built-in `Jinaga.User` fact.** A fact type with no rule at all is
rejected outright ("has no authorization rules"), not implicitly allowed —
and this applies to `User` exactly like any application fact type. Skipping
a rule for `User` doesn't just block one feature; it rejects login/signup
itself, since the current user's own identity fact needs to be created
before anything else can be. `.any(FactClass)` allows anyone to create it
(the common choice for `User`, since its content is the caller's own
cryptographic identity); `.type(FactClass, selector)` restricts creation to
whoever the selector reaches from the fact being created.

The selector can be a direct predecessor reference (`project =>
project.creator`) or a full traversal (`event => event.tenant.predecessor()
.selectMany(t => Administrator.usersOf(t))`) — both forms are valid,
picked by how far the authorizing user is from the fact being authorized.

## Distribution: who can read a share back

```typescript
import { DistributionRules } from "jinaga";

export const distribution = (d: DistributionRules) => d
    .share(Task.in(project))
    .with(model.given(Project).match(p => p.creator.predecessor()));
```

`.share(specification)` names what's being shared; `.with(userSpecification)`
names who it's shared with, as its own specification reaching from the same
given down to a `User`. Omitting `.predecessor()` in that user
specification is a documented, easy-to-hit mistake — the share silently
fails to authorize anyone at runtime rather than failing to compile.
`.withEveryone()` skips the user check entirely, for public reads.

## A rejected write throws; a rejected read is quieter

`j.fact(...)` on an unauthorized fact rejects the promise — straightforward
to test (see `testing-jinaga-typescript`). A distribution denial on
`j.query()` also rejects, but a **live** `j.watch()`/`useSpecification` read
doesn't fail the same way — Jinaga is offline-first, so a local-store read
can appear to succeed with nothing in it, indistinguishable at a glance
from "there's just no data yet." `integrating-jinaga-react` covers the
current, more precise signal for this (`distributionPending`/
`distributionDiagnostic`); the takeaway here is: **write a `j.query()` test
that asserts the rejection directly** rather than trying to prove
distribution correctness through a reactive hook.

## Keep the replicator's policy file in sync

A production Jinaga deployment's replicator enforces authorization and
distribution from a generated policy artifact, not by re-evaluating the
TypeScript rules at request time. Adding a fact type, or changing an
`authorization`/`distribution` rule, means regenerating and committing that
policy file as part of the same change — otherwise the real replicator
rejects (or, just as risky, wrongly permits) requests the local, optimistic
write path made look like they'd succeeded. Check the project's own build
scripts for the exact regeneration command; treat a stale committed policy
file as a shipped bug, not a formality.
