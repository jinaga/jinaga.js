---
name: night-shift-worker
description: Works one GitHub issue through to a stacked pull request, unattended. Reproduces the defect or verifies a fix that already merged, fixes with a regression test, resolves a base branch that may not exist yet, registers the chain as a GitHub stack, drives CI green through one review round, then stops. Use when a scheduled routine or a person hands over a single issue number to work, when a merged pull request already exists and the job is verification rather than repair, when a fix must stack on a lower layer's branch, or when a blocker should become a recorded question instead of a guessed patch.
---

# Night Shift Worker

One dispatch, one issue, one pull request. This skill is the whole protocol for that unit of work, so an unattended run needs nothing from whoever dispatched it beyond an issue number.

Sweeping the queue, deciding what is available, and ordering issues into chains belong to `night-shift-coordinator`. Standing the system up belongs to `night-shift-setup`.

Your dispatch names an **issue**, and optionally a lower issue to stack on. If it names no issue, stop and say so.

## When to use

- **A dispatch names one issue** in this repository, and optionally a lower issue to stack on.
- **A merged pull request already covers the issue**, so the job is verification rather than repair.
- **A blocker cannot be settled** from the code, the tests, or the issue text.
- **A pull request is open and waiting** on CI or on a review round.

---

## What these instructions serve

Two purposes stand behind every rule in this skill and behind the dispatch that sent you.

**Progress.** The run exists to move the repository forward. Ambiguity that has an obvious resolution is not a reason to stall.

**Truthfulness.** What a run writes is checked against the real, current artifacts rather than assumed from prior wording. Read the released package, the merged diff, or the running system.

**Where an instruction's literal wording would violate the purpose it was written to serve, follow the purpose.** Then say so plainly in the pull request, under its own heading, as a factual report rather than an apology. A deviation you reported is a finding the maintainer needs. A deviation you buried is a defect.

---

## Before you start

Read `.night-shift/config.md` at the repository root. It carries everything about this repository that the protocol does not fix: what to read first, how to reproduce, which commands must be green, which workflow gates the merge, and what happens after the pull request opens.

**A missing file, or a missing required heading, is a stop.** Say which heading you could not find and open no pull request. Do not substitute a default. `configuring-a-repository.md` in the `night-shift-setup` skill lists the required headings.

**An open pull request on your issue does not mean a session is working it.** A worker that finished its round stopped with its pull request open, exactly as *Monitor the pull request, then stop* directs, and it now waits on a human to merge. Reading that as a live session is what strands an issue the first attempt left unfinished: the artifact of the partial work becomes the thing that blocks the rest of it.

The cost the check exists to prevent is **two sessions pushing different fixes for one issue**, and a re-fire, a manual dispatch, or a second sweep before the first one's work merges all arrive here looking exactly like a fresh assignment. So test whether a session is **live**, not whether a pull request exists. A live worker touches its pull request — it pushes, it comments, its checks run — and a stopped one cannot. Read the pull request once, and take one of three branches.

| What the pull request shows | What it means | What to do |
|---|---|---|
| A check run in progress, or a push, comment or review inside the last six hours | A session is live | Comment `Duplicate dispatch, no-op.` on the pull request and stop. |
| None of those for six hours, and some of the issue's acceptance is unmet | A session stopped before the issue was done | **Resume**, below. |
| None of those for six hours, and the pull request covers the acceptance | The work is done and a human has yet to merge | **Stop.** Leave no comment. |

Six hours is several times the longest wait this protocol asks a worker to hold, the 90 minutes in `stacking.md`. It is still a guess about a session you cannot see, so err long: too short puts two sessions on one branch, and too long costs one sweep.

**Check the acceptance clause by clause against the diff on the branch**, not against the pull request body, which says what its author set out to do. What counts as met is what the config's `## Before you fix` says counts. One unmet clause is enough to resume.

**Resume only a branch matching `claude/issue-<number>-*`.** That pattern is a worker's own branch for this issue and nothing else. A pull request that reaches you by a closing keyword on some other branch is someone else's work, whatever it says about your issue: treat it as live, no-op, and never push to it.

**To resume, push to the branch and the pull request that already exist.** First comment on the pull request naming the clauses you found unmet, so a session you have wrongly read as stopped can stand down. Then check that branch out as it stands and work the rest of this protocol against it — the regression test, the verification commands, one review round — fixing only what those clauses need. Opening a second pull request is what this check exists to prevent, and one branch and one pull request per issue still holds.

**Comment the no-op once, not once a sweep.** An issue re-dispatched against a long-lived pull request collects an identical comment on every fire, and they bury the thread a maintainer came to read. If `Duplicate dispatch, no-op.` is already on the pull request, stop without adding another.

Then copy this checklist and work it:

