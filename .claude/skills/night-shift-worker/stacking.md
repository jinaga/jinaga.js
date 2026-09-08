# Stacking a pull request on a lower layer

A dispatch names the **issue** you stack on, never the branch, because the branch carries a slug only its own worker chooses. Resolve it by pattern, and expect to wait.

## Resolving a base branch that does not exist yet

1. `git fetch origin`, then match `origin/claude/issue-<M>-*`. Confirm against the hosting API rather than a cached ref.
2. No match means the lower worker has not pushed yet. Its session is running concurrently with yours. Re-check every 5 minutes for up to 90 minutes, re-arming a check-in rather than blocking.
3. Once it matches, branch from it and set it as your pull request base.
4. If it never appears, report that issue #M produced no branch, and **open no pull request**.

Idle waiting is the correct behavior here. A layer that gives up and branches from `main` produces a diff that deletes the layer below it.

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

Exit 1 is a usage or precondition error and needs fixing before you proceed. Exit 0 is success.

## Confirm a run happened, by its `event`

Read each layer's run through its `event` field, not its conclusion. A green check says a run passed. It does not say which trigger produced it, and a layer whose only run came from a manual dispatch is not being checked by its own pull request.

This matters most right after registration. A workflow triggers only on `opened`, `synchronize` and `reopened`; joining a stack fires none of the three, so a layer keeps whatever checks its `opened` event produced. Whether that was a full set depends on the workflow, which the config's `## CI workflow` names.

Scope the lookup to one workflow and one branch. An unscoped listing returns tens of kilobytes and will overflow a tool result. Address the workflow by its **file name**, taken from the config, not by matching a display name: a run's `name` is the *run* name, which a workflow can override, so a name filter that stops matching returns nothing, which reads exactly like "CI never ran."

The filter takes a **branch**. Match `head_sha` yourself against the rows it returns rather than asking the filter for a SHA.

Only if a layer shows no run at all, dispatch the workflow yourself and **report that as a finding** rather than as routine. Never push an empty commit, and never close and reopen a pull request, to provoke a run.

This is the same genus of mistake as reading a pull request's `merged` field without `merged_at`. A surface field that reads like an answer is not one until you know what populates it.
