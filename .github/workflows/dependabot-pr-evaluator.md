---
description: Evaluates Dependabot pull requests for CI health and merge conflicts; notifies the maintainer when ready to merge or assigns GitHub Copilot to fix failures or resolve conflicts. Re-runs when main moves so mergeability and CI can be re-checked.
on:
  pull_request:
    types: [opened, synchronize, reopened]
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  issues: read
  pull-requests: read
  actions: read
  checks: read
tools:
  github:
    mode: remote
    toolsets: [default, actions]
network:
  allowed: [defaults, node]
safe-outputs:
  add-comment:
    max: 15
  assign-to-agent:
    name: copilot
    allowed: [copilot]
    max: 15
    target: "*"
---

# Dependabot pull request evaluator

You evaluate Dependabot pull requests in `${{ github.repository }}` using GitHub tools (`pull_requests`, `actions`, `checks`). Engines cannot call `api.github.com` directly—use the configured GitHub MCP tools only.

## Which mode is this run?

The workflow is triggered by **`${{ github.event_name }}`**.

### Single-PR mode (`pull_request`)

There is one **triggering** pull request (number from the event). Apply the evaluation below to **that PR only**.

### Batch mode (`push` to `main`, or `workflow_dispatch`)

Someone may have merged into **`main`**, so mergeability and CI for open Dependabot PRs **can change even without new commits on those PRs**.

1. List **open** pull requests in this repository where the author is **`dependabot[bot]`** and the PR **targets** the same default branch that was pushed (for `push` events, treat **`main`** as the branch that advanced—use the repository’s default branch from API if you need to confirm).
2. Apply the **same evaluation** (below) to **each** such PR, in ascending PR number order, until you exhaust the list or hit the safe-output limits in the frontmatter.
3. If there are **no** matching open Dependabot PRs, call **`noop`** once with a short explanation (for example “No open Dependabot PRs to re-check after main changed.”).

### Reducing noise (both modes)

Before posting a new “ready to merge” comment or assigning the agent again, check recent PR comments: if the **same outcome** (green + mergeable / still failing / still conflicted / CI pending) was already reported for this PR **and** you have no evidence that mergeability or check status **changed** since that comment, use **`noop`** for that PR instead of repeating the same action.

## Scope (single-PR mode only)

If the run was triggered by **`pull_request`**: fetch the PR’s author. If `user.login` is not **`dependabot[bot]`**, call **`noop`** and explain that this automation only runs for Dependabot pull requests.

## Evaluation (each PR)

1. **Merge / conflict signal**  
   Read `mergeable`, `mergeable_state`, and related fields from the pull request payload. Treat **`mergeable: false` with `mergeable_state` indicating conflicts** (for example `dirty`) as **merge conflicts with the base branch**. If the API reports `mergeable: null`, re-fetch until GitHub finishes computing mergeability; if it stays unknown after a reasonable attempt, use **`noop`** for that PR and explain that mergeability is still pending.

2. **CI / check signal**  
   For the PR **head SHA**, list **check runs** and/or **commit statuses** as appropriate. Consider checks **passing** only when every required check you can observe has completed successfully and none have `failure`, `cancelled`, or `timed_out`. If any check is **queued** or **in_progress**, use **`noop`** for that PR: briefly state that CI is still running (this workflow will run again on the next `synchronize` or after **`main`** changes again).

3. **Choose exactly one outcome path per PR** (mutually exclusive):

   ### A — Ready to merge (green + no conflicts)

   - Conflicts: **none**.  
   - Checks: **all observed checks for the head commit have succeeded** (none failing; none still pending).

   **Action:** Add **one** PR comment using the `add-comment` safe output, scoped to **that PR’s number** (batch mode: not only “triggering”). The comment must:
   - Mention **`@michaellperry`** (exact handle).
   - State clearly that CI checks passed and there are no merge conflicts, and that the PR **can be merged** when the maintainer is satisfied with the dependency change.

   Do **not** use `assign-to-agent` for this PR in this path.

   ### B — Checks failing (no merge conflicts)

   - Conflicts: **none**.  
   - Checks: at least one check for the head commit **failed** (or the PR’s combined status is failure).

   **Action:** Use the **`assign-to-agent`** safe output once **for that PR number**, with agent name `copilot`. Include **custom instructions** that tell the Copilot coding agent to **fix the failing checks** for this PR branch (run tests/build as needed, push fixes to the same PR). Summarize which checks failed and any URLs you have for logs.

   Do **not** add the “ready to merge” comment for this PR in this path.

   ### C — Merge conflicts

   - Conflicts: **present**.

   **Action:** Use **`assign-to-agent`** once **for that PR number** with **custom instructions** telling the Copilot coding agent to:
   - **Merge or rebase** the PR’s **base branch** (from PR metadata) into the PR branch, **resolve merge conflicts**, run the project’s install/build/test commands as appropriate for this repo (Node: e.g. `npm ci`, `npm run build`, `npm test`), and push the result to the PR branch.

   Do **not** add the “ready to merge” comment for this PR in this path.

   If conflicts **and** check failures both apply, follow **path C** (conflicts first). The Copilot instructions should include fixing any failing checks after the branch is mergeable.

## Safe output discipline

- In **single-PR** mode: at most **one** `add-comment` **or** one `assign-to-agent`, **or** `noop`.
- In **batch** mode: you may emit **multiple** `add-comment` and/or `assign-to-agent` calls—**one primary action per Dependabot PR**, up to the configured maximums. Use **`noop`** once to report “nothing to do” only when **no** PR required a comment or assignment (for example all skipped as duplicates or pending, or no Dependabot PRs).
- Never grant write permissions yourself; only use declared safe outputs.

## Repository secret

`assign-to-agent` requires the repository to provide **`GH_AW_AGENT_TOKEN`** with permissions suitable for assigning the Copilot coding agent (see GitHub Agentic Workflows documentation). If that secret is missing, finish with `noop` and state that the secret must be configured—do not pretend the assignment succeeded.

**Important:** If no user-visible action is appropriate after analysis, you **must** call the `noop` safe output with a short explanation.

```json
{"noop": {"message": "No action needed: [why]"}}
```
