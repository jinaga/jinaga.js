---
name: night-shift
description: Work the queue of GitHub issues labelled `ready` in jinaga/jinaga.js, unattended. Use when sweeping for ready issues, deciding which are actually available to work, ordering them into chains, opening a fix as a stacked pull request, waiting for a lower layer's branch, or recording a blocking question instead of guessing. Covers the claim rule, the stacked-PR registration step, the stop condition for PR monitoring, and how each run reads and records the Night Shift Log so the reasoning outlives the container and steers the next run.
---

# Night shift: working `ready` issues

This is the protocol for automated work on `jinaga/jinaga.js`. It exists so a scheduled agent can pick up work at night without a person watching, and so two agents never work the same issue twice.

Read `CLAUDE.md` first for build commands, subsystem layout, and testing rules.

## 1. Find the queue

**Open** issues labelled `ready` are the queue. Nothing else is in scope. Do not pick up unlabelled issues, and do not add the `ready` label to anything yourself.

The `state` filter is not a nicety, so pass it explicitly (`state: OPEN` to `list_issues`) rather than filtering the results afterward. Closing an issue does not remove its labels, so a closed issue keeps `ready` indefinitely: on 2026-08-31 five of them did at once, every issue the previous two sweeps had worked. A queue that admits closed issues re-runs section 2's claim check on each of them every night, forever, to reach the conclusion their state already carried.

A repository may also strip the label on close (this one does; see `.github/workflows/clear-ready-on-close.yml`). Do not rely on it. The practice tracks many repositories and that automation is one repository's, while this filter is every sweep's.

## 2. Decide what is actually available: artifacts are the state

The `ready` label alone does not mean an issue is available. Labels go stale, because closing a pull request does not remove them. **The work artifacts are the source of truth, and you check them in this order.**

For each `ready` issue, search pull requests that reference it (by `#<number>` in the title or body, and by branch names matching `claude/issue-<number>-*`):

| What you find | What it means | What to do |
|---|---|---|
| An **open** pull request | Someone is already working it | Skip. Do not start a second session on it. |
| A **merged** pull request | A fix already landed | **Do not re-fix.** Verify whether the issue actually survives on current `main`. See below. |
| A **closed, unmerged** pull request | An attempt was abandoned | Read it before starting. It usually records why. |
| An unmerged branch on `origin` with no pull request | Work in progress, or abandoned | Read the branch. Build on it rather than starting over. |
| Nothing | Genuinely available | Work it. |

This has already caught a real case. Issue #242 carried `ready` for six days after PR #244 fixed it and merged, because merging did not clear the label. An agent trusting the label alone would have rebuilt a fix that already shipped.

### Fetch before you look

Every check in this section reads the remote. A container may hand you a working tree whose `origin/*` refs are older than the tree itself, and a stale ref answers "no branch matches" for a branch that has been on `origin` for two days. Run `git fetch origin` before the first lookup, and again before section 5 resolves a base branch. Read branches through `mcp__github__list_branches` when you want the authority rather than the cache.

### Read merge state from `merged_at`, never from `merged`

The table's top three rows turn on one distinction, and the field named for it does not carry it. GitHub's list-pull-requests response is a **subset** of the single-pull-request response, omitting `merged` along with `mergeable`, `merged_by` and the diff counts. `list_pull_requests` renders every row through one schema regardless, so a field the response never carried surfaces as its zero value, `false`, on every row alike. Nothing is reporting a wrong answer. A question that was never asked is showing a default.

`merged_at` is in the list response, and it is populated.

A merged pull request read through `merged` therefore arrives as `state: closed, merged: false`, which is the **closed, unmerged** row: *an attempt was abandoned, read it before starting.* That sends the next session to re-fix work that already shipped, which is the #242 failure above arriving through a different door.

So treat a non-null `merged_at` as merged, or confirm with a per-pull-request read (`pull_request_read` with `method: "get"`). Do not branch on `merged` from a list response.

Measured on 2026-08-31, and the contrast is the tell. Pull requests 253, 255, 257, 260 and 261 had all merged, and each came back `"merged": false` carrying its own `merged_at`. Pull request 247, closed without merging, came back `"merged": false` with no `merged_at` key at all. The timestamp tracks reality row by row; the boolean is constant.

This is the same genus of mistake as reading a workflow run's conclusion without its `event` (section 5). A surface field that reads like an answer is not one until you know what populates it.

### When a merged pull request exists

Your job changes from *fix* to *verify*, and that is a complete and valuable outcome. Do not manufacture a change to justify the session.

