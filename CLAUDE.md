# Jinaga.js

TypeScript library for end-to-end application state management. Data is modelled as **facts**: immutable records forming a directed acyclic graph. Queries over that graph are **specifications**.

## Build and test

```
npm ci
npm run build      # tsc
npm test           # npx tsc --noEmit --project tsconfig.test.json, then jest
npm run test:watch # during development
```

CI (`.github/workflows/main.yml`) runs `npm ci && npm run build && npm test` on Node 22. Run the same three locally before pushing. A green local run is the real gate: do not push on the assumption CI will catch it.

## Where things live

| Area | Path |
|---|---|
| Public API surface | `src/index.ts`, `src/jinaga.ts` |
| Specifications (parser, skeleton, feeds, inverses, runner) | `src/specification/` |
| Distribution rules and the engine that matches them | `src/distribution/` |
| Authorization rules | `src/authorization/` |
| Storage, forks, observers | `src/storage.ts`, `src/fork/`, `src/observer/` |
| HTTP and WebSocket transport | `src/http/`, `src/ws/` |
| Tests, mirroring `src/` | `test/` |

`.cursor/rules/*.mdc` holds detailed per-area guidance (testing standards, fact patterns, TypeScript standards, async coordination). Read the relevant rule before working in an unfamiliar area.

`docs/analysis/` holds deep write-ups produced while fixing hard bugs. `specification-invariants.md` in particular records the invariants the feed builder and skeleton must preserve. Read it before changing `src/specification/feed-builder.ts` or `src/specification/skeleton.ts`.

## The specification and distribution subsystem

Most of the hard bugs in this repository concentrate here, and they interact:

- `skeletonOfSpecification` (`src/specification/skeleton.ts`) reduces a specification to a comparable shape. Its `edgeIndex` assignment is order-sensitive, so two structurally identical specifications can produce unequal skeletons if built by different paths.
- `buildFeeds` (`src/specification/feed-builder.ts`) decomposes a specification into feeds. Negative existential conditions branch: at odd nesting depth the branch is an *excluding* feed that stops, at even depth it is a *restoring* feed that must continue matching the rest of the specification.
- `DistributionEngine.canDistributeTo` (`src/distribution/distribution-engine.ts`) compares the skeleton of a client's specification against the skeletons of a rule's feeds. A mismatch surfaces as `spec-more-restrictive-than-rule`, which reaches users as a 403 on `/read` or, worse, a silent `"decision": "reactive"` on `/feeds`.

This engine backs both `JinagaTest` and the real replicator (jinaga-server). They are intended to stay in lock-step, but that has not always held in practice. **A passing `JinagaTest` run is not sufficient evidence that a distribution or feed-decomposition fix works.** Test at the level of the failing mechanism, not only end to end.

## Writing tests

Full guidance is in `contributing.md`. The rule that matters most:

**Never use arbitrary timeouts to wait for async work.** Do not write `await new Promise(resolve => setTimeout(resolve, 50))`. Use `await observer.processed()`, which resolves when all pending notifications have been processed, or the helpers in `test/utils/async-test-utils.ts` (`waitForObserver`, `waitForCondition`, `waitForCallbackCount`).

Timeouts are acceptable only when testing a race condition deliberately, polling an external system with no event notification, or simulating a user delay for a buffering test. Document why in a comment when you do.

Every bug fix needs a regression test that fails before the change and passes after. State both results in the pull request body.

## Working from issues

Issues labelled `ready` are queued for automated work. `.claude/skills/night-shift/SKILL.md` documents that protocol: how to tell whether an issue is already claimed or already fixed, how ordering is decided, when to stop and ask a question instead of guessing, how stacked pull requests are opened and registered, and how each run is recorded so the reasoning survives the container.

Read it before picking up a `ready` issue, whether you are a scheduled agent or a person driving one.

## Conventions

- Branch from `main`. Name branches `claude/issue-<number>-<slug>` for issue work.
- Never push to `main`. Never merge your own pull request.
- Never skip, disable, or quarantine a test to get a green build.
- Never push an empty commit to re-trigger CI.
- End every comment you post on GitHub with the Claude Code attribution footer.
- Do not put model identifiers in commit messages, pull request text, or code comments.
