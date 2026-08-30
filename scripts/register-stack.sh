#!/usr/bin/env bash
#
# Register a chain of pull requests as a GitHub stack, or append to an existing one.
#
# GitHub's stacked pull requests are in public preview and are enabled on this
# repository. Setting each PR's base to the branch below it is necessary but NOT
# sufficient: until the chain is registered as a stack, GitHub treats the PRs as
# ordinary PRs with unusual bases. In particular .github/workflows/main.yml runs
# `on: pull_request: branches: [main]`, and that filter matches the PR's BASE, so
# an unregistered upper layer gets zero check runs. Once registered, GitHub
# triggers workflows as if every PR in the stack targets the stack base (main).
#
# There is no MCP tool for the Stacks API, which is why this script exists: it
# gives automated sessions one narrow, allowlistable entry point instead of a
# general-purpose HTTP client.
#
# Usage:
#   scripts/register-stack.sh list
#   scripts/register-stack.sh create <pr> <pr> [<pr> ...]   # bottom to top, min 2
#   scripts/register-stack.sh add <stack_number> <pr> [...] # append above current top
#
# Requires GH_TOKEN or GITHUB_TOKEN with pull_requests write.
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
require_number() {
  case "$1" in
    ''|*[!0-9]*) die "expected a positive integer, got '$1'" ;;
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
