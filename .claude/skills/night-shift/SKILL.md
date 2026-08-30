---
name: night-shift
description: Work the queue of GitHub issues labelled `ready` in jinaga/jinaga.js, unattended. Use when sweeping for ready issues, deciding which are actually available to work, ordering them, opening a fix as a stacked pull request, or recording a blocking question instead of guessing. Covers the claim rule, the stacked-PR registration step, and the stop condition for PR monitoring.
---

# Night shift: working `ready` issues

This is the protocol for automated work on `jinaga/jinaga.js`. It exists so a scheduled agent can pick up work at night without a person watching, and so two agents never work the same issue twice.

Read `CLAUDE.md` first for build commands, subsystem layout, and testing rules.

## 1. Find the queue

Issues labelled `ready` are the queue. Nothing else is in scope. Do not pick up unlabelled issues, and do not add the `ready` label to anything yourself.

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

### When a merged pull request exists

Your job changes from *fix* to *verify*, and that is a complete and valuable outcome. Do not manufacture a change to justify the session.

1. Read the merged diff and any analysis document it added.
2. Enumerate every symptom the issue and its comments describe, separately. A large fix often resolves some and not others.
3. Test each symptom against current `main` and record a verdict per item.
4. If everything is resolved: open a pull request carrying only the regression coverage that is still missing, or open none at all if coverage is complete. Then comment on the issue with your per-symptom verdicts and evidence, and recommend closing.
5. If part survives: fix that part, and say plainly in the pull request which symptoms the earlier fix handled and which yours addresses.

**Never close an issue yourself, and never remove the `ready` label from an issue you believe is resolved.** Recommend, and let the maintainer decide. The one label change you may make is the question swap in section 6.

## 3. Order the work

Group the available issues by subsystem. Issues touching the same files are not independent, and running them in parallel produces conflicting patches for one root cause.

Within a group, sequence by dependency: the change that others build on goes first. A foundational fix (label registration, feed decomposition) precedes the issues that may fall out of it. When one issue is plausibly a duplicate of another's root cause, put it last and have it verify before it fixes.

Across groups, work in parallel freely.

## 4. Work the issue

Reproduce first. An issue's repro may be reconstructed rather than verified by its reporter; if it does not reproduce, that is a finding, not a failure.

Then fix, with a regression test that fails before and passes after. Keep the change minimal. Record anything you notice beyond the issue's scope as a note in the pull request rather than widening the diff.

Run `npm ci && npm run build && npm test` green before every push.

## 5. Open the pull request, stacked

Branch name: `claude/issue-<number>-<slug>`.

When your issue is sequenced behind another in the same subsystem, branch from **that issue's branch**, not from `main`, and open your pull request with its base set to that branch. This is a stacked pull request. It lets the chain proceed without waiting for anything to merge, and GitHub retargets each pull request to `main` automatically as the bases land.

### Registering the stack is required, not cosmetic

Setting base branches is necessary but not sufficient. `.github/workflows/main.yml` triggers on `pull_request` with `branches: [main]`, and that filter matches the pull request's **base**. An unregistered upper layer therefore gets **zero check runs**, not failing ones.

Registering the chain as a GitHub stack makes Actions fire as if every pull request in it targets `main`, and it also gives branch protections, required checks and CODEOWNERS evaluation against `main`, a stack map for reviewers, and bottom-up atomic merge.

There is no MCP tool for the Stacks API. Use the committed script, which is pre-approved for this repository:

```
./scripts/register-stack.sh list                       # inspect existing stacks
./scripts/register-stack.sh create <lower-pr> <upper-pr> [...]   # bottom to top, min 2
./scripts/register-stack.sh add <stack-number> <pr>    # append above the current top
```

Register as soon as the second pull request in a chain exists. Two timing notes:

- `pull_request.opened` never carries stack information, because a pull request is created before it joins a stack, and the `stacked` action is not among the workflow's default `pull_request` types. So an upper layer's first check run normally arrives on its **next push** after registration.
- Until then, absent checks are expected. **Never push an empty commit, and never close and reopen a pull request, to provoke a run.** `main.yml` declares `workflow_dispatch` if a run genuinely needs forcing.

## 6. When to stop and ask instead

Record a blocking question when proceeding either way could produce the wrong patch and you cannot settle it from the code, the tests, or the issue text. A question about a detail you can work around is not blocking: do everything that does not depend on the answer first.

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

**Stop when CI is green on the current head and that one Copilot round is complete**, either because Copilot left no suggested changes or because you have addressed all of them. Then unsubscribe. Do not cycle into further rounds.

Until both conditions hold, schedule a check-in roughly an hour out before ending a turn, and re-arm it each time.

## 8. Hard limits

- Never push to `main`, and never push to another session's branch.
- Never merge a pull request.
- Never close an issue, and never remove `ready` except as part of the question swap.
- Never skip, disable, or quarantine a test to get a green build.
- Never push an empty commit to re-trigger CI.
- End every GitHub comment with the Claude Code attribution footer.
- Do not put model identifiers in commit messages, pull request text, or code comments.
