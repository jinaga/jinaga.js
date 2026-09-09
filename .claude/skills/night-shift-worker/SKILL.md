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

**If an open pull request already references your issue, comment `Duplicate dispatch, no-op.` and stop.** The dispatcher's claim check is supposed to prevent this, but it only sees one sweep. A re-fire, a manual dispatch, or a second sweep before the first one's work merges all arrive here looking exactly like a fresh assignment, and the cost of not checking is two sessions pushing different fixes for one issue.

Then copy this checklist and work it:

```
Task Progress:
- [ ] Read .night-shift/config.md and the files its `## Read first` names
- [ ] Check for an open pull request already referencing this issue
- [ ] Open the Night Shift Log and resolve this repository
- [ ] Establish the work is warranted, per the config's `## Before you fix`
- [ ] Fix with a regression test that fails before and passes after
- [ ] Run every command under `## Verification commands` green
- [ ] Resolve the base branch, push, open the pull request
- [ ] Register the stack, or record that registration is unavailable
- [ ] Confirm CI ran on this layer, by its `event`
- [ ] One review round, then stop
- [ ] Record the outcome, then run `## After the pull request`
```

The container may hand you a working tree whose `origin/*` refs are older than the tree itself. Run `git fetch origin` before you read any remote ref, and never conclude that a branch or a file is missing from a ref you have not just fetched.

---

## Work the issue

**Establish that the work is warranted, exactly as `## Before you fix` in the config directs.** That heading is where a repository says what counts, and repositories differ. One asks you to reproduce a defect. Another has no defect to reproduce, because its issues are slices of an accepted specification, and points you at a spec section and the issue's conformance criteria instead. Do not assume the first: where a repository says there is nothing to reproduce, a missing repro is not a finding.

Where the config does ask for a repro and it fails, that is a finding rather than a failure. An issue's repro may have been reconstructed rather than verified by its reporter. Report it and open no pull request.

Then fix, with a regression test that fails before and passes after. Keep the change minimal. Record anything you notice beyond the issue's scope as a note in the pull request rather than widening the diff.

Run every command under `## Verification commands` green before every push, in the order the config lists them.

When a merged pull request already covers the issue, your job changes from fix to verify. Read **[verifying-a-merged-fix.md](verifying-a-merged-fix.md)**.

---

## Open the pull request, stacked

Branch name: `claude/issue-<number>-<slug>`, unless the config's optional `## Branch prefix` says otherwise.

With no stacking clause, branch from `origin/main` after fetching. When the dispatch names a lower issue, branch from **that issue's branch** and set it as your pull request base. Read **[stacking.md](stacking.md)** for how to resolve a branch that does not exist yet, how to register the chain, and how to confirm CI actually ran on your layer.

**Never fall back to `main`** when a lower layer's branch is absent. Branching from `main` while that work is missing renders it as deletions in your diff, which reads as a revert and passes review by looking small.

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

**Check-run events name a stale head.** An event can arrive for a commit the pull request has already moved past, so acting on the SHA in the event can declare green on a commit that is no longer current. Always re-read the pull request's own head before concluding anything about its state, and treat the event as a nudge to look rather than as a report of what is true.

---

## Record the run

Every outcome goes in the Night Shift Log, including "nothing to fix". Read **[night-shift-log.md](night-shift-log.md)**.

Then run the config's `## After the pull request`. A value of `none` means there is nothing to do; an absent heading means stop.

---

## Hard limits

- Never push to `main`, and never push to another session's branch.
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
