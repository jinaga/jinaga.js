#!/usr/bin/env bash
#
# Register a chain of pull requests as a GitHub stack, or append to an existing one.
#
# See SKILL.md (night-shift-worker skill), and stacking.md, for when to run this
# and what to do with each outcome.
#
# There is no MCP tool for the Stacks API, which is why this script exists: it
# gives an automated session one narrow, allowlistable entry point instead of a
# general-purpose HTTP client. It talks to the API over curl, so it works in a
# container where `gh` is absent.
#
# Usage:
#   register-stack.sh list
#   register-stack.sh create <pr> <pr> [<pr> ...]   # bottom to top, min 2
#   register-stack.sh add <stack_number> <pr> [...] # append above current top
#
# Exit status:
#   0  success
#   1  usage or precondition error (bad argument, no token, no repository)
#   3  stacked pull requests are not enabled for the repository
#
# Requires `curl` and `git`, both of which are present in a standard Claude Code
# container. Nothing else is needed, and `gh` in particular is not.
#
# The repository is read from `git remote get-url origin`. Override it with
# STACK_REPO=owner/name when the remote is not the repository you mean, such as
# in a fork or a mirror.
#
# Requires GH_TOKEN or GITHUB_TOKEN with write access to pull requests. That is
# "Pull requests: Read and write" on a fine-grained token, `pull-requests: write`
# in an Actions workflow, or the `repo` scope on a classic token. The API reports
# the requirement itself as `X-Accepted-Github-Permissions: pull_requests=write`.

set -euo pipefail

die() { printf 'register-stack: %s\n' "$1" >&2; exit 1; }

# Sets REPO in the calling shell rather than printing it. `exit` inside a
# command substitution ends only the subshell, so a `die` in a substituted
# function cannot stop the script. Assigning here keeps every failure fatal.
derive_repo() {
  local url
  git rev-parse --show-toplevel >/dev/null 2>&1 \
    || die "not inside a git working tree; run from the repository root, or set STACK_REPO=owner/name"
  url="$(git remote get-url origin 2>/dev/null)" \
    || die "no 'origin' remote; set STACK_REPO=owner/name"
  url="${url%.git}"
  case "$url" in
    git@github.com:*)       url="${url#git@github.com:}" ;;
    ssh://git@github.com/*) url="${url#ssh://git@github.com/}" ;;
    https://github.com/*)   url="${url#https://github.com/}" ;;
    http://github.com/*)    url="${url#http://github.com/}" ;;
    *) die "origin '$url' is not a github.com remote; set STACK_REPO=owner/name" ;;
  esac
  case "$url" in
    */*/*|/*|*/) die "cannot read owner/name from origin '$url'; set STACK_REPO=owner/name" ;;
    */*)         REPO="$url" ;;
    *)           die "cannot read owner/name from origin '$url'; set STACK_REPO=owner/name" ;;
  esac
}

if [ -n "${STACK_REPO:-}" ]; then
  REPO="$STACK_REPO"
else
  REPO=""
  derive_repo
fi

API="https://api.github.com/repos/${REPO}"
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"

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

# A 404 is its own outcome, not a generic failure. Stacked pull requests are in
# public preview and are enabled per repository, so a caller has to be able to
# tell "this repository cannot do stacks" from "this call was wrong".
report() {
  local response="$1" expected="$2" not_found="$3"
  local code="${response##*$'\n'}"
  local payload="${response%$'\n'*}"
  printf '%s\n' "$payload"
  case " $expected " in
    *" $code "*) printf 'HTTP %s\n' "$code" >&2; return 0 ;;
  esac
  if [ "$code" = "404" ]; then
    printf 'HTTP 404\n' >&2
    printf 'register-stack: %s\n' "$not_found" >&2
    exit 3
  fi
  printf 'HTTP %s (unexpected)\n' "$code" >&2
  exit 1
}

NOT_ENABLED="stacked pull requests are not enabled for ${REPO}"

cmd="${1:-}"
[ -n "$cmd" ] || die "usage: register-stack.sh {list|create|add} ..."
shift || true

case "$cmd" in
  list)
    report "$(call GET /stacks)" "200" "$NOT_ENABLED"
    ;;
  create)
    [ "$#" -ge 2 ] || die "create needs at least 2 pull request numbers, bottom to top"
    require_numbers "$@"
    report "$(call POST /stacks "{\"pull_requests\":$(json_numbers "$@")}")" "201" "$NOT_ENABLED"
    ;;
  add)
    [ "$#" -ge 2 ] || die "add needs a stack number and at least 1 pull request number"
    stack="$1"; shift
    require_number "$stack"
    require_numbers "$@"
    report "$(call POST "/stacks/${stack}/add" "{\"pull_requests\":$(json_numbers "$@")}")" "200" \
      "${NOT_ENABLED}, or stack ${stack} does not exist"
    ;;
  *)
    die "unknown command '$cmd' (expected list, create, or add)"
    ;;
esac
