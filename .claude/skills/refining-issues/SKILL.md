---
name: refining-issues
description: Turns a backlog issue in a night-shift repository into one that an unattended agent can implement, and turns a coupled set into a chain that stacks. Use when auditing whether an issue is ready for the queue label, when grouping issues for planning, when an issue's acceptance ends in an unmade decision, when two issues must land together, when an issue asks for a test that guards a redundancy rather than removing it or manufactures one by quoting a document, or when a change to an authority document has just changed how a set of issues is partitioned. Encodes eight checks — five that decide readiness and three that decide independence — plus the five moves that fix a failed check.
---

# Refining issues

An issue is finished refining when an agent holding no context but the issue
body can implement it, and when landing it leaves the tree in a state somebody
would ship.

That is the bar the queue label asserts. `night-shift-worker` is what consumes
it: a scheduled agent reads the issue, the documents it cites, and works it with
nobody watching. Refining is what makes that possible. Applying the label is the
maintainer's call, never yours.

**Read `.night-shift/config.md` before you refine anything.** Three of its
headings decide how these checks run: `## Issue label` names the queue this
repository sweeps, `## Authority` names the documents an issue answers to and
what citing each one means, and `## Before you fix` says what the night shift
accepts as warrant. A missing required heading is a stop here for the same
reason it is a stop for the worker — say which one you could not find, and
refine nothing.

Eight checks decide it. Run R1 to R5 against one issue. Run I1 to I3 across a
set. Each failed check has one move.

Do not rewrite an issue that passes. A well-argued problem statement that
already carries criteria that can be shown false is done, and adding structure
to it costs review attention for nothing.

## Readiness — run against one issue

### R1. Criteria

Does the issue state acceptance criteria, and can each one be shown false?

A criterion names an observable change. "The importer refuses a row whose date
is not ISO-8601, naming the row and the value" is a criterion. "Add date
validation to the importer" is a task.

What shows a criterion false depends on what the issue delivers.

- **Behavior in code.** A test that drives the behavior, and can fail when
  the behavior is wrong.
- **A document or a declaration.** A check that does not restate the text,
  and can fail when the document is wrong. The check derives its expectation from the code the document
  describes, runs the document's examples through the parser or compiler, or
  reads an outcome in use, such as a live run whose recorded cost disagrees
  with the declared one.
- **A document with no such check.** A reviewer reads a stated property of the
  page and sees whether it holds. "The section shows the token counts and the
  prices it multiplies" is a property. "The rate is derived correctly" names a
  method, so no reader can see it fail.

Do not add a test to make a criterion pass R1. A test that fails only when
somebody edits the text it asserts on shows nothing false, so it cannot be what
satisfies a criterion, and `night-shift-worker` holds its regression tests to
the same bar. An acceptance that asks for one fails R5.

Fail R1 when the acceptance section is absent, or when it is a checkbox list of
work items, or when a bullet reads "resolved by a decision about X". That last
form is the most common miss, because a decision sitting in the criterion slot
looks like a criterion.

### R2. Capability

Does the issue say what a caller can do after it lands that they cannot do now?

Read the acceptance and answer the question out loud. If the answer is a
restatement of the tasks, the issue describes work rather than an outcome.

R1 and R2 fail independently. An issue can carry twelve well-formed checkboxes
and still never say what changes.

### R3. Premise

If the issue claims a caller *cannot* do something, find the mechanism in code
before you accept the framing.

An issue that opens with a capability gap and then offers directions has often
not proved the gap. Search the project's own user-facing documentation first —
its README and whatever `## Read first` names — because a capability that exists
is usually documented there already. Then read the source.

A wrong premise does not produce a wrong answer. It produces a correct answer
to the wrong question, and every direction under it reads as reasonable. The
cost is a large fix where a small one was needed.

**A decision already recorded is not a gap.** Where an authority document
records decisions taken, or tensions accepted as compromises, an issue whose
premise is "the project should not have decided X" is arguing with that record
rather than reporting a defect. That is a maintainer's question, not a slice:
say so and stop. What survives such an issue is whatever observable defect it
noticed in passing, scoped down to that.

### R4. Anchor

Does the issue cite the documents `## Authority` names, in the form that
heading describes?

The night shift treats the issue body as an index into those documents, not as
a substitute for them. Authority usually comes in two roles, and a repository
may declare either, both, or neither:

- **What was decided.** A specification, an accepted design, an RFC. An issue
  names the sections it answers to. Without them the agent guesses which
  requirement it is implementing.
- **What decisions answer to.** A constitution, a set of principles, a review
  rubric. An issue carries conformance criteria citing the ones each criterion
  answers to. Without them a change can pass every test and still offend the
  principle the repository holds itself to.

