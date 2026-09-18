# Worked example

One backlog. The project is a deployment CLI: it builds an artifact, deploys it
to staging, and promotes a staging build to production.
It has an auth check on its deploy API, a `--dry-run` flag, and a `help`
command.

The domain is invented so the shapes stay legible outside any one codebase.
The shapes are not. See Provenance at the end.

## R1 Criteria — a decision in the criterion slot

An issue lists four confusing error messages and closes with acceptance. Three
bullets can be shown false. The fourth:

> - Case 4 is resolved by a decision about which registry format the artifact
>   digest uses, and the `help` text matches that decision.

It has the grammar of a criterion. It names no observable change and cannot be
shown false, because what it requires is that somebody choose. Three quarters
of the issue is implementable and the fourth quarter is a question wearing a
criterion's clothes.

**The shape:** an acceptance bullet whose verb is *decide*, *resolve*,
*determine*, or *clarify*.

## R2 Capability — a task list that never states an outcome

An issue about unvalidated deploy manifests carries eleven checkboxes across
design, implementation, and rollout, plus a stated fix ordering. It reads as
the most complete issue in the backlog. One bullet:

> - [ ] Add `validateManifest` to `src/deploy/manifest.ts`, sibling to
>   `loadManifest`: walk the parsed tree and check every referenced image tag
>   resolves in the registry.

That is a precise task. Nowhere does the issue say what an operator can do
afterward that they cannot do now. The criterion it lacks is one sentence:
*deploy refuses a manifest that references an image tag the registry does not
hold, naming the tag.*

**The shape:** an issue you could hand to an implementer that leaves a reviewer
unable to say what changed. R1 passes, R2 fails, and the two fail
independently.

## R3 Premise — a capability gap that was not there

An issue titled "An operator cannot see what a deploy will change without
running it" opens:

> This issue is a request for a strategy rather than a patch, because the two
> candidate patches pull against each other.

and offers four directions, the largest of which restructures how the CLI holds
a plan.

The premise is false. `deploy --dry-run` prints the plan and exits, and
`help deploy` documents it. All four directions solve a problem that does not
exist.

One real defect the issue mentions in passing survives: the dry-run output
omits image digests, so an operator cannot tell two builds of the same tag
apart. The issue scopes down to that.

**The shape:** an issue that opens with "the caller cannot X" and proceeds to
directions without ever showing the code that refuses. Check the product's own
help text before the handler, because a capability that exists is usually
documented there already.

## R5 Remedy — a guard where the freedom should have been removed

The promote timeout is written in three places: `help promote` prints it in
prose, `config/defaults.yml` sets it, and the deploy API client hard-codes the
same number as its own fallback. Nothing ties them together, and they agree
today by hand. An issue notices this and closes with:

> - A test reads the timeout from all three and asserts they agree.

The criterion is observable and can be shown false, so R1 passes. It names an
outcome, so R2 passes. The drift is real and demonstrated, so R3 passes. It cites
the principle its repository holds duplication to, so R4 passes. And it asks for
exactly what that principle diagnoses.

Three independent variables stand where the problem has one, and the acceptance
adds a fourth thing to maintain rather than removing two. The remedy is to name
`config/defaults.yml` the source, have the client read it instead of carrying a
fallback, and have `help promote` print the value instead of spelling it. Then
no test has anything left to compare.

**The shape:** an acceptance whose subject is agreement between copies. The
issue has found surplus freedom and asked for a guard to stand over it.

## R5 Remedy — a copy the acceptance creates

`promote --wait` blocks until the deploy settles, and its help text does not say
that cancelling the wait leaves the deploy running. An issue adds the sentence
and closes with:

> - `promote --wait`'s help text says that cancelling the wait does not cancel
>   the deploy.
> - A test reads `promote --help` and asserts it contains that sentence.

Nothing is written twice here. The help text is the only place that fact lives,
and the issue is right that it belongs there. The first bullet is a criterion,
a property a reviewer can see hold or fail, so R1 passes. It names an outcome, so R2
passes. An operator really did cancel a wait and assume the deploy stopped, so
R3 passes. The principle about keeping an explanation in one place is cited,
correctly, so R4 passes.

The second bullet is not a criterion about the product at all. It prescribes a
test, and the test is the copy that arrives with the acceptance. It can go red
for one reason: somebody rewords the sentence. It cannot notice that cancelling
now *does* cancel the deploy, which is the only thing worth knowing. It freezes
the wording and leaves the behavior unguarded.

