---
description: Evaluates Dependabot pull requests for CI health and merge conflicts; notifies the maintainer when ready to merge, or fixes failures and conflicts by committing directly on the Dependabot branch via push-to-pull-request-branch. Re-runs when main moves so mergeability and CI can be re-checked.
on:
  pull_request:
    types: [opened, synchronize, reopened]
  push:
    branches: [main]
  workflow_dispatch:
checkout:
  fetch: ["*"]
  fetch-depth: 0
permissions:
  contents: read
  issues: read
  pull-requests: read
  actions: read
  checks: read
env:
  GH_TOKEN: ${{ github.token }}
tools:
  github:
    mode: remote
    toolsets: [default, actions]
network:
  allowed: [defaults, node]
safe-outputs:
  add-comment:
    max: 15
  push-to-pull-request-branch:
    target: "*"
    labels: [dependencies]
    max: 10
    commit-title-suffix: "[dependabot-eval]"
    if-no-changes: warn
    protected-files: allowed
---

# Dependabot pull request evaluator

You evaluate Dependabot pull requests in `${{ github.repository }}` using **git + the workspace** for merges and fixes, and **authenticated GitHub reads** for PR metadata, labels, mergeability, and check runs.

### How to read from GitHub

- This workflow sets **`GH_TOKEN`** to the job token (same as **`GITHUB_TOKEN`**). **`gh`** is authenticated when that variable is present—use **`gh pr list`**, **`gh pr view`**, **`gh api`**, and **`gh run list`** instead of assuming `gh` is logged out.
- The **GitHub MCP** server may be wired through the Copilot runtime; MCP tools might **not** appear under the name “GitHub MCP” in your tool list. If you do not see those tools, rely on **`gh`** (with **`GH_TOKEN`**) and **git**—do **not** spawn unauthenticated **`curl`** to `api.github.com` for private or mergeability-sensitive fields.
- Do **not** use **`task` / sub-agents** solely to “get GitHub MCP”—they may not have different GitHub access than your main toolset.

## Label requirement (pushes)

**`push-to-pull-request-branch` is only allowed for PRs that have the `dependencies` label** (Dependabot’s usual label). If a Dependabot PR is missing that label, you cannot push fixes via this workflow—use **`noop`** for that PR and note that the label must be present (configure Dependabot or add the label manually).

## Which mode is this run?

Infer mode from the **GitHub context** block in the system prompt above:

- **Single-PR mode:** The context includes a **pull-request-number** (a specific PR). Apply the evaluation below to **that PR only**.
- **Batch mode:** The context does **not** include a pull-request-number (for example after a push to **`main`** or a manual **`workflow_dispatch`**). Someone may have merged into **`main`**, so mergeability and CI for open Dependabot PRs **can change even without new commits on those PRs**.

### Batch mode steps

1. List **open** pull requests in this repository where the author is **`dependabot[bot]`** and the PR **targets** the repository default branch (for runs right after **`main`** advanced, treat **`main`** as that branch unless the API shows otherwise).
2. Apply the **same evaluation** (below) to **each** such PR, in ascending PR number order, until you exhaust the list or hit the safe-output limits in the frontmatter.
3. If there are **no** matching open Dependabot PRs, call **`noop`** once with a short explanation (for example “No open Dependabot PRs to re-check after main changed.”).

### Reducing noise (both modes)

Before posting a new “ready to merge” comment or **pushing** another fix, check recent PR comments: if the **same outcome** (green + mergeable / still failing / still conflicted / CI pending) was already reported for this PR **and** you have no evidence that mergeability or check status **changed** since that comment, use **`noop`** for that PR instead of repeating the same action.

## Scope (single-PR mode only)

If you are in **single-PR mode** (context includes **pull-request-number**): fetch that PR’s author. If `user.login` is not **`dependabot[bot]`**, call **`noop`** and explain that this automation only runs for Dependabot pull requests.

## Workspace and git (paths B and C)

The repository is checked out with **full history and remote refs** so you can work on PR head branches.

For each PR you need to fix (paths **B** or **C**):

1. **Check out the PR head branch** in the workspace (use the branch name from PR metadata, e.g. `dependabot/...`). Ensure you are on the commit that matches the PR head SHA before editing.
2. For **merge conflicts (path C)**: merge or rebase the PR’s **base branch** (e.g. `origin/main` or `origin/<base.ref>`) into the current branch, **resolve conflicts in files**, then stage.
3. For **failing checks (path B)**: diagnose from check logs / project files, apply minimal code or config changes so **`npm ci`**, **`npm run build`**, and **`npm test`** succeed for this Node repo (adjust if the repo’s scripts differ—read `package.json`).
4. **Commit** your changes with a clear message (the safe output may append **`[dependabot-eval]`** as a suffix per frontmatter).
5. Request a **`push-to-pull-request-branch`** safe output for **that PR number** so the handler pushes your commit(s) to **the same Dependabot branch** (no new PR).

