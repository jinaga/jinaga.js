---
name: reviewing-model-idioms
description: >
  Use when reviewing a Jinaga fact model or a specification that reads it —
  especially when a query returns stale, duplicate, or unexpectedly-present
  data, or before merging a change to fact types. Checklist-driven; works on
  the model in any language.
---

# Reviewing model idioms

A short list of defects that account for most of what actually goes wrong in
a historical model. Each one is checkable by inspection — no tooling
required, though `authoring-jinaga-specifications-dotnet` (or its
TypeScript counterpart) shows the fix in each language's syntax.

## The superseded-filter bug

**The single most common defect.** A fact type follows the mutable-property
(`prior`) or delete/restore pattern, but somewhere a specification reads it
without filtering out the superseded or deleted instances:

```
// Wrong: returns every TaskTitle ever created for this task,
// including ones that have since been replaced.
Task -> TaskTitle (task)

// Right: only titles nothing else lists as prior.
Task -> TaskTitle (task), where no TaskTitle lists this one in `prior`
```

This is a *half-implemented pattern* — the fact type correctly supports
history (the `prior` array exists, deletion facts exist), but a read site
forgot to apply the filter that makes "current" or "live" mean what it
should. It reads correctly in a test with one edit and breaks the moment a
second edit happens. When reviewing a specification, find every fact type it
reads that has a `prior` array or a paired deletion fact type, and confirm a
"does not have a successor" filter is actually applied at that point in the
query — not just present somewhere else in the file.

## Mutable state fields

A boolean or enum field on a fact meant to represent a lifecycle position —
`isDeleted`, `status`, `stage`, `approved` — is a contradiction: nothing can
ever set it, because facts don't mutate. If this shows up, it means either
the field is dead weight (set once at creation and never meaningfully
re-read) or the design actually needs a successor fact type per transition,
per `designing-historical-models`.

## Vague or generic names

A fact type or a projected field named `items`, `data`, `results`, or the
plural of a *property* instead of the *entity* it groups (`statuses` instead
of `taskCompletions`) hides what a reader would need to know to use it
correctly. Flag names that don't let a reviewer guess the shape without
opening the definition.

## Fabricated identity

A fact constructed with a hand-typed string standing in for a real user or
tenant identity (e.g. building a `User` from a literal string rather than an
actual authenticated public key) can never match a real login. Anything
rooted on it is permanently orphaned from the identity it was meant to
represent. This is easy to miss because it works fine in a dev seed script
and fails silently in production.

## Reconstructable keys that silently forked

A fact meant to be *rebuilt* from known inputs (an activation code, a
deployment-constant identifier) rather than looked up must be constructed
identically at every call site. If a field is added to such a fact type
later, every reconstruction site needs to pass that field identically —
including `null`/`undefined` where nothing applies — or two call sites will
independently produce facts with different hashes for what was meant to be
the same fact. When reviewing an addition to a fact type that's constructed
in more than one place, check every construction site, not just the one in
the diff.

## Root and reachability

If the model is meant to be securable per-user (only the owner or an
authorized principal can act on it), check two independent things, because a
model can satisfy one and not the other:

- **Securability** — is there actually an owning `User` predecessor
  somewhere in the chain, and is the fact that establishes ownership created
  exactly once (not re-creatable by anyone who wants to claim ownership)?
- **Navigability** — starting from the current user's own identity, does
  some specification actually reach this fact type? A model can be
  perfectly secured and still be practically unreachable if nothing chains
  the caller's identity down to it.

These are independent failure modes — a model can pass one review and fail
the other, so check both explicitly rather than treating "it's secured" as
implying "it's reachable."