Fail R4 when the issue omits something `## Authority` requires. The fix is to
read the document and supply the citation, not to invent a requirement. Where no
section covers the behavior the issue wants, the issue is asking to amend the
document — which is the maintainer's decision, by the route `## Authority`
names, and never an implementation slice's to take.

**Where `## Authority` says `none`, R4 is vacuous. Record it as passed and say
why.** A repository that holds its issues to no document is a repository where
this check has nothing to read, which is not the same as an issue that skipped
it. R5 still runs: it does not depend on R4's documents.

### R5. Remedy

Does the issue prescribe a remedy that removes the defect, or a guard that
stands over it?

Where `## Authority` names principles, R5 also asks whether the requirement
obeys the one the issue cited. That is independent of R4: an issue can cite a
principle correctly and then ask for precisely what it diagnoses. Where
`## Authority` says `none`, R5 still runs on the reasoning below, which needs no
document behind it.

The shape is a value written in more than one place, and an acceptance that asks
for a test asserting the copies agree. The redundancy is the defect. A test over
the copies leaves every copy standing, adds one more thing to maintain, and goes
red only when somebody edits one of them — so it converts a problem you could
have removed into a problem you now have to keep. The remedy is not a check that
rejects the disagreement; it is an arrangement in which the copies cannot
disagree, because there is only one.

Ask which copy is the source of truth, and whether the rest can be derived or
deleted. When they can, that deletion is the requirement, and the test that
would have guarded them has nothing left to compare.

**The shape has a second form, and it is the one that slips through.** Sometimes
the fact is written in exactly one place, and the acceptance asks for a test
that quotes it: "a test reads the built declaration and finds `byte-stable`", "a
test asserts the page names both rejection types". No pre-existing redundancy
exists to point at, so the first form does not match. The redundancy arrives
with the test. The criterion underneath is usually sound — a property of the
page that a reviewer can see hold or fail, which is what R1 asks of a document.
Only the test is the copy.

Both forms answer one question: what could this test go red for? When the answer
is "somebody reworded the thing it quotes", the acceptance is a copy — whether
it guards a redundancy that was already there or manufactures one that was not.

Fail R5 when the acceptance's subject is agreement between two representations
of one fact — a runtime validation, a lint, a CI step, or a test — rather than
the removal of one of them. Fail it too when the acceptance asks for a test
whose only possible failure is an edit to the text it quotes, even where that
text is the only copy in the tree. The move is **Remove the freedom** for both,
though the second form has less to remove.

Run R5 after R4 where `## Authority` names principles, because the cited one is
part of what R5 reads: an issue that fails R4 offers nothing to check the
requirement against. Where it says `none`, the order does not matter.

## Independence — run across a set

### I1. Reference

Do this issue's acceptance criteria name another issue's outcome?

That is the whole test. Two issues that edit the same file are independent when
neither one's criteria mention the other. Two issues that share no file are
coupled when one's check is satisfiable while the other's hole is open.

Coupling lives in shared invariants. A shared file is not coupling.

When the answer is yes, the coupling has to reach the issue body as a *Depends
on* line. The night shift sequences off that declaration alone and does not
infer order from the files an issue touches, so an undeclared dependency is
invisible to it: two sessions take the coupled pair, both branch from `main`,
and produce conflicting patches for one design. A declared one becomes a stack.

The reverse costs too. A *Depends on* that no criterion needs makes a free issue
wait for a blocked one, and the night shift will honor it.

### I2. Dimension

Does the code this issue reads conflate the axis it cares about with another?

An issue inherits the dimensionality of what it reads. A predicate that ORs two
independent axes into one boolean forces every issue touching it to depend on
both, whether or not it cares about both. The dependency sits in the code rather
than in the work.

Hand-maintained consistency across two sites is one degree of freedom wearing
the costume of two, and the ripple it produces is coupling. An issue that fails
I2 has found surplus freedom in the representation. Where `## Authority` names
principles, saying which one it offends is usually the clearest statement of the
fix.

Fail I2 when the issue must wait for a decomposition rather than for a
behavior.

### I3. Intermediate

For each order of a coupled pair, is there a state worth shipping in between?

Write the criterion for the halfway point. Usually one order has a coherent
intermediate and the reverse does not, and that asymmetry is the ordering.

The danger this check catches is specific. Whichever issue of a coupled pair
lands first ships a green test suite asserting a partial invariant, and a
passing test that claims coverage it does not have goes into every committed
baseline as real signal.

Once the order is written down, the pair costs nothing in wall-clock: the upper
layer branches from the lower one's branch and opens a stacked pull request, so
neither waits for the other to merge. Ordering is what the night shift needs;
serialization is not.

