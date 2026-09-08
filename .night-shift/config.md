# Night shift configuration

The `night-shift-worker` and `night-shift-coordinator` skills read this file.
Every `##` heading below except `## Branch prefix` is required. A missing
heading is an error, not a default: stop and name the heading you could not
find. Anything that is not one of these headings is protocol, and protocol
lives in the skill.

## Visibility

`public`

There is nothing to withhold here. One sibling repository in this practice is
private, so never carry its contents into an issue or pull request in this one.

## Issue label

`ready`

## Read first

- `CLAUDE.md` — layout, conventions, and how this library is built and tested.

## Before you fix

Reproduce first. An issue's repro may have been reconstructed rather than
verified by its reporter, so a repro that fails is a finding, not a failure.
Report it and open no pull request.

This is a published library, so a defect a reporter hit on a released version
may already be fixed on `main`. Check which version the report ran against
before concluding the shape is broken here.

## Verification commands

Green before every push, in this order.

```
npm ci
npm run build
npm test
```

The container starts with no `node_modules`, so `npm ci` is not optional.

## CI workflow

`main.yml`

Read runs for this file; it is the merge gate. It runs on a bare
`pull_request:` with no `branches:` filter, so every layer of a stack gets
check runs from its own pull request event.

Five workflows live in `.github/workflows/`, and four of them are release and
publish jobs that do not gate a pull request. Address the workflow by this file
name rather than by a display name.

## After the pull request

`none`

## What is different about this repository

This is a maintained library whose queue is mostly defect reports from people
outside the project, rather than work a maintainer has already sequenced. Two
things follow.

An issue may not reproduce at all, and saying so with evidence is the whole
result. Do not manufacture a fix to justify the session.

Attribution is easy to get wrong. When a fix appears to resolve an issue, check
that the issue's shape was actually broken at the version the reporter ran,
rather than assuming the nearest merged pull request is the cause.

`clear-ready-on-close.yml` removes the `ready` label when an issue closes. Do
not rely on it: always filter for open issues.