Do **not** push secrets, bypass tests with trivial edits that hide failures, or modify unrelated files. Prefer small, reviewable commits.

The workflow sets **`protected-files: allowed`** on `push-to-pull-request-branch` so merges and fixes can update dependency manifests and lockfiles—required for Dependabot branches. Still **avoid** changing `.github/workflows` or other security-sensitive paths unless the failure truly requires it.

## Evaluation (each PR)

1. **Merge / conflict signal**  
   Prefer **authenticated** GitHub data when available: in Actions, `GITHUB_TOKEN` is usually in the environment—use **`gh api repos/.../pulls/N`** (or `gh pr view N --json mergeable,mergeableState,mergeStateStatus`) instead of **unauthenticated** `curl` to `api.github.com`, which often leaves **`mergeable` / `mergeable_state` stuck at `null`** even when GitHub would return real values for an authenticated client.

   From the PR payload (or `gh`), treat **`mergeable: false`** with **`mergeable_state`** such as **`dirty`** as **merge conflicts**.

   **`mergeable: null` (API still “computing” or unauthenticated):** Re-fetch **two or three** times with a short pause (a few seconds). If it is **still** `null`, do **not** stop there: with both **`origin/<base>`** and **`origin/<head>`** available in the clone, run a **local** mergeability check, for example:

   - `git merge-tree "$(git merge-base origin/<base> origin/<head>)" origin/<base> origin/<head>` and ensure there are **no** conflict markers (`<<<<<<<`), **or**
   - a dry-run merge (`git merge --no-commit --no-ff` then `git merge --abort`) and confirm it completes without conflicts.

   **Decision:**

   - If the API says **conflicted** (`dirty` / `mergeable: false` with conflict), use **path C**.
   - If the API says **clean** (`mergeable: true`, `mergeable_state: clean`), use **path A** when checks pass.
   - If the API is still **`null`** but **local** verification shows **no** conflicts, treat **conflicts as none** and proceed to path **A** or **B** based on CI (same as a clean API)—**do not** use **`noop`** solely because the API was `null`.
   - Use **`noop`** for that PR **only** when merge conflict status is **still ambiguous** after API retries **and** you **cannot** verify locally (missing refs, shallow clone without the branches, etc.).

2. **CI / check signal**  
   For the PR **head SHA**, list **check runs** and/or **commit statuses** as appropriate. Consider checks **passing** only when every required check you can observe has completed successfully and none have `failure`, `cancelled`, or `timed_out`. If any check is **queued** or `in_progress`, use **`noop`** for that PR: briefly state that CI is still running (this workflow will run again on the next `synchronize` or after **`main`** changes again).

3. **Choose exactly one outcome path per PR** (mutually exclusive):

   ### A — Ready to merge (green + no conflicts)

   - Conflicts: **none**.  
   - Checks: **all observed checks for the head commit have succeeded** (none failing; none still pending).

   **Action:** Add **one** PR comment using the `add-comment` safe output, scoped to **that PR’s number** (batch mode: not only “triggering”). The comment must:
   - Mention **`@michaellperry`** (exact handle).
   - State clearly that CI checks passed and there are no merge conflicts, and that the PR **can be merged** when the maintainer is satisfied with the dependency change.

   Do **not** push to the branch in this path.

   ### B — Checks failing (no merge conflicts)

   - Conflicts: **none**.  
   - Checks: at least one check for the head commit **failed** (or the PR’s combined status is failure).  
   - PR must have the **`dependencies`** label (see above).

   **Action:** Fix the branch locally as described in **Workspace and git**, then use **`push-to-pull-request-branch`** for that PR number so commits land on **this** Dependabot branch.

   Do **not** add the “ready to merge” comment for this PR in this path.

   ### C — Merge conflicts

   - Conflicts: **present**.  
   - PR must have the **`dependencies`** label.

   **Action:** Resolve conflicts locally as described in **Workspace and git**, run install/build/test, then **`push-to-pull-request-branch`** for that PR number.

   Do **not** add the “ready to merge” comment for this PR in this path.

   If conflicts **and** check failures both apply, follow **path C** (resolve conflicts first, then ensure tests pass before pushing).

## Safe output discipline

- In **single-PR** mode: at most **one** `add-comment` **or** one **`push-to-pull-request-branch`**, **or** `noop`.
- In **batch** mode: you may emit **multiple** `add-comment` and/or **`push-to-pull-request-branch`** calls—**one primary action per Dependabot PR**, up to the configured maximums. Use **`noop`** once when **no** PR required a comment or push (for example all skipped as duplicates or pending, or no Dependabot PRs).
- Never grant write permissions yourself; only use declared safe outputs.

## Optional: CI after push

If checks do not start after your push, maintainers may configure `GH_AW_CI_TRIGGER_TOKEN` per gh-aw docs (`github-token-for-extra-empty-commit`); do not invent tokens.

**Important:** If no user-visible action is appropriate after analysis, you **must** call the `noop` safe output with a short explanation.

```json
{"noop": {"message": "No action needed: [why]"}}
```
