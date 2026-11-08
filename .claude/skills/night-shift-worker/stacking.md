# Stacking a pull request on a lower layer

A dispatch names the **issue** you stack on, never the branch, because the branch carries a slug only its own worker chooses. Resolve it by pattern, and expect to wait.

## Resolving a base branch that is not ready yet

The lower branch can fail to serve in two ways: it is absent, or it is present but lacks work your issue needs. Both mean the same thing, that the lower worker is not finished, and both get the same wait. **Re-check every 5 minutes for up to 90 minutes from your first look, re-arming a check-in rather than blocking.** That one window covers both states.

1. `git fetch origin`, then match `origin/claude/issue-<M>-*`. Confirm against the hosting API rather than a cached ref.
2. **No match means the lower worker has not pushed yet.** Its session is running concurrently with yours. Re-check inside the window.
3. **Once it matches, check that it carries what your issue depends on.** For every other issue on your issue's **Depends on** line that has not merged, match its branch the same way and confirm it is an ancestor of #M's branch: `git merge-base --is-ancestor origin/<dependency-branch> origin/<M-branch>`. One that is not means #M's worker based its layer wrongly. It often corrects itself within minutes, so re-check inside the window. **A dependency that has not merged and has no branch is missing work too**: its worker has not pushed yet, or nobody is working it. Re-check it inside the same window.
4. Once the branch matches and every check passes, branch from it and set it as your pull request base.
5. If the window closes with no branch, report that issue #M produced no branch, and **open no pull request**.
6. If the window closes with the branch still missing a dependency, record a question per *When to stop and ask instead* in `SKILL.md`, naming #M and the issue whose work its branch lacks, and **open no pull request**.

Idle waiting is the correct behavior here. A layer that gives up and branches from `main` produces a diff that deletes the layer below it. A layer that bases on the dependency's branch instead of #M's makes itself a sibling of #M, and the chain forks the moment #M's worker corrects its own base.

## Registering the stack

Setting base branches is necessary but not sufficient. Until the chain is registered as a stack, the host treats the pull requests as ordinary ones with unusual bases.

Registration buys two things always: the chain merges bottom-up as one operation, and reviewers get a stack map. Where branch protection is configured, it buys a third — the host evaluates a stacked pull request against the base of the stack rather than the branch it targets, so protections, required checks and code ownership all resolve against `main`.

**Register the moment the upper layer's pull request exists.** The Stacks API takes pull request numbers, so the upper pull request opens first and joins a stack second.

Run the script from the repository root. Execute it; do not read it and reimplement it.

```
bash .claude/skills/night-shift-worker/scripts/register-stack.sh list
bash .claude/skills/night-shift-worker/scripts/register-stack.sh create <lower-pr> <upper-pr> [...]
bash .claude/skills/night-shift-worker/scripts/register-stack.sh add <stack-number> <pr>
```

`create` takes pull request numbers bottom to top and needs at least two. Use it when yours is the second layer and no stack exists. Use `add` when a stack already holds your base's pull request. **Run it once and report its exact output and HTTP status. Never retry.**

The script reads the repository from `git remote get-url origin`. Set `STACK_REPO=owner/name` only when the remote is not the repository you mean.

### When stacks are not available

Stacked pull requests are enabled per repository, so run `list` once before you open the upper pull request. **Exit status 3 means they are not enabled here.** That is not a failure of your run:

1. Set the base branch correctly anyway. The chain is still a chain.
2. Call neither `create` nor `add`.
3. Say in the pull request body that the chain is correctly based but unregistered, and name the layer below.
4. Continue to CI and the review round as normal.

Exit 1 is a usage or precondition error and needs fixing before you proceed. **A wrong stack number is exit 1, not exit 3**: `add` distinguishes them by probing the collection, so a 404 that means *this number does not exist* does not get read as *this repository cannot stack*. Check the number with `list` and run `add` again. Exit 0 is success.

## Confirm a run happened, by its `event`

Read each layer's run through its `event` field, not its conclusion. A green check says a run passed. It does not say which trigger produced it, and a layer whose only run came from a manual dispatch is not being checked by its own pull request.

This matters most right after registration. A workflow triggers only on `opened`, `synchronize` and `reopened`; joining a stack fires none of the three, so a layer keeps whatever checks its `opened` event produced. Whether that was a full set depends on the workflow, which the config's `## CI workflow` names.

Scope the lookup to one workflow and one branch. An unscoped listing returns tens of kilobytes and will overflow a tool result. Address the workflow by its **file name**, taken from the config, not by matching a display name: a run's `name` is the *run* name, which a workflow can override, so a name filter that stops matching returns nothing, which reads exactly like "CI never ran."

The filter takes a **branch**. Match `head_sha` yourself against the rows it returns rather than asking the filter for a SHA.

Only if a layer shows no run at all, dispatch the workflow yourself and **report that as a finding** rather than as routine. Never push an empty commit, and never close and reopen a pull request, to provoke a run.

This is the same genus of mistake as reading a pull request's `merged` field without `merged_at`. A surface field that reads like an answer is not one until you know what populates it.
