# Recording a dispatch in the Night Shift Log

A run that leaves no trace teaches nothing. The host keeps the artifacts — a pull request, a comment, a label — but not the judgments, and those die with the container unless you record them.

The log is a Jinaga application reached through the Factual MCP server. Open a console, run `applications`, and open the one whose routing matches. That console is yours to close, and *Close the console, on every exit path* below says when and why. **Its manifest carries the full action catalog with argument guidance, so run `describe <action>` there rather than trusting an argument list in this file.**

## The whole shape, for orientation

The coordinator performs steps 1 to 5, before your session exists. You perform 6. A person performs 7 in the morning, through `night-shift-review`.

1. `practicesForAdministrator` — resolve the practice and this repository. *(coordinator)*
2. `startNightlySweep` — once per repository per sweep, filed under the night. *(coordinator)*
3. `correctedVerdicts` and the previous `considerationsInSweep`. *(coordinator)*
4. `considerIssue`, then exactly one finding action. *(coordinator)*
5. `dispatchWork` or `skipIssue`. *(coordinator)*
6. **`openPullRequest`, `raiseQuestion`, or `findNoChange`** — exactly one, when your dispatch finishes. *(you)*
7. `answerQuestion`, or `correctVerdict`. *(a person, in the morning review)*

`correctVerdictFromWork` stays yours. When your work disproves a conclusion recorded about another issue, record it naming the consideration whose work produced the disproof.

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

**`close_console` is the last log step of every run, including a run that stops early.** Every routine in a practice runs as one identity, and the server lets that identity hold 16 consoles that hold work: unpublished definitions or manifest edits, or staged facts, which is the `dirty` flag `list_consoles` reports. A console holding nothing takes no slot, whether it is bound or not. So a run that stops with staged facts it never committed, inside a `begin` or after a batch cut short, keeps a slot the next run needs, until the server's retention period closes the console and discards its working copy. The server's own `create_console` description states both periods. Closing the console is what gives the slot back, and it also discards anything the run staged and never meant to keep.

**The paths that leak are the ones that stop early**, because the close sits at the bottom of a procedure they never reach. A stop for a missing config heading or a missing file, a duplicate dispatch that no-ops, a repro that failed, a recorded question, a fix abandoned on a blocker. Close the console on each of them.

**A refused `create_console` means 16 consoles hold work, and none of them is yours.** `console_limit` comes back with a `candidates` list naming those consoles, each with its binding, its `dirty` flag and its staged-fact count. Every one belongs to a session that is not yours. Running a batch in one would commit or publish its work under cover of your own, and closing one would discard it. **So work in none of them and close none of them**, and the same holds for a console you find through `list_consoles`.

**A pool full of work is not an outage, and it does not block the run.** Do the hosting-platform work, and report the run unrecorded, naming a full console pool as the reason and listing the candidates the refusal named, so a person can see which sessions hold the slots. The two read alike in a report and have different remedies: a full pool was caused by earlier runs that stopped while holding staged facts or unpublished edits, and an outage belongs to whoever owns the connector.

## When the log is unreachable

**Unreachable means the server cannot be reached at all**, and it has exactly two shapes: its tools are absent from the session, or its connector reports that it needs authorization. A `console_limit` refusal is neither, because the server answered; a full pool is the section above.

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

**A duplicate dispatch that stops is a finding too.** When the duplicate check in `SKILL.md` stops you, because a live session holds the issue or because the work is done and waits on a merge, record `findNoChange` saying which, and name the evidence the row asks for. That is the only trace this dispatch leaves: it pushed nothing and opened nothing, so no later read can tie it to an artifact.