1. Read the merged diff and any analysis document it added.
2. Enumerate every symptom the issue and its comments describe, separately. A large fix often resolves some and not others.
3. Test each symptom against current `main` and record a verdict per item.
4. If everything is resolved: open a pull request carrying only the regression coverage that is still missing, or open none at all if coverage is complete. Then comment on the issue with your per-symptom verdicts and evidence, and recommend closing.
5. If part survives: fix that part, and say plainly in the pull request which symptoms the earlier fix handled and which yours addresses.
6. If the verification is complete but the one item still open needs evidence you cannot reach — a capture from a live system, a reproduction repo, an answer from the reporter — say so in the comment and take the question swap in section 6. An issue no unattended run can advance should not sit in `ready` collecting a re-verification every night.

Steps 4 and 6 differ in who is blocked. **Resolved** means recommend closing and leave the label alone; the maintainer decides. **Blocked on outside evidence** means the swap, because the queue is the wrong place for it either way.

**Never close an issue yourself, and never remove the `ready` label from an issue you believe is resolved.** Recommend, and let the maintainer decide. The one label change you may make is the question swap in section 6.

## 3. Order the work

### Read the log before you sequence

The heuristics in this section are the ones this protocol has actually been wrong about, and the Night Shift Log is where the corrections live. Read it before sequencing anything:

- `correctedVerdicts` — conclusions a later run disproved, and where the disproof came from. The application's own guidance on this view is to read it *before trusting an ordering or attribution heuristic*, which is precisely what the rest of this section is.
- The most recent sweep's `considerationsInSweep` — what was dispatched, on what rationale, and what came of it.

Section 8 has the mechanics. This is a read for **reasoning**, never for availability: GitHub remains the only authority on what is claimed, and section 2's check still runs in full against it.

A rationale in the log is the record of what a run decided. It is not a citation of this document. When a log entry quotes a rule, check the rule here before you rely on it.

It has already mattered. In the sweep of 2026-08-30, issue #241 was sequenced last on the theory that it shared a root cause with #242 and might fall out of that fix. It did not. The session working it found the shape passing at `0d6c13b`, the reporter's own version, which predates the #242 fix and contains none of its logic. That correction is recorded. A run that re-derives the theory without reading the log makes the same ordering mistake and spends a session proving the same negative.

### Sequencing

Group the available issues by subsystem. Issues touching the same files are not independent, and running them in parallel from `main` produces conflicting patches for one root cause.

**A group is a chain, not a reason to skip.** Sequence by dependency, the change that others build on going first, and stack each layer on the one below. A foundational fix (label registration, feed decomposition) precedes the issues that may fall out of it. Where two or more issues must land before a third, they do not block it: a pull request has one base, so put all of them in one chain in any order where none reads another's code, and stack the third on the topmost. A chain is a linearization of the dependency graph.

When one issue is plausibly a duplicate of another's root cause, put it last and have it verify before it fixes.

Across groups, work in parallel freely.

Depth is not a budget. A layer whose base branch does not exist yet waits for it (section 5), and idle worker time is acceptable. Do not defer a layer to the next sweep to avoid waiting.

### How much to take

There is no fixed budget, and you should not invent one silently. Take what you can carry through section 4's full bar — reproduce, fix, regression test, green build — and **say in your report, and in every skip rationale that leans on it, what budget you chose and why.**

The sweep of 2026-08-31 skipped issues #250 and #252 citing "this run's two-issue budget." The skips were sound on their merits, but the budget appeared nowhere in this protocol and nowhere in the run's own report, so the record does not show whether it was a considered limit or an improvisation. A skip reason is only evidence if the constraint behind it is stated.

## 4. Work the issue

Reproduce first. An issue's repro may be reconstructed rather than verified by its reporter; if it does not reproduce, that is a finding, not a failure.

Then fix, with a regression test that fails before and passes after. Keep the change minimal. Record anything you notice beyond the issue's scope as a note in the pull request rather than widening the diff.

Run `npm ci && npm run build && npm test` green before every push.

## 5. Open the pull request, stacked

Branch name: `claude/issue-<number>-<slug>`.

When your issue is sequenced behind another in the same subsystem, branch from **that issue's branch**, not from `main`, and open your pull request with its base set to that branch. This is a stacked pull request. It lets the chain proceed without waiting for anything to merge, and GitHub retargets each pull request to `main` automatically as the bases land.

### Resolving a base branch that does not exist yet

A dispatch names the **issue** you stack on, never the branch, because the branch carries a slug only its own worker chooses. Resolve it by pattern, and expect to wait:

