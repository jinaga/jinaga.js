#!/usr/bin/env bash
#
# Register a chain of pull requests as a GitHub stack, or append to an existing one.
#
# GitHub's stacked pull requests are in public preview and are enabled on this
# repository. Setting each PR's base to the branch below it is necessary but not
# sufficient: until the chain is registered as a stack, GitHub treats the PRs as
# ordinary PRs with unusual bases.
#
# Registration is what holds every layer to the same bar. GitHub evaluates a
# stacked PR against the base of the stack rather than the branch it targets, so
# branch protections, required checks and CODEOWNERS all resolve against `main`,
# and the chain merges bottom-up as one atomic operation. Reviewers get a stack
# map as well.
#
# Register the moment the upper layer's PR exists. The Stacks API takes PR
# numbers, so the upper PR opens first and joins a stack second. Until you
# register it, it is an ordinary PR with an unusual base, and a workflow triggers
# only on `opened`, `synchronize` and `reopened`. Joining a stack fires none of
# the three, so the layer keeps whatever checks its `opened` event produced. Here
# that is a full set, because .github/workflows/main.yml carries no `branches:`
# filter. Registration then decides the merge gate.
#
# There is no MCP tool for the Stacks API, which is why this script exists: it
# gives automated sessions one narrow, allowlistable entry point instead of a
# general-purpose HTTP client. It talks to the API over curl, for containers
# where `gh` is absent — the night-shift worker is the caller it exists for.
#
# Usage:
#   scripts/register-stack.sh list
#   scripts/register-stack.sh create <pr> <pr> [<pr> ...]   # bottom to top, min 2
#   scripts/register-stack.sh add <stack_number> <pr> [...] # append above current top
#
# Requires GH_TOKEN or GITHUB_TOKEN with write access to pull requests. That is
# "Pull requests: Read and write" on a fine-grained token, `pull-requests: write`
# in an Actions workflow, or the `repo` scope on a classic token. The API reports
# the requirement itself as `X-Accepted-Github-Permissions: pull_requests=write`.
#
# Override the target repository with STACK_REPO=owner/name.

set -euo pipefail

REPO="${STACK_REPO:-jinaga/jinaga.js}"
API="https://api.github.com/repos/${REPO}"
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"

die() { printf 'register-stack: %s\n' "$1" >&2; exit 1; }

[ -n "$TOKEN" ] || die "no GH_TOKEN or GITHUB_TOKEN in the environment"

# Only ever accept bare positive integers. This keeps the allowlisted invocation
# from being widened by clever arguments. Validation must run in the calling
# shell, never inside a command substitution: `exit` in a substitution ends only
# the subshell, which would let a rejected argument through to the API.
# Pull request and stack numbers are always 1 or greater, so reject 0 and any
# leading-zero form here rather than letting the API reject them for us.
require_number() {
  case "$1" in
    ''|*[!0-9]*|0*) die "expected a positive integer, got '$1'" ;;
    *) : ;;
  esac
}

require_numbers() {
  local n
  for n in "$@"; do require_number "$n"; done
}

# Build a JSON array from already-validated positional arguments.
json_numbers() {
  local out="" n
  for n in "$@"; do out="${out:+$out,}$n"; done
  printf '[%s]' "$out"
}

call() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "$method"
    -H "Authorization: Bearer ${TOKEN}"
    -H "Accept: application/vnd.github+json"
    -w '\n%{http_code}')
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" -d "$body")
  curl "${args[@]}" "${API}${path}"
}

report() {
  local response="$1" expected="$2"
  local code="${response##*$'\n'}"
  local payload="${response%$'\n'*}"
  printf '%s\n' "$payload"
  case " $expected " in
    *" $code "*) printf 'HTTP %s\n' "$code" >&2 ;;
    *) printf 'HTTP %s (unexpected)\n' "$code" >&2; exit 1 ;;
  esac
}

cmd="${1:-}"
[ -n "$cmd" ] || die "usage: register-stack.sh {list|create|add} ..."
shift || true

case "$cmd" in
  list)
    # A 404 here means stacked PRs are not enabled for the repository.
    report "$(call GET /stacks)" "200"
    ;;
  create)
    [ "$#" -ge 2 ] || die "create needs at least 2 pull request numbers, bottom to top"
    require_numbers "$@"
    report "$(call POST /stacks "{\"pull_requests\":$(json_numbers "$@")}")" "201"
    ;;
  add)
    [ "$#" -ge 2 ] || die "add needs a stack number and at least 1 pull request number"
    stack="$1"; shift
    require_number "$stack"
    require_numbers "$@"
    report "$(call POST "/stacks/${stack}/add" "{\"pull_requests\":$(json_numbers "$@")}")" "200"
    ;;
  *)
    die "unknown command '$cmd' (expected list, create, or add)"
    ;;
esac
