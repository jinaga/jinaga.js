# Recording a dispatch in the Night Shift Log

A run that leaves no trace teaches nothing. The host keeps the artifacts — a pull request, a comment, a label — but not the judgments, and those die with the container unless you record them.

The log is a Jinaga application reached through the Factual MCP server. Open a console, run `applications`, and open the one whose routing matches. That console is yours to close, and *Close the console, on every exit path* below says when and why. **Its manifest carries the full action catalog with argument guidance, so run `describe <action>` there rather than trusting an argument list in this file.**

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

## Close the console, on every exit path

**`close_console` is the last log step of every run, including a run that stops early.** The server caps one identity at 16 open consoles, and every routine in a practice runs as that same identity, so each run that leaves its console open takes a slot the next one needs. **The pool does heal on its own, and far too slowly to lean on.** A console that nothing touches for a full recovery window — seven days, as the server's own `list_consoles` description states — stops counting against the cap. It does not disappear when it does: `list_consoles` still reports it, marked `expired`, and its working copy survives. Consoles idle for five days have been seen still holding their slots. A practice that dispatches a few issues a night reaches 16 long before its oldest leak expires, so recovery never arrives in time to help, and every run from then on works through the reuse path below instead of opening a console of its own.

**The paths that leak are the ones that stop early**, because the close sits at the bottom of a procedure they never reach. A stop for a missing config heading or a missing file, a duplicate dispatch that no-ops, a repro that failed, a recorded question, a fix abandoned on a blocker. Close the console on each of them.

**A refused `create_console` is a full pool, not an unreachable server.** `console_limit` comes back with a `candidates` list, and the run continues on one of them: take a candidate whose `dirty` is false and whose `stagedFacts` is `0`, and work in that. **Never work in a dirty candidate, and never close a dirty one.** Its staged facts belong to a session that is not yours, and closing it discards them. The clean candidate you do take is yours for the run and you close it at the end, exactly as you would close one you had opened yourself.

**If every candidate is dirty the pool is genuinely exhausted, and that is still not an outage.** Do the hosting-platform work, and report the run unrecorded naming a full console pool as the reason. The two read alike in a report and have different remedies: a full pool was caused by earlier runs that did not close their consoles, and an outage belongs to whoever owns the connector.

## When the log is unreachable

**Unreachable means the server cannot be reached at all**, and it has exactly two shapes: its tools are absent from the session, or its connector reports that it needs authorization. A `console_limit` refusal is neither, because the server answered; a full pool is the section above, and so is a pool in which every candidate is dirty.

**Do the hosting-platform work anyway.** A missing log entry is a gap; a blocked run is a worse one.

**Then raise it where a person will see it the same day.** Send a push notification as well as saying it in your final report. A scheduled routine's final report lives in a session transcript that nobody reads by default, which is how a connector that had lost its authorization cost two consecutive unrecorded nights before anyone noticed. The notification names the repository, this session, and that the run is unrecorded.

**Send it before you stop.** Your outcome attaches to a `Dispatch` that may itself be unrecorded, in which case there is nothing to attach to and no trace that this dispatch produced anything. Name the pull request you opened, the question you recorded, or the no-change you found, so the artifact can be found without the log.

## Four rules about what goes in

- **Never record availability.** The hosting platform is the queue and the only authority on what is currently ready. The log holds what was observed and decided, and when. Storing "this issue is available" would create a second source of truth that can go stale, which is the exact failure the claim rule exists to catch.
- **Write a rationale you can support.** A rationale is your own account, so quote a rule only after reading it, and name the file it comes from. A confident paraphrase of a rule that does not exist reads as evidence to every later run.
- **Summarize the change, not its evidence.** The `openPullRequest` summary says what changed and why, as the example above does. Restating the pull request's evidence makes a second copy that drifts from the first, and one run's pull request body and log summary disagreed on a single count before anyone read either. Anything evidential that does appear follows *Write what stays true* in `SKILL.md`.
- **If the server is unreachable, do the hosting-platform work anyway**, and raise the outage the same day rather than only in your final report. *When the log is unreachable* above says what counts as unreachable and what raising it takes.

## Nothing to fix is a result

`findNoChange` exists because a dispatch that concludes there is nothing to fix has produced a real finding. Record it rather than leaving the dispatch open, and never manufacture a change to avoid using it.
