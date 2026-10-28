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

`.claude/skills/degrees-of-freedom/degrees-of-freedom-constitution.md`, installed from `michaellperry/skills`, is the standard a design is scored against. An issue's conformance criteria cite its articles.

## The specification and distribution subsystem

Most of the hard bugs in this repository concentrate here, and they interact:

- `skeletonOfSpecification` (`src/specification/skeleton.ts`) reduces a specification to a comparable shape. Its `edgeIndex` assignment is order-sensitive, so two structurally identical specifications can produce unequal skeletons if built by different paths.
- `buildFeeds` (`src/specification/feed-builder.ts`) decomposes a specification into feeds. Negative existential conditions branch: at odd nesting depth the branch is an *excluding* feed that stops, at even depth it is a *restoring* feed that must continue matching the rest of the specification.
- `DistributionEngine.canDistributeTo` (`src/distribution/distribution-engine.ts`) compares the skeleton of a client's specification against the skeletons of a rule's feeds. A mismatch surfaces as `spec-more-restrictive-than-rule`, which reaches users as a 403 on `/read` or, worse, a silent `"decision": "reactive"` on `/feeds`.

This engine backs both `JinagaTest` and the real replicator (jinaga-server). They are intended to stay in lock-step, but that has not always held in practice. **A passing `JinagaTest` run is not sufficient evidence that a distribution or feed-decomposition fix works.** Test at the level of the failing mechanism, not only end to end.

## Replicas are peers: design for local truth

Do not reason about Jinaga as a client and a server. Every replica is a peer. A client with no connection must be fully functional, and a replica may exchange facts with several others along branching, redundant paths, many hops apart. A design that needs a global order of facts, an authoritative answer ("what the server returns"), or a position some replica must assign before a fact counts, does not fit, however natural it feels for one client talking to one replicator.

- **A result is exact for the replica's own graph.** That graph is always a consistent state, because a fact never arrives before its predecessors. `query`, `watch` and the row streams owe exactness against it, nothing more and nothing less.
- **Positions belong to a replica.** A bookmark is a cursor into one peer's history for one feed. It is not a time shared across replicas.
- **Negation over a local graph is provisional.** No witness here is not no witness anywhere. No protocol between replicas makes a `notExists` settled without coordination, so do not try to make it settled in the transport.
- **Put premises in the model.** When an action must not run on a provisional negation, the fact it writes references the facts it acted on, so a concurrent contradiction is visible in history and a specification can find it. When a decision must be unique, name the principal who makes it with an authorization rule.
- **Prove what holds in every topology:** exactness for the local graph, independence of arrival order, feeds that carry every relevant fact, and convergence once replicas hold the same facts. Say plainly what cannot be proven, rather than offering a guarantee that needs a central replica.

Axiom A5 in `docs/analysis/specification-invariants.md` assumes replicators deployed in a hierarchy. Distribution relies on it today. Do not build new reasoning on it.

## Writing tests

Full guidance is in `contributing.md`. The rule that matters most:

**Never use arbitrary timeouts to wait for async work.** Do not write `await new Promise(resolve => setTimeout(resolve, 50))`. Use `await observer.processed()`, which resolves when all pending notifications have been processed, or the helpers in `test/utils/async-test-utils.ts` (`waitForObserver`, `waitForCondition`, `waitForCallbackCount`).

Timeouts are acceptable only when testing a race condition deliberately, polling an external system with no event notification, or simulating a user delay for a buffering test. Document why in a comment when you do.

Every bug fix needs a regression test that fails before the change and passes after. State both results in the pull request body.

**A test earns its place when it can fail for a reason other than an edit to the text it asserts on.** An assertion that the README, a doc comment, or a `docs/` page holds a given phrase restates that text in a second file, so it fails when an author rewords it and passes when it is wrong. Test documentation by compiling its examples or by deriving the expectation from the code it documents. Where nothing derives, the documentation stands on review, and no test is added.

## Conformance vectors

[jinaga-spec](https://github.com/jinaga/jinaga-spec) states the well-formedness check, `splitBeforeFirstSuccessor` and the inverses of a specification in Lean, proves them, and generates conformance vectors from the definitions. The `conformance` job in `main.yml` runs that repository's two runners against this checkout at the jinaga-spec commit named in `conformance/jinaga-spec.ref`.

`ports/typescript/run-vectors.ts` compares the split's head and tail, checks that `AuthorizationRules` refuses a rule exactly when its tail reads the given, and compares `wellFormedErrors` against each well-formedness vector.

`ports/typescript/run-inverse-vectors.ts` runs the inverse vectors. Each carries a specification, a graph, the givens, the facts that arrive, the rows gained and lost, and the proven inverses. It requires that `MemoryStore` read those inverses to exactly the vector's candidate rows, so it gates this library's evaluation of a specification rather than its inversion of one. It also checks `src/specification/inverse-candidates.ts` against the proven inverses, skipping that while the file is absent, and reports — without failing — the vectors on which today's `invertSpecification` misses a change.

To run it locally, check out jinaga-spec at the pinned commit (`git checkout $(cat /path/to/jinaga.js/conformance/jinaga-spec.ref)`), with `npm ci` done in this repository:

```
cd ports/typescript
npm ci
JINAGA_JS=/path/to/jinaga.js npm run vectors
JINAGA_JS=/path/to/jinaga.js npm run inverse
```

To move the pin, write the new jinaga-spec commit to `conformance/jinaga-spec.ref` as a full 40-character SHA, and run both runners locally at it. The workflow reads the pin from that file and refuses anything but a full SHA, so moving it needs no edit to `main.yml`. A failing vector means this library and the specification disagree: change the library, or report the disagreement against jinaga-spec. Never edit a vector to match.

## Working from issues

Issues labelled `ready` are queued for automated work. `.claude/skills/night-shift-worker/SKILL.md` documents that protocol: how to tell whether an issue is already claimed or already fixed, how ordering is decided, when to stop and ask a question instead of guessing, how stacked pull requests are opened and registered, and how each run is recorded so the reasoning survives the container.

Read it before picking up a `ready` issue, whether you are a scheduled agent or a person driving one. Everything this repository varies is in
`.night-shift/config.md`, which that skill refuses to run without.

## Conventions

- Branch from `main`. Name branches `claude/issue-<number>-<slug>` for issue work.
- Never push to `main`. Never merge your own pull request.
- Never skip, disable, or quarantine a test to get a green build.
- Never push an empty commit to re-trigger CI.
- End every comment you post on GitHub with the Claude Code attribution footer.
- Do not put model identifiers in commit messages, pull request text, or code comments.