```
Task Progress:
- [ ] Read .night-shift/config.md and the files its `## Read first` names
- [ ] Check an open pull request on this issue, and no-op, resume or stop
- [ ] Open the Night Shift Log and resolve this repository
- [ ] Establish the work is warranted, per the config's `## Before you fix`
- [ ] Fix with a regression test that fails before, passes after, and can fail for a reason other than itself
- [ ] Run every command under `## Verification commands` green
- [ ] Resolve the base branch, push, open the pull request
- [ ] Register the stack, or record that registration is unavailable
- [ ] Confirm CI ran on this layer, by its `event`
- [ ] One review round, then stop
- [ ] Record the outcome, whatever it was
- [ ] Close the Night Shift Log console, before anything that can stop the run
- [ ] If the log was unreachable, send a push notification before stopping
- [ ] Run the config's `## After the pull request`
```

The container may hand you a working tree whose `origin/*` refs are older than the tree itself. Run `git fetch origin` before you read any remote ref, and never conclude that a branch or a file is missing from a ref you have not just fetched.

---

## Work the issue

**Establish that the work is warranted, exactly as `## Before you fix` in the config directs.** That heading is where a repository says what counts, and repositories differ. One asks you to reproduce a defect. Another has no defect to reproduce, because its issues are slices of an accepted specification, and points you at a spec section and the issue's conformance criteria instead. Do not assume the first: where a repository says there is nothing to reproduce, a missing repro is not a finding.

Where the config does ask for a repro and it fails, that is a finding rather than a failure. An issue's repro may have been reconstructed rather than verified by its reporter. Report it and open no pull request.

Then fix, with a regression test that fails before and passes after. Keep the change minimal. Record anything you notice beyond the issue's scope as a note in the pull request rather than widening the diff.

**A test earns its place by being able to fail for a reason other than someone editing the very thing it quotes.** Where the fix changes behavior, the regression test is that proof, it fails before and passes after, and it is not optional.

Where the fix changes only prose — a doc comment, a page, a README — a test that matches a sentence against itself proves nothing. The assertion is a second copy of its own subject, so the only edit that turns it red is a deliberate edit to that sentence. It makes the wording harder to improve and establishes nothing about whether the code is right. The same holds for an assertion that a default equals the literal the source assigns it, or that a config file contains a line it contains.

Derive one side instead, so both sides can move and the check still has bite: compile a documented example against the shipped build, resolve a documented path against the filesystem, read a default back out of the object the factory built. Each of those fails when the *code* changes, which is the failure a document cannot produce on its own. Where no derivation is available, say so in the pull request and let the change stand on review. A missing test you named is a finding the maintainer needs; a copy you wrote to fill the checkbox is a maintenance cost they did not ask for.

**Where the issue's own acceptance asks for the copy, that is a question, not an instruction to follow.** Record it per `## When to stop and ask instead`, because writing the test the issue asked for is what puts it in the suite.

Run every command under `## Verification commands` green before every push, in the order the config lists them.

When a merged pull request already covers the issue, your job changes from fix to verify. Read **[verifying-a-merged-fix.md](verifying-a-merged-fix.md)**.

---

## Open the pull request, stacked

Branch name: `claude/issue-<number>-<slug>`, unless the config's optional `## Branch prefix` says otherwise. The session harness may assign a branch of its own. Create this one instead and push only this one, because stacking and the claim check find a worker's branch by its issue number and a harness name carries none. Following this name is the protocol, so the pull request does not report it as a deviation.

With no stacking clause, branch from `origin/main` after fetching. When the dispatch names a lower issue, branch from **that issue's branch** and set it as your pull request base. Read **[stacking.md](stacking.md)** for how to resolve a branch that does not exist yet, how to register the chain, and how to confirm CI actually ran on your layer.

**Never fall back to `main`** when a lower layer's branch is absent. Branching from `main` while that work is missing renders it as deletions in your diff, which reads as a revert and passes review by looking small.

---

## Write what stays true

A pull request body is read long after it is written, and other pull requests merge in between. **Do not write a value into prose that another change can silently falsify.** A number that was accurate when you wrote it goes stale with nothing to detect it, and a reader has no way to tell which of your sentences still hold.

- **Report verification as what ran and what held.** Name the commands the config lists under `## Verification commands` and say they ran green from a clean checkout. Copy them from the config rather than from memory, because the set differs by repository and a remembered one misreports what ran. A total or a pass ratio is not verification.
- **Name a test by its description**, which survives a test inserted above it. Never cite a test by its position.
- **Do not state test totals or before-and-after counts.** The diff already shows what you added, and it cannot go stale.
- **Where a number genuinely carries the argument, pin it to what it measured**: a commit, a CI run id. A rate measured in one named run stays true of that run.

This holds for everything the run writes: the pull request body, a comment on the issue, a recorded question, and the log summary.

---

## When to stop and ask instead

Record a blocking question when proceeding either way could produce the wrong patch and you cannot settle it from the code, the tests, or the issue text. A question about a detail you can work around is not blocking, so do everything that does not depend on the answer first.

Record one **also** at the far end of a run, when the work is finished and the issue still is not: the shape does not reproduce anywhere you can reach, and settling it needs a capture from a live system, a reproduction repo, or an answer from the reporter. Left in the queue, an issue like that draws a fresh claim check every night and re-derives a verification that is already complete.

**A gap and a stale instruction are not the same thing, and only one of them is a question.**

A **genuine gap** is something nobody has decided yet. The issue does not say, the code does not settle it, and either choice could be the wrong patch. Raise it here and do not resolve it alone.

A **stale instruction** is something already decided, where the ground has since moved. A release now ships what the wording assumed absent, a dependency merged, or a measured fact changed. That is not a gap, and it does not need a maintainer to decide it again. Carry the decision out against current reality, and report the deviation from the literal wording in the pull request.

What separates them is what you would be deciding. Reading a settled decision against today's artifacts is your job. Changing what was decided is the maintainer's, and where the config forbids a change outright, that prohibition holds and the question is the only move.

To record a question:

1. Comment on the issue. State what you found, why it blocks you, the candidate answers, and what you would do under each. Make it answerable in one reply. If a pull request already exists, post it there too and link it from the issue comment.
2. Remove the queue label and add `question`.
3. Stop. Do not guess and push a speculative fix.

The label swap moves the issue out of the queue, so the next sweep will not pick it up again while it waits on an answer.

---

## Monitor the pull request, then stop

1. Subscribe to its activity.
2. Request a review.
3. Drive CI to green. A red check on your own pull request is work now, at every wake: diagnose, fix, push. If a failure is genuinely not yours, meaning it is red on the base branch too, say so in one comment rather than going silent.
4. Complete **one round** with the reviewer. Address every suggestion with a pushed commit, or reply on the thread explaining why it is wrong or out of scope. Resolve the threads you addressed.

A review comment is a claim, not a verdict. Verify it against the repository before you act on it, and check that your `origin/*` refs are current before you agree that something a reviewer named is missing. Reply with what you found either way.

**Stop when CI is green on the current head and that one review round is complete**, either because the reviewer left no suggested changes or because you have addressed all of them. Then unsubscribe. Do not cycle into further rounds. Until both conditions hold, schedule a check-in before ending a turn, and re-arm it each time.

**A resume comment means stand down.** A later dispatch that reads your pull request as stopped says so on it, naming the acceptance it found unmet. One posted after your last push means that session now owns the branch: reply once that you are standing down, unsubscribe, and stop. Two sessions pushing to one branch is the failure the duplicate check exists to prevent, and yielding to the newer one always terminates, because it only resumed after you had gone quiet.

**Check-run events name a stale head.** An event can arrive for a commit the pull request has already moved past, so acting on the SHA in the event can declare green on a commit that is no longer current. Always re-read the pull request's own head before concluding anything about its state, and treat the event as a nudge to look rather than as a report of what is true.

---

## Record the run

Every outcome goes in the Night Shift Log, including "nothing to fix", and **every run closes the console it opened**, including one that stopped before it got here. Read **[night-shift-log.md](night-shift-log.md)**.

Only then run the config's `## After the pull request`. A value of `none` means there is nothing to do; an absent heading means stop. **The close comes first because that stop is real**: a run that reaches an absent heading ends there, and a console it has not closed by then is one it never closes.

---

## Hard limits

- Never push to `main`, and never push to a branch a live session holds. Resuming a stopped session's branch, under *Before you start*, is the only exception.
- Never merge a pull request.
- Never close an issue, and never remove the queue label except as part of the question swap.
- Never skip, disable, or quarantine a test to get a green build.
- Never push an empty commit, and never close and reopen a pull request, to re-trigger CI.
- Never fall back to `main` as a base when a lower layer's branch is absent.
- Never dispatch another issue's worker. You are one layer.
- Never put a mutating call in a retry or fallback position. A shell `cmd-a || cmd-b` runs `cmd-b` when `cmd-a` merely prints something unexpected, and a "test" invocation of a create endpoint is a real write.
- End every comment you leave on an issue or a pull request with your agent attribution footer.
- Do not put model identifiers in commit messages, pull request text, or code comments.

## Resources

| Resource | Purpose |
|---|---|
| [stacking.md](stacking.md) | Resolving a base branch, registering the chain, confirming a run by its `event` |
| [verifying-a-merged-fix.md](verifying-a-merged-fix.md) | What to do when a fix already landed |
| [night-shift-log.md](night-shift-log.md) | Recording the outcome of a dispatch |
| [scripts/register-stack.sh](scripts/register-stack.sh) | Execute. Registers a chain of pull requests as a GitHub stack |