## The five moves

**Extract a decision.** Several issues stalling on "Directions:" or "Decide
first" are often stalling on one decision in different words. Record it once,
outside all of them, in a design note kept wherever this repository keeps them.
Every issue that depended
on it becomes independent with no change to its scope. Answering separately
produces answers that need not agree. When the decision is one the spec already
owns — a default, a vocabulary choice, a division of responsibility — the note
is not yours to write: it is an amendment, and it lands by the route
`## Authority` names, by the maintainer.

**Remove the freedom.** When R5 fails, name the source of truth and rewrite the
acceptance as the deletion or derivation of every other copy. The guard the
issue asked for goes with them: with one statement left there is nothing to
compare. The guard does not need removing separately; it becomes vacuous.

Write two consequences into the issue. Say that no test asserting agreement is
to be added, because an agent reaching for evidence will otherwise supply one
and restore the freedom the issue just removed. And where one of the copies
lives in a document `## Authority` names, deleting it is an amendment, so the
issue has to declare itself one in its title and its acceptance. The night shift
stops and asks rather than guessing which kind of issue it holds.

Where the acceptance manufactures the copy rather than guarding one, there is
nothing to delete and the move is smaller: strike the test and keep the
criterion as a property a reviewer checks, or replace the test with one that
derives. A derived criterion names something the *code* can
falsify — a documented example that compiles against the shipped build, a
documented path that resolves against the filesystem, a default read back out of
the object the factory built. Each fails when the code changes, which is the
failure a document cannot produce on its own.

Where nothing derives, say so in the issue: the documentation stands on review,
and no test is to be added. That sentence is load-bearing for the same reason it
is in the first form. An agent held to a regression test, reading an acceptance
that names a sentence, will quote the sentence back.

**Decompose the axis.** When I2 fails, the fix belongs to whichever issue owns
the separation rather than to the issue that noticed it. Decomposing the predicate is
what makes the other issues perpendicular, so it is scope for the owner rather
than a new issue.

**Define the intermediate criterion.** When I3 finds a coherent halfway state,
give it to the issue that lands first. This converts a must-land-together pair
into a sequence, and it moves the shared invariant out of the gap and into an
issue that owns it. A note reading "whichever lands second must not reopen this"
is prose, and prose does not run.

**Split.** An issue holding more than one concern splits, even when the parts
share a file. Prefer the split when one part is unblocked today and another
waits on a dependency, because bundling makes the free part wait.

## Worked example

`references/worked-example.md` runs R1 to R3, R5, and I1 to I3 plus both
structural moves over one backlog, and closes each with the shape to recognize. The domain
is invented so nothing in it decays as a real backlog is worked. Read it when a
check's description is not enough to recognize what is in front of you.

R4 has no shape section because it is a presence check: the sections are named
or they are not.

## Writing the refined issue

Write the title as the defect, then "so", then the consequence. "`start()` has
no bound, so an unreachable server holds a boot path open."

Body leads with what happened or what the mechanism is, cites the code by path
and line, and closes with acceptance. A serviceable order: the mechanism in
prose; **Measured** or **Demonstrated**, showing the behavior against something
real; **Build** or **Proposal**; **Tests**; **Conformance**, naming what each
criterion answers to; **Depends on**. Drop **Conformance** where `## Authority`
says `none` — a heading with nothing to cite is a heading that gets filled in
with something invented.

A documentation slice may carry no **Tests** entry at all: its criteria are
properties a reviewer checks, which R1 accepts. Every entry that is there has to
be able to fail for a reason other than an edit to its own subject. This is the
sentence R5 most often catches too late: a documentation slice feels like it
needs a test, a quotation is the only one available, and writing it here is what
puts it in the suite. The night shift implements the acceptance it is given.

Name the interaction with any issue that shares an invariant, and say which one
must not reopen the gap.

Say plainly what the issue no longer claims when a check removed part of it. A
reader who remembers the old framing needs to know it is gone, and the removed
argument does not belong in the body. This is `CLAUDE.md`'s no-reversed-decision
rule applied to a tracker: the refined issue describes only what is wrong now.

Refining destroys the evidence. An issue that passes the checks no longer shows
the defect that made it fail them, and a tracker keeps no body history a later
reader can reach. GitHub's timeline API returns `renamed` and `labeled` events
and never the previous body.

So an issue is a poor place to point somebody who needs to learn a shape. It is
also a decaying one, because the code a good example quotes is usually the code
the issue deletes. Teach from a constructed case that holds the shape, and keep
the issue number as provenance for a reader who wants the original.
