# Recording a dispatch in the Night Shift Log

A run that leaves no trace teaches nothing. The host keeps the artifacts — a pull request, a comment, a label — but not the judgments, and those die with the container unless you record them.

The log is a Jinaga application reached through the Factual MCP server. Open a console, run `applications`, and open the one whose routing matches. **Its manifest carries the full action catalog with argument guidance, so run `describe <action>` there rather than trusting an argument list in this file.**

## The whole shape, for orientation

The coordinator performs steps 1 to 5, before your session exists. You perform 6, and 7 when it later applies.

1. `practicesForAdministrator` — resolve the practice and this repository. *(coordinator)*
2. `startSweep` — once per repository per sweep. *(coordinator)*
3. `correctedVerdicts` and the previous `considerationsInSweep`. *(coordinator)*
4. `considerIssue`, then exactly one finding action. *(coordinator)*
5. `dispatchWork` or `skipIssue`. *(coordinator)*
6. **`openPullRequest`, `raiseQuestion`, or `findNoChange`** — exactly one, when your dispatch finishes. *(you)*
7. **`answerQuestion`, or `correctVerdictFromWork`** naming the consideration whose work produced the disproof. *(you, later)*

## Finding your dispatch

Your outcome attaches to the `Dispatch` the coordinator created for your issue. You were not given its reference, so resolve it:

1. `practicesForAdministrator($me)`, and take the `repositoryRef` whose current name matches this repository.
2. `sweepsInRepository($repository)`, and take the most recent sweep.
3. `considerationsInSweep($sweep)`, and find the row whose issue number is yours. Its `dispatches` entry carries the `dispatchRef` you need.

The `branch` on that dispatch is a **glob**, not a branch name — the coordinator writes `claude/issue-<N>-*` because the slug is yours to choose. It is not the branch you pushed, and you should not try to reconcile it.

**The log does not record your actual branch anywhere.** `PullRequestOpened` carries the number, the summary and the time, and no branch. What ties this dispatch to the work that came of it is the pull request number. Do not reach for `findBranch` to fill the gap: that action means *the claim check found a branch that already existed*, so recording your own branch through it would make the next sweep read your own work as prior work and skip the issue.

## Two console forms that cost a retry each

**A `call` yields a frame of named bindings, so it cannot be bound to one name.** Destructure what you need:

```
let { $pullRequest as $pr } = call openPullRequest($dispatch, 123, "Bounded the retry so a stalled feed fails instead of hanging.")
```

`let $pr = call openPullRequest(...)` is a parse error, not a runtime one, so it takes the whole batch with it.

**Every variable carries `$`,** including the bound name and a specification's own variables. One statement per line; `;` only joins two on one line.

## Three rules about what goes in

- **Never record availability.** The hosting platform is the queue and the only authority on what is currently ready. The log holds what was observed and decided, and when. Storing "this issue is available" would create a second source of truth that can go stale, which is the exact failure the claim rule exists to catch.
- **Write a rationale you can support.** A rationale is your own account, so quote a rule only after reading it, and name the file it comes from. A confident paraphrase of a rule that does not exist reads as evidence to every later run.
- **If the server is unreachable, do the hosting-platform work anyway** and say in your final report that the run went unrecorded. A missing log entry is a gap; a blocked run is a worse one.

## Nothing to fix is a result

`findNoChange` exists because a dispatch that concludes there is nothing to fix has produced a real finding. Record it rather than leaving the dispatch open, and never manufacture a change to avoid using it.