What derives here is the flag, not the sentence. A check that every flag the
parser registers appears in `--help`, and that nothing else does, fails when
somebody adds or renames a flag without documenting it — a failure the code
produces. The refined acceptance keeps the criterion, strikes the test, and
says no test is to be added for the sentence: it stands on review.

**The shape:** an acceptance that quotes a document back to itself. The first
form guards a redundancy that exists; this one manufactures one that did not,
which is why reading for surplus freedom does not find it.

## I1 Reference — a shared invariant across no shared file

Issue A adds an authorization check to the deploy API route. Issue B removes an
internal scheduler that calls the deploy handler directly, bypassing the route.

They edit different files. They are not independent. A's criteria are all
satisfiable while the scheduler still reaches the handler, so an unauthorized
deploy still happens and A's tests are green.

**The shape:** two issues whose criteria are each complete and whose
conjunction is the actual invariant. Neither body has to mention the other for
the coupling to be real, which is why the check reads the criteria rather than
the file list.

## I2 Dimension — waiting on a decomposition rather than a behavior

An issue makes `status` report whether the working tree is safe to switch
branches. Its first draft:

> - The answer is derived from the state `status` already reports. No new
>   stored field.

The second sentence is right and the first is wrong. `status` reports one
boolean that ORs two independent axes:

```
pending = hasUncommittedEdits() || hasUnpushedCommits()
```

Branch safety depends on the first alone, and the disjunction loses it in
exactly the ordinary case:

| `pending` | unpushed | uncommitted edits |
|---|---|---|
| false | any | false |
| true | 0 | true |
| true | above 0 | unknown |

The third row is the common one. So the dependency is not on another behavior.
It is on a predicate being split along the axis this issue cares about, and
that split belongs to whichever issue owns separating the two.

**The shape:** an issue that cannot be stated cleanly because a value it must
read conflates two things. The dependency sits in the code rather than in the
work.

## I3 Intermediate — the order falls out of the halfway state

Take the coupled pair from I1 and write the criterion for each order.

**B first.** The intermediate is *every deploy path goes through the route*,
true by removal alone. Worth shipping on its own. A then adds *the route
authorizes the caller*.

**A first.** The intermediate is *the route authorizes, except the path that
skips it*. Not worth shipping, and worse than not shipping, because it lands a
green test suite over an open hole and that green goes into every later
baseline as real signal.

Only one order has a coherent halfway state. That asymmetry is the ordering.

## Split — one issue, three concerns

One issue holds four confusing error messages and two stale help topics. Sorted
by what each part actually is:

- Three message fixes, extending a pattern that already exists, blocked on
  nothing.
- One format change with a compatibility rationale, coupled to another issue
  under I1.
- Two help topics that are stale because a newer flag replaced what they
  describe, wrong today for a reason unrelated to either.

Three issues. The message fixes stop waiting on a decision that is not theirs,
and the help fix stops waiting on both.

**The shape:** a single issue whose parts have different blockers. Bundling
makes the free part wait for the blocked one.

## Extract — four issues, one decision

Four issues each end without a decision:

- Which component owns retry policy for a failed deploy?
- Which component owns retry policy for a failed registry push?
- Should a partial rollout retry the failed shards or the whole batch?
- Where does the retry budget live?

Four phrasings of one question: which layer owns retry, and against what
budget. Recording the answer once, in a design note outside all four, makes
every one of them independent without changing any of their scope. Answered
separately, they produce four answers that need not agree.

## Provenance

Every shape here was found in a real backlog audit of `jinaga/factual-mcp` in
September 2026, across issues 351, 373, 377, 404, 405, 406, 412, 415, and 416.
The R5 shapes came from `jinaga/jinaga-worker`: the first from #52 in the same
month, the second from #19, #22 and #39, whose acceptance sections each asked
for a test quoting a document back to itself and got one.

The real cases are not reproduced, for two reasons. They carry domain
vocabulary that costs a reader more than the shape is worth. And each one
quotes code that the issue describing it deletes, so a faithful transcript
starts decaying the moment the backlog is worked.

Read the issues if you want the originals. Expect them to have been refined,
and expect no previous body to be reachable: a tracker keeps no history of an
issue's text, so what made an issue fail a check is gone once it passes.