1. `git fetch origin`, then match `origin/claude/issue-<M>-*`. Confirm against `mcp__github__list_branches` rather than a cached ref.
2. No match means the lower worker has not pushed yet. Its session is running concurrently with yours. Re-check every 5 minutes for up to 90 minutes, re-arming a check-in rather than blocking.
3. Once it matches, branch from it and set it as your pull request base.
4. If it never appears, report that issue #M produced no branch, and **open no pull request**.

**Never fall back to `main`.** Branching from `main` while the lower layer's work is absent renders that work as deletions in your diff, which reads as a revert and passes review by looking small.

### Registering the stack

Setting base branches is necessary but not sufficient: until the chain is registered as a stack, GitHub treats the pull requests as ordinary ones with unusual bases.

Registration is what holds every layer to the same bar. GitHub evaluates a stacked pull request against the base of the stack rather than the branch it targets, so branch protections, required checks and CODEOWNERS all resolve against `main`, and the chain merges bottom-up as one atomic operation. Reviewers get a stack map as well.

There is no MCP tool for the Stacks API. Use the committed script, which is pre-approved for this repository:

```
./scripts/register-stack.sh list                                 # inspect existing stacks
./scripts/register-stack.sh create <lower-pr> <upper-pr> [...]   # bottom to top, min 2
./scripts/register-stack.sh add <stack-number> <pr>              # append above the current top
```

**Register the moment the upper layer's pull request exists.** The Stacks API takes pull request numbers, so the upper pull request opens first and joins a stack second. Until you register it, it is an ordinary pull request with an unusual base, and a workflow triggers only on `opened`, `synchronize` and `reopened`. Joining a stack fires none of the three, so the layer keeps whatever checks its `opened` event produced. `.github/workflows/main.yml` runs on a bare `pull_request:`, so that event produces a full set. Registration then decides the merge gate.

Use `create` when yours is the second layer and no stack exists. Use `add` when a stack already holds your base's pull request. Run it once and report its exact output and HTTP status. Never retry.

### Confirm a run happened, by its `event`

Read each layer's run through its `event` field, not its conclusion. A green check says a run passed. It does not say which trigger produced it, and a layer whose only run came from a manual dispatch is not being checked by its own pull request. This is the same genus of mistake as reading `merged` without `merged_at` (section 2): a surface field that reads like an answer is not one until you know what populates it.

Scope the lookup to one workflow and one branch. Listing a workflow's recent runs returns tens of kilobytes and will overflow a tool result. `gh` is absent from the night-shift container, so ask the MCP server:

```
mcp__github__actions_list, method list_workflow_runs, resource_id "main.yml",
workflow_runs_filter { branch: "<your branch>" }
```

The filter takes a **branch**. Match `head_sha` yourself against the rows it returns, rather than asking the filter for a SHA. In a local session with `gh`, the same question is one call:

```
gh api "repos/jinaga/jinaga.js/actions/workflows/main.yml/runs?head_sha=<sha>" \
  --jq '.workflow_runs[] | "\(.event)/\(.conclusion)"'
```

Address the workflow by its **file** (`resource_id: "main.yml"`), not by matching a display name. This repository runs ten workflows, so an unscoped listing returns several rows per commit, and a run's `name` is the *run* name, which a workflow can override with `run-name:`. A name filter that stops matching returns nothing, which reads exactly like "CI never ran."

Only if a layer shows no run at all, dispatch `main.yml` yourself and **report that as a finding** rather than as routine. **Never push an empty commit, and never close and reopen a pull request, to provoke a run.**

## 6. When to stop and ask instead

Record a blocking question when proceeding either way could produce the wrong patch and you cannot settle it from the code, the tests, or the issue text. A question about a detail you can work around is not blocking: do everything that does not depend on the answer first.

Record one **also** at the far end of a run, when the work is finished and the issue still is not: the shape does not reproduce anywhere you can reach, and settling it needs a capture from a live system, a reproduction repo, or an answer from the reporter. Issue #241 was in exactly that state after PR #257 measured seven shapes across two base versions and found no defect in any of them. Its one open item was the reporter's untruncated error body, which no session here can produce. Left in `ready`, an issue like that draws a fresh claim check every night, flips to verify on the merged pull request it already has, and re-derives a verification that is already complete.

To record one:

1. Comment on the issue. State what you found, why it blocks you, the candidate answers, and what you would do under each. Make it answerable in one reply. If a pull request already exists, post it there too and link it from the issue comment.
2. Remove the `ready` label and add `question`.
3. Stop. Do not guess and push a speculative fix.

The label swap moves the issue out of the queue, so the next night's sweep will not pick it up again while it waits on an answer.

## 7. Monitor the pull request, then stop

After opening a pull request:

