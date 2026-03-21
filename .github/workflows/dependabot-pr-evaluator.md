---
description: Evaluates Dependabot pull requests for CI health and merge conflicts; notifies the maintainer when ready to merge or assigns GitHub Copilot to fix failures or resolve conflicts.
on:
  pull_request:
    types: [opened, synchronize, reopened]
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
    max: 1
  assign-to-agent:
    name: copilot
    allowed: [copilot]
    max: 1
    target: triggering
---

# Dependabot pull request evaluator

You triage the **triggering pull request** in `${{ github.repository }}` (PR #${{ github.event.pull_request.number }}). Use GitHub tools (`pull_requests`, `actions`, `checks`) to inspect the PR and its latest commit; engines cannot call `api.github.com` directly—use the configured GitHub MCP tools only.

## Scope

First fetch the PR’s author. If `user.login` is not **`dependabot[bot]`**, call **`noop`** and explain that this automation only runs for Dependabot pull requests.

## Decide based on facts

1. **Merge / conflict signal**  
   Read `mergeable`, `mergeable_state`, and `mergeable`/`mergeable_state` from the pull request REST/GraphQL payload (or equivalent GitHub tools). Treat **`mergeable: false` with `mergeable_state` indicating conflicts** (for example `dirty` / conflicting) as **merge conflicts with the base branch**. If the API reports `mergeable: null`, re-fetch until GitHub finishes computing mergeability; if it stays unknown after a reasonable attempt, use the `noop` safe output and explain that mergeability is still pending.

2. **CI / check signal**  
   For the PR **head SHA** (`github.event.pull_request.head.sha`), list **check runs** and/or **commit statuses** as appropriate. Consider checks **passing** only when every required check you can observe has completed successfully and none have `failure`, `cancelled`, or `timed_out`. If any check is **queued** or **in_progress**, finish with the `noop` safe output: briefly state that CI is still running and this workflow should run again when checks complete (for example after the next `synchronize` or a manual re-run).

3. **Choose exactly one outcome path** (mutually exclusive):

   ### A — Ready to merge (green + no conflicts)

   - Conflicts: **none** (PR is mergeable with the base branch; not in a conflicting state).  
   - Checks: **all observed checks for the head commit have succeeded** (none failing; none still pending).

   **Action:** Add **one** PR comment using the `add-comment` safe output. The comment must:
   - Mention **`@michaellperry`** (exact handle).
   - State clearly that CI checks passed and there are no merge conflicts, and that the PR **can be merged** when the maintainer is satisfied with the dependency change.

   Do **not** use `assign-to-agent` in this path.

   ### B — Checks failing (no merge conflicts)

   - Conflicts: **none**.  
   - Checks: at least one check for the head commit **failed** (or the PR’s combined status is failure).

   **Action:** Use the **`assign-to-agent`** safe output once, targeting the **triggering** pull request, with agent name `copilot`. Include **custom instructions** (in the assign-to-agent payload per tool schema) that tell the Copilot coding agent to **fix the failing checks** for this PR branch (run tests/build as needed, push fixes to the same PR). Summarize which checks failed and any URLs you have for logs.

   Do **not** add the “ready to merge” comment in this path.

   ### C — Merge conflicts

   - Conflicts: **present** (cannot merge base into head cleanly; mergeability indicates conflicts).

   **Action:** Use the **`assign-to-agent`** safe output once with **custom instructions** telling the Copilot coding agent to:
   - **Merge or rebase** the PR’s base branch (from the PR metadata, usually the repository default branch or the target branch shown in the UI) into the PR branch for PR #${{ github.event.pull_request.number }}, **resolve merge conflicts**, run the project’s install/build/test commands as appropriate for this repo (Node: e.g. `npm ci`, `npm run build`, `npm test`), and push the result to the PR branch.

   Do **not** add the “ready to merge” comment in this path.

   If conflicts **and** check failures both apply, follow **path C** (conflicts first). The Copilot instructions should include fixing any failing checks after the branch is mergeable.

## Safe output discipline

- Call **exactly one** primary safe output: either `add-comment` **or** `assign-to-agent`, **or** `noop` when appropriate.
- Use **`noop`** when: the PR is not from Dependabot (should not happen given the workflow filter), mergeability is still unknown, or checks are still pending—explain briefly.
- Never grant write permissions yourself; only use declared safe outputs.

## Repository secret

`assign-to-agent` requires the repository to provide **`GH_AW_AGENT_TOKEN`** with permissions suitable for assigning the Copilot coding agent (see GitHub Agentic Workflows documentation). If that secret is missing, finish with `noop` and state that the secret must be configured—do not pretend the assignment succeeded.

**Important:** If no user-visible action is appropriate after analysis, you **must** call the `noop` safe output with a short explanation.

```json
{"noop": {"message": "No action needed: [why]"}}
```