1. Subscribe to its activity.
2. Request a GitHub Copilot review.
3. Drive CI to green. A red check on your own pull request is work now, at every wake: diagnose, fix, push. Never skip, disable, or quarantine a test to get green. If a failure is genuinely not yours, meaning it is red on the base branch too, say so in one comment rather than going silent.
4. Complete **one round** with Copilot. Address every suggestion with a pushed commit, or reply on the thread explaining why it is wrong or out of scope. Resolve the threads you addressed.

A review comment is a claim, not a verdict. Verify it against the repository before you act on it, and check your `origin/*` refs are current before you conclude that something a reviewer named is missing. Reply with what you found either way.

**Stop when CI is green on the current head and that one Copilot round is complete**, either because Copilot left no suggested changes or because you have addressed all of them. Then unsubscribe. Do not cycle into further rounds.

Until both conditions hold, schedule a check-in roughly an hour out before ending a turn, and re-arm it each time.

**Check-run events name a stale head.** In the first real run, two `check_suite.completed` events arrived naming commits the pull request had already moved past, and a third arrived for a head that a co-author's push had superseded seconds earlier. Acting on the SHA in the event would have declared green on a commit that was no longer current. Always re-read the pull request's own head before concluding anything about its state, and treat the event as a nudge to look rather than as a report of what is true.

## 8. Read and record the run in the Night Shift Log

A run that leaves no trace teaches nothing, and a run that reads no trace repeats. GitHub keeps the artifacts — a pull request, a comment, a label — but not the judgments: what you considered and passed over, why you ordered the work as you did, what a verdict rested on. Those die with the container unless you record them, and they help nobody unless the next run reads them.

They go in the **Night Shift Log**, a Jinaga application reached through the Factual MCP server. Open a console, run `applications`, and open the one whose routing matches; its manifest carries the full action catalog with argument guidance, so read `describe` there rather than relying on this list.

This section is the mechanics. It is placed last because it is a reference, **not because the log is an epilogue** — the run opens it before section 2 and reads it before section 3.

The shape of a run, in the order the run performs it:

1. `practicesForAdministrator($me)` — the entry point, before section 2. Find the repository whose current name matches the one you are sweeping and take its `repositoryRef`. If no practice or no matching repository exists, **stop and say so**. `createPractice` and `registerGitHubRepository` are one-time setup, and calling them speculatively mints duplicates that split the history.
2. `startSweep($repository, $headCommit)` once, before examining anything.
3. `correctedVerdicts`, and the previous sweep's `considerationsInSweep` by way of `sweepsInRepository`, before you sequence. This is the read half; section 3's **Read the log before you sequence** says why skipping it costs a session.
4. Per issue: `considerIssue`, then exactly one finding action — `findOpenPullRequest`, `findMergedPullRequest`, `findClosedPullRequest`, `findBranch`, or `findNoPriorWork` — matching what section 2's claim check turned up.
5. Then `dispatchWork` (with the ordering argument in `rationale`) or `skipIssue`. Creating the fact *is* the decision; there is no decision value to set.
6. Per dispatch, when it finishes: `openPullRequest`, `raiseQuestion`, or `findNoChange`.
7. Later, when a question is answered or a verdict turns out wrong: `answerQuestion`, or `correctVerdictFromWork` naming the consideration whose work produced the disproof.

Three rules about what goes in:

- **Record what you skipped, not just what you worked.** A skip with its reason is the evidence the claim rule is working, and it is the only record that an issue was looked at at all.
- **Never record availability.** GitHub is the queue and the only authority on what is currently ready. The log holds what was observed and decided, and when. Storing "issue 242 is available" would create a second source of truth that can go stale, which is the exact failure the claim rule exists to catch.
- **Write a rationale you can support.** A rationale is your own account, so quote a rule only after reading it, and name the file it comes from. A confident paraphrase of a rule that does not exist reads as evidence to every later sweep.

If the Factual server is unreachable, do the GitHub work anyway and say in your final report that the run went unrecorded. A missing log entry is a gap; a blocked run is a worse one.

## 9. Hard limits

- Never push to `main`, and never push to another session's branch.
- Never merge a pull request.
- Never close an issue, and never remove `ready` except as part of the question swap.
- Never skip, disable, or quarantine a test to get a green build.
- Never push an empty commit to re-trigger CI.
- Never put a mutating call in a retry or fallback position. A shell `cmd-a || cmd-b` runs `cmd-b` when `cmd-a` merely prints something unexpected, and a "test" invocation of a create endpoint is a real write. Both happened in the first run; the API's own validation caught them, which is luck, not method.
- End every GitHub comment with the Claude Code attribution footer.
- Do not put model identifiers in commit messages, pull request text, or code comments.
