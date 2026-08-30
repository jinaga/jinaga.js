# Specification Invariants

A formal foundation for proving the specification algorithms correct over all
constructable specifications.

This document defines:

1. **Axioms** about the fact graph (§1) — what the world guarantees.
2. **A denotational semantics** `⟦·⟧` (§2) — the ground truth every algorithm
   is measured against.
3. **A well-formedness judgment `W`** (§3) — the structural invariant that
   characterizes the *constructable* specifications, defined so that
   `W(S) ⟺ ⟦S⟧ is total and SpecificationRunner evaluates it without error`.
4. **The Master Invariant** (§4) — the one statement every operation must
   satisfy.
5. **Per-operation semantic laws** (§5) — what "correct" means for parse,
   describe, run, invert, buildFeeds, skeleton, and alpha.
6. **Supporting lemmas** (§6) — the reusable steps the proofs will lean on.
7. **Proof obligations** (§7) — one row per algorithm, with current status.

Cross-references are to `src/specification/` unless noted. The feed law (§5,
L6) is the algorithm of *The Art of Immutable Architecture*, chapter 12
("Feeds"); that chapter is the normative source for L6a–L6e and its terminology
(*ordinary*, *excluding*, *restoring*) is used throughout.

---

## 1. Axioms of the fact graph

A **fact graph** `G` is a finite set of facts. Each fact `f` has a type `τ(f)`
and, for each role name `r`, a finite set of predecessors `pred_G(f, r) ⊆ G`.
Write `pred_G(f, r, t) = { p ∈ pred_G(f, r) : τ(p) = t }` and

    succ_G(p, r, t) = { f ∈ G : τ(f) = t ∧ p ∈ pred_G(f, r) }

- **A1 (Monotonicity).** The only mutation is insertion: `G ⊆ G'`. Facts are
  never deleted or modified.
- **A2 (Predecessor immutability).** `pred_G(f, r)` is fixed when `f` is
  created. Therefore `pred_{G'}(f, r) = pred_G(f, r)` for every `f ∈ G ⊆ G'`.
  Growth can only add *successors* to existing facts.
- **A3 (Topological arrival).** A fact is inserted only after all of its
  predecessors. Consequently, at the moment `f` is inserted,
  `succ_{G ⊎ {f}}(f, r, t) = ∅` for every `r`, `t`.
- **A4 (Acyclicity).** The predecessor relation is a DAG. Follows from A3.
- **A5 (Hierarchy).** Replicators are deployed in a hierarchy in which a
  downstream replica shares all of its facts upstream, so an upstream replicator
  holds a superset of every downstream replica's facts. *(Chapter 6; relied on
  in chapter 12.)* This is what entitles the responder to decide what the
  requester needs to know: it can only be wrong in the direction of withholding
  a fact whose relevance depends on something the requester has and it does not,
  and A5 rules that out.

> A3 is the load-bearing axiom for `simplifyMatches` (§6, M5). If facts can
> arrive out of order — a successor received before its predecessor — every
> `simplifyMatches`-derived pruning is unsound. **This axiom must be
> discharged against the actual save/load path, not assumed.** (Obligation O9.)

---

## 2. Denotational semantics

An **environment** `σ` is a partial map from label names to facts; `dom σ` is
the set of bound labels; `σ[u ↦ f]` extends it.

### 2.1 Role walks

For a role list `ρ = [r₁:t₁, …, rₙ:tₙ]`:

    P_G(f, ρ) = { g : ∃ f = f₀, f₁, …, fₙ = g with fᵢ ∈ pred_G(fᵢ₋₁, rᵢ, tᵢ) }
    P_G(f, []) = { f }

By **A2**, `P_G(f, ρ)` is *stable* under graph growth: `P_{G'}(f, ρ) = P_G(f, ρ)`
for `f ∈ G`. This is the reason inversion is possible at all.

### 2.2 Path condition

A path condition on unknown `u : T` is `c = ⟨L, m, R⟩` (`rolesLeft`,
`labelRight`, `rolesRight`). For `m ∈ dom σ`:

    ⟦c⟧_G^u σ  =  { f ∈ G : τ(f) = T ∧ P_G(f, L) ∩ P_G(σ(m), R) ≠ ∅ }

The implementation computes this as *walk predecessors `R` from `σ(m)`, then
walk successors along `reverse(L)`* (`specification-runner.ts:106-119`,
`invertRoles:238-250`). The two agree exactly.

### 2.3 Match

For `mᵢ = ⟨u : T, [c₀ … cₙ]⟩`, with `Path(mᵢ)` its path conditions and
`Exist(mᵢ)` its existential conditions:

    ⟦mᵢ⟧_G σ = { σ[u ↦ f]
               | f ∈ ⋂_{c ∈ Path(mᵢ)} ⟦c⟧_G^u σ
               ∧ ∀ ⟨ε, M⟩ ∈ Exist(mᵢ). ( ⟦M⟧_G (σ[u ↦ f]) ≠ ∅ ) = ε }

**Note the asymmetry, and that it is deliberate:** path conditions are
evaluated in the *pre-match* environment `σ`; existential conditions in the
*post-match* environment `σ[u ↦ f]`. This mirrors
`SpecificationRunner.filterByCondition` (`:130-144`), which passes the
pre-match `references` to `executePathCondition` even for conditions after
the first, and the post-match `result` to `executeMatches` for existentials.

### 2.4 Match list, given, specification

    ⟦[]⟧_G σ       = { σ }
    ⟦m :: ms⟧_G σ  = ⋃_{σ' ∈ ⟦m⟧_G σ} ⟦ms⟧_G σ'

Given a start tuple `ḡ = (g₁ … gₙ)` and `σ₀ = { Sᵢ.given.label ↦ gᵢ }`:

    ⟦S⟧_G(ḡ) = ⟦S.matches⟧_G σ₀   if ∀i. gᵢ ∈ G
                                  and ∀ ⟨ε, M⟩ ∈ given conditions.
                                      ( ⟦M⟧_G σ₀ ≠ ∅ ) = ε
             = ∅                   otherwise

### 2.5 Rows

A projection may nest collections, so a result is a tree. Address each
collection by a **path** `p` (the dotted `component.name` chain that
`InverterContext.path` carries, `inverse.ts:415`). Define the flattened result

    Rows(S, G, ḡ) = { (p, σ|_{resultSubset(p)}) : σ reachable at address p }

`Rows` is the object the inversion law (§5, L4) is stated over. Two rows are
equal iff their path and their restriction to `resultSubset` are equal —
i.e. **row identity is tuple identity**, not projected-value identity.

---

## 3. Well-formedness `W`

`W` is a syntactic judgment. It is designed so that:

> **`W(S)` holds ⟺ `⟦S⟧_G(ḡ)` is total for every `G, ḡ` ⟺
> `SpecificationRunner.read` terminates without throwing.**

### 3.1 Match-list judgment `Γ ⊢ M ok`

For a bound-label set `Γ` and match list `M = [m₁ … m_k]`, let
`Γᵢ = Γ ∪ { u₁ … uᵢ₋₁ }`. Then `Γ ⊢ M ok` iff for every `i`:

| | Name | Condition |
|---|---|---|
| **W1** | Freshness | `uᵢ ∉ Γᵢ` |
| **W2** | Generativity | `mᵢ.conditions ≠ []` **and** `mᵢ.conditions[0]` is a path condition |
| **W3** | Pre-binding | for every path condition `c ∈ mᵢ`: `c.labelRight ∈ Γᵢ` — note **not** `Γᵢ ∪ {uᵢ}` |
| **W4** | Post-binding | for every existential `⟨ε, M'⟩ ∈ mᵢ`: `Γᵢ ∪ {uᵢ} ⊢ M' ok` |
| **W5a** | Connectivity | in the undirected graph on `Γ ∪ {u₁…u_k}` with an edge `uᵢ — c.labelRight` per path condition, every `uᵢ` is connected to some label of `Γ` |
| **W5b** | Anchoring | for every existential `⟨ε, M'⟩ ∈ mᵢ`: some `m' ∈ M'` has a path condition with `labelRight = uᵢ` |
| **W6** | Type coherence | for every path condition on `uᵢ : T` with `labelRight : T'`: `typeAfter(T, L) = typeAfter(T', R)`, where `typeAfter` folds the declared `predecessorType`s |

W4 recurses with a **copy** of the bound set: inner labels do not escape the
existential.

### 3.2 Specification judgment `⊢ S ok`

`W(S)` iff, with `Γ₀ = { given label names }` (all of them, distinct):

- **W1'** given label names are pairwise distinct;
- for every given `g` and every `⟨ε, M⟩ ∈ g.conditions`: `Γ₀ ⊢ M ok`;
- `Γ₀ ⊢ S.matches ok`;
- **W7 (Projection scoping)** every label named by `S.projection` is in
  `Γ₀ ∪ { u₁…u_k }`; for a `specification` component with matches `M_c`,
  `Γ₀ ∪ {u₁…u_k} ⊢ M_c ok` and its projection is scoped in the extended set.

### 3.3 Which clauses are load-bearing where

| Clause | Needed by | Enforced today by |
|---|---|---|
| W1 | runner (name-keyed tuples), α-equivalence | parser `:225-227` |
| W2 | runner only — `⟦·⟧` is defined without it | **runner `:82,:96` (throws); parser does NOT enforce.** Confirmed empirically: `u1: E [ E {…} u1->tenant = p1 ]` parses to conditions `["existential","path"]` and then fails at run time |
| W3 | runner `:109` | parser `:176-178`; `expectWellOrdered` (test helper) |
| W4 | runner `:138` | parser `:189`; `expectWellOrdered` |
| W5a | `shakeTree` termination (`inverse.ts:187-191`), `detectDisconnectedSpecification` | `UnionFind.ts` at inversion time |
| W5b | inversion of existentials, feed anchoring | parser `:191-200` |
| W6 | `skeletonOfSpecification` (`skeleton.ts:266`); **not** checked by the runner, which silently yields `∅` | skeleton build only |
| W7 | runner `:181,:190,:200,:209` | parser (scoped `labels`) |

Two known **asymmetries between the enforcers and the requirement**:

- The parser scopes a given's conditions to *preceding* givens only
  (`:157`), while the runner binds *all* givens before evaluating any
  (`specification-runner.ts:31-38`). The parser is therefore conservative:
  sound, not complete.
- The parser does not enforce W2; the runner requires it. This is the one
  place where `W` as defined is *stronger* than what the parser guarantees,
  so "parsed successfully" does not imply `W`.

---

## 4. The Master Invariant

> **MI.** Let `Op` be any operation in the specification algebra
> (`parse`, `describe`, `alphaTransform`, `invertSpecification`, `buildFeeds`,
> `skeletonOfSpecification`, `splitBeforeFirstSuccessor`, intersection, and
> every internal rewrite: `shakeTree`, `relocateConditions`, `simplifyMatches`,
> `removeCondition`, `invertAndMovePathCondition`, `withMatch`/`withCondition`).
>
> For every input satisfying `W`:
>
> 1. **(Preservation)** every specification `Op` produces satisfies `W`; and
> 2. **(Semantic law)** `Op` stands in the relation to `⟦·⟧` declared for it in §5.
>
> Corollary: because `W` is exactly the totality condition for `⟦·⟧`, no
> composition of operations can produce a specification that throws
> `"The label X is not defined"`, `"A match must have at least one condition"`,
> `"The first condition must be a path condition"`, or `"Label X not found"`.

Every crash in #238 and in comment 1 of #242 is a violation of MI.1.
Every silent-wrong-answer in #242 is a violation of MI.2.

**Intermediate states are exempt.** `shakeTree`'s output is explicitly *not*
required to satisfy W3/W4 — that is why `relocateConditions` exists. The
obligation is on the composite `relocateConditions ∘ simplifyMatches ∘ shakeTree`
as it appears at `inverse.ts:127` and `:351`, not on each factor.

---

## 5. Semantic laws, per operation

### L1 — Parse / describe round trip
`describeSpecification` and `SpecificationParser.parseSpecification` are
mutually inverse on `W`-specifications, up to whitespace:

    parse(describe(S)) = S            for all S with W(S)
    describe(parse(t)) ≡ t            for all t that parse

and `parse(t)` satisfies `W1, W3–W7` (not W2 — see §3.3).

**This law is what makes #242's "byte-identical text" argument valid.** If L1
holds, identical text implies identical structure implies identical skeleton.
If the rule and the target are byte-identical yet decide differently, then
either L1 fails, or the rule was *not* built by the same path as the target
(e.g. built through the model builder rather than parsed), or the divergence
is downstream of the structure — in `buildFeeds`/`skeleton` (L6/L7).

### L2 — Alpha transform
For an injective renaming `θ`: `W(S) ⟹ W(θ(S))`, and
`⟦θ(S)⟧_G(ḡ) = θ(⟦S⟧_G(ḡ))` pointwise on environments. Skeletons are equal:
`skeleton(θ(S)) = skeleton(S)`.

### L3 — Runner
For `W(S)`: `SpecificationRunner.read(ḡ, S)` terminates and returns exactly
`Rows(S, G, ḡ)` at the root path, with projections applied.

### L4 — Inversion (the differential law)
This is the central law. Let `I = invertSpecification(S)`, let `G' = G ⊎ {f}`
under A1–A3, and let `ḡ ⊆ G` be a given tuple. Define

    Δ⁺ = Rows(S, G', ḡ) \ Rows(S, G, ḡ)
    Δ⁻ = Rows(S, G,  ḡ) \ Rows(S, G', ḡ)

For each inverse `ι ∈ I` with `τ(f) = ι.inverseSpecification.given[0].label.type`,
define the **fired rows**

    Φ(ι, f) = { (ι.path, σ|_{ι.resultSubset})
              : σ ∈ ⟦ι.inverseSpecification⟧_{G'}(f), σ|_{ι.givenSubset} = ḡ }

Then

    ⋃ { Φ(ι, f) : ι.operation = "add"    } = Δ⁺        (L4a)
    ⋃ { Φ(ι, f) : ι.operation = "remove" } = Δ⁻        (L4b)

`⊆` is **soundness** (no spurious notifications); `⊇` is **completeness** (no
missed notifications). Both directions matter operationally:

- A violation of L4a-⊇ means a subscriber never learns about a row that
  appeared.
- A violation of L4b-⊇ means a subscriber never learns that a row *left* the
  result set. An earlier draft named this as the mechanism behind the
  write-amplification loop in #242 comment 3. **That attribution is not
  supported by measurement** — see §10.1.

### L5 — Rewrite laws used inside inversion
- `shakeTree(M, ℓ)` preserves `⟦M⟧` as an unordered conjunction (M2, M3) and
  preserves W1, W5a, W6; it may break W2, W3, W4.
- `relocateConditions(M)` preserves `⟦M⟧` (M4) and restores W2, W3, W4.
- `simplifyMatches(M, ℓ)` returns `M'` with
  `⟦M'⟧_{G'} σ = ⟦M⟧_{G'} σ` **whenever `σ(ℓ) = f` is the newly inserted fact**
  (M5), or `null` when `⟦M⟧_{G'} σ = ∅` for all such `σ`.
- `removeCondition(M, e)` is used only in the "remove" branch, where the
  correctness statement is `⟦M \ e⟧_{G'} = ⟦M⟧_G` restricted to rows that `e`
  has just falsified.

### L6 — Feed decomposition

This is the law with the most structure, and it is **not** "each feed returns
what the specification returns". It is the algorithm of *The Art of Immutable
Architecture*, chapter 12. `buildFeeds(S) = {F₁ … F_m}`, each with `W(Fᵢ)`, and:

**L6a (No reinsertion — the constraint everything else bends around).**
For a feed `F`, a tuple `t`, and any chain `G₀ ⊆ G₁ ⊆ G₂`:

    t ∈ ⟦F⟧_{G₀}  ∧  t ∉ ⟦F⟧_{G₁}   ⟹   t ∉ ⟦F⟧_{G₂}

Membership over graph growth is `false* true* false*`: it may fall once, and
must never rise again.

Note what this does **not** say. A feed is *not* monotone in the naive
`⟦F⟧_G ⊆ ⟦F⟧_{G'}` sense — a tuple genuinely leaves the ordinary feed when its
`!E` witness appears, and that is the whole point of the split. Leaving is
harmless: the peer already received the tuple, and learns of the exclusion from
the *excluding* feed.

Re-entry is what is fatal, and the reason is **position**. A feed is a
sequential stream read with an opaque **bookmark**, and a tuple's position is
the vector of its own labeled fact ids (ch. 12, "Vectors"). By A2 those facts
are fixed the moment the tuple first forms, so its position never changes. A
tuple that re-qualifies would have to be emitted at its *original* position —
behind every reader that has already passed it. It would be silently lost.

*Structural sufficient condition (ch. 12, "Adding Tuples to a Feed"):* a feed
specification contains **only path conditions and at most one level of negative
existential condition**. Path conditions only ever complete a tuple, since a
path may walk predecessor-ward alone and predecessors precede successors (A2,
A3). A single `!E` falls one way: once a witness exists the condition is false
forever. A **nested** `!E` breaks it — a restore makes the outer condition true
again, reinserting a tuple behind the bookmark.

**L6b (Individual feeds are necessarily more restrictive).** L6a forces the
ordinary feed to truncate the specification's condition to one level, so

    ⟦F_ordinary⟧ ⊊ ⟦S⟧   is expected, not a defect.

Correctness is a property of the **set** of feeds, never of any one of them.
The requester reassembles `⟦S⟧` locally from the union of all feeds; a single
feed is evidence, not an answer.

**L6c (Parity).** Each `!E` splits the feed in two. Let `k` be the negation
depth at which a branch was created.

| depth | name | polarity | continues? | carries projections? |
|---|---|---|---|---|
| 0 | ordinary | positive | yes | yes |
| odd | excluding | negative | **no** | **no** |
| even > 0 | restoring | positive | **yes** | **yes** |

An excluding feed is evidence that results should be *removed*; it stops where
it is (an optimization the book explicitly flags as a bandwidth trade, not a
correctness requirement). A positive feed's tuples *contribute* results, so it
must go on to match the remainder of the specification — the remainder of its
own level and of every enclosing level — and then be extended with the feeds of
each projection component.

**L6d (Joint coverage).** For every `G`, `ḡ`, and every `f` whose insertion
changes `Rows(S, ·, ḡ)`, there exists `i` and a tuple in
`⟦Fᵢ⟧_{G'}(ḡ↾Fᵢ.given)` whose range contains `f`. Note this quantifies over the
*set*: the fact that no single feed sees `f` is irrelevant.

**L6e (Transitive closure).** Feeds carry only *labeled* facts. Unlabeled facts
on a path (the `Table` in the restaurant example) reach the requester through
the transitive closure of predecessors, requested separately. This is sound
because a path condition may only walk predecessor-ward, so every fact a
specification touches is either labeled or an ancestor of a labeled fact.

Together L6a–L6e replace the naive coverage statement. The naive statement is
what made §9.2 of an earlier draft of this document diagnose a designed
behavior as a defect.

### L7 — Skeleton canonicity
For feed-normal-form specifications `F₁`, `F₂`:

    F₁ ≅ F₂  (isomorphic as labeled graphs, same given assignment)
      ⟹  skeletonOfSpecification(F₁) = skeletonOfSpecification(F₂)     (L7a)
    skeletonOfSpecification(F₁) = skeletonOfSpecification(F₂)
      ⟹  ⟦F₁⟧ and ⟦F₂⟧ authorize the same facts                        (L7b)

**L7c (No inference by narrowing).** A target may not add a `notExists`
condition that no authorizing rule imposes — *even though the added condition
strictly shrinks the result set*.

This is the clause that most invites a well-meaning relaxation, so the argument
is recorded in full. The intuition "narrower is safe" is imported from
relational ACLs, where adding a `WHERE` clause is safe because the predicate
reads columns you are already permitted to read. It does not transfer, because

> a `notExists` is not a filter over data the client holds. It is a **query over
> the fact graph that the replicator evaluates on the client's behalf**, and its
> answer is observable in the result.

Two disclosure channels, in increasing severity:

1. **Inference.** The client can run the rule's own shape (authorized) and the
   narrowed shape, and difference them. For each tuple, the difference is
   exactly the truth value of `∃witness` — one bit per tuple about a fact type
   no rule shares. In an immutable model the existence bit is frequently the
   sensitive datum: `Employee.Terminated`, `AccessPath.Configured`, `Post.Deleted`
   carry their meaning in existence alone.
2. **Direct disclosure.** Stronger, and measured. A `!E` in a target
   specification always generates its **excluding feed** (L6c), and that feed
   delivers the witness facts themselves. For a rule sharing `Blog → Post`, a
   target adding `notExists(Post.Deleted)` decomposes to

       [Blog, Post, Post.Deleted]   ← excluding feed: hands over the witnesses
       [Blog, Post] with !E         ← ordinary feed

   The client does not merely infer that a deletion exists; it receives the
   `Post.Deleted` facts.

*Enforcement, and a warning.* `skeletonContains` rejects this today via
`isSubsetOf(target.facts, rule.facts)`: an `!E` contributes its witness to
`skeleton.facts`, so the target has a fact the rule lacks. The rejection is
therefore **correct but incidental** — it falls out of the fact-subset check
rather than from a clause that names the reason. Anyone reading only
`skeletonContains`'s comment ("The target must be at least as restrictive as the
rule") may conclude that *more* restrictive is fine and relax the fact check.
It is not fine. L7c is the reason.

*The one sound relaxation.* Adding the condition discloses nothing if the client
could already evaluate it locally — that is, if every fact and edge the
condition introduces is already delivered by some feed of some rule the user is
authorized for. That is a compositional question, evaluated across the union of
authorized rules (`canAuthorizeByComposition`), not a property of the single
near-miss rule. Any relaxation must be stated that way or not at all.

L7b is the **soundness** direction (no over-permission); L7a is the
**completeness** direction (no false denial). `skeleton.ts` assigns
`factIndex`/`edgeIndex` by *traversal position* (`withFact:40`, `withEdge:66`),
and `factsEqual`/`edgesEqual` compare those integers
(`distribution-engine.ts:597-608`). So L7a currently holds only under the
side condition that the two specifications are traversed in the same order.
`skeletonIsProperSubset`'s own doc comment concedes the gap
(`distribution-engine.ts:501-504`). **#242 is an L7a failure hypothesis.**

### L8 — Deterministic split
`splitBeforeFirstSuccessor(S) = (head, tail)` must satisfy
`⟦S⟧ = ⟦tail⟧ ∘ ⟦head⟧` with `W(head)`, `W(tail)`, and `head` containing no
successor walk or existential.

---

## 6. Supporting lemmas

- **M1 (Walk stability).** For `f ∈ G ⊆ G'`, `P_{G'}(f, ρ) = P_G(f, ρ)`.
  *From A2.* Everything about inversion rests on this.

- **M2 (Filter commutativity within a match).** Under W3, every condition of a
  match other than the generator is a filter on a fixed environment, so any
  permutation of `mᵢ.conditions` that leaves *some* path condition at index 0
  yields the same `⟦mᵢ⟧`. *Immediate from §2.3, where the denotation is a
  conjunction over unordered sets `Path(mᵢ)`, `Exist(mᵢ)`.*

  Corollary: W2's positional requirement carries **no semantic content**. It is
  an artifact of `executeMatch` reading `conditions[0]`. Either the parser must
  enforce it or `executeMatch` should select the first path condition; the
  invariant is indifferent to which.

- **M3 (Path inversion).** Replacing `⟨L, m, R⟩` on `u` by `⟨R, u, L⟩` on `m`
  denotes the same relation: `f ∈ ⟦⟨L,m,R⟩⟧^u σ ⟺ σ(m) ∈ ⟦⟨R,u,L⟩⟧^m σ[u↦f]`.
  *Directly from the symmetry of `P_G(f,L) ∩ P_G(σ(m),R) ≠ ∅`.* This is what
  `invertAndMovePathCondition` (`inverse.ts:198-223`) relies on.

- **M4 (Relocation).** Let `M` be a match list, `e` an existential condition on
  match `i`, and `j ≥ i` an index such that every free label of `e` is bound at
  or before `j`. Moving `e` from `mᵢ` to `m_j` preserves `⟦M⟧ σ`.
  *Proof sketch:* by M2 the generators of `M` depend only on path conditions,
  so the generated tuple set `Gen(σ)` is independent of where filters sit;
  `⟦M⟧σ = { σ' ∈ Gen(σ) : ⋀ filters }`, and conjunction is order-insensitive.
  Attachment position only affects when pruning happens, not what survives.
  *This is the correctness argument for `relocateConditions`
  (`inverse.ts:252-284`).*

- **M5 (No successors of a new fact).** At the instant `f` is inserted,
  `succ_{G'}(f, r, t) = ∅`. *From A3.* Hence any path condition with
  `rolesLeft ≠ []` rooted at `f`, and any existential requiring a successor of
  `f`, is decidable statically: unsatisfiable (`exists = true` ⇒ drop the
  inverse; `exists = false` ⇒ the condition is vacuously true and can be
  erased). *This is `simplifyMatch` (`inverse.ts:460-515`).*

- **M6 (Parity).** For a label nested inside existential conditions with
  existence flags `ε₁ … ε_k` (outermost first), the inverse operation is `add`
  iff `|{ j : εⱼ = false }|` is even. *By induction on `k`; `inferOperation`
  (`inverse.ts:389-400`) is exactly the fold.*

- **M8 (One level of negation cannot reinsert).** A specification containing only
  path conditions and at most one level of negative existential condition
  denotes a monotone set of tuples. *Proof.* Path conditions: a tuple is
  completed only by adding a labeled fact, since a path may walk only
  predecessor-ward and predecessors precede successors (A2, A3); adding a fact
  therefore only completes chains, never breaks them. A single `!E`: it holds
  while no witness exists and fails once one does; by A1 a witness is never
  removed, so the transition is one-way and no tuple re-enters. With a *nested*
  `!E` the inner condition can go from true to false, flipping the outer one
  from false to true, and the tuple re-enters — which is exactly the case L6a
  forbids. ∎ *(Chapter 12, "Adding Tuples to a Feed".)* Note this establishes
  L6a's `false* true* false*` shape, not naive monotonicity: the middle
  transition is a real departure from the feed.

- **M7 (Locality of change).** Under A1–A3, if `Rows(S,G,ḡ) ≠ Rows(S,G',ḡ)`
  with `G' = G ⊎ {f}`, then either (a) `f` occupies a label position in a
  changed row, or (b) `f` occurs in a *witness* of an existential condition
  whose truth value flipped. *From M1: no other quantity in §2 can change.*
  Case (a) is covered by `invertMatches`, case (b) by
  `invertExistentialConditions`. **The completeness of L4 reduces to showing
  this case split is exhaustive and each branch is complete.**

---

## 7. Proof obligations

| # | Obligation | Target | Status |
|---|---|---|---|
| O1 | `parse` establishes W1, W3–W7 | `specification-parser.ts` | Believed; W2 known **not** established (verified by probe) |
| O2 | L1 round trip on all W-specs | `description.ts` + parser | Untested for inverse-produced specs; see O8 |
| O3 | `shakeTree` terminates on all W5a inputs and preserves the conjunction | `inverse.ts:152` | Termination guarded by an explicit loop check; preservation unproven |
| O4 | `relocateConditions` restores W2, W3, W4 for every `shakeTree` output | `inverse.ts:252` | M4 gives semantic preservation; **W-restoration is not yet proven for nested existentials** |
| O5 | L4a and L4b (soundness *and* completeness of inversion) | `inverse.ts` | Open in general. **L4b measured and holding** for the two-predecessor correlated `!E` of #242/#238, including across revisions and repeated completion facts (§10.1) — so it is no longer the leading explanation for the write-amplification loop |
| O6 | L6a–L6e for `buildFeeds` | `feed-builder.ts` | **L6c violation found and fixed** — the restoring feed did not continue (§9.3). L6a is now stated and holds structurally; L6d is still unproven in general |
| O7 | L7a — isomorphic feeds produce equal skeletons | `skeleton.ts`, `distribution-engine.ts` | **Discharged for the #242 shape** — see §9. Not the cause. The positional-index limitation is real but unreachable when both sides go through `buildFeeds` |
| O8 | W5b is *not* preserved by `relocateConditions` | `inverse.ts:252` | **Conjectured.** If an existential's free labels have their latest binder at `j`, but its top-level nested matches path-reference an *earlier* label, the relocated condition sits on `m_j` while anchored to `uᵢ`, and `parseExistentialCondition:191-200` would reject the described form. Not yet reproduced: all four inverses of the #238 spec round-trip cleanly, because there the latest binder happens to be the anchor |
| O9 | A3 holds on the real save/load path | `storage`, `jinaga-server` | **Unverified assumption.** M5 and therefore every `simplifyMatches` pruning depends on it |
| O10 | `W` is decidable in linear time and is checked at every boundary | new | Not implemented. `expectWellOrdered` covers W3/W4 only, and only in tests |

---

## 8. How the open issues map onto the invariant

| Symptom | Invariant violated |
|---|---|
| #238 `"Label u1 not found"` on incremental re-evaluation | MI.1 — W3 broken by `shakeTree`, since fixed by `relocateConditions` (O4) |
| #242 repro 1/2: silent empty result, `spec-more-restrictive-than-rule` | **Correct authorization, misleading diagnostic** when the query projects a child collection the rule does not share (§10.2). Repro 1 as literally quoted (`=> u4`) still authorizes under test, including through the policy-text path (§10.4). The silence itself was a client-side defect, since fixed (§10.4) |
| #242 comment 1: HTTP 500 `"Label u4 not found"` from `/feeds` | MI.1 — W3 broken by `buildFeeds`'s projection attachment to a truncated restoring feed (§9.3) |
| #242 comment 1: JinagaTest and replicator disagree | L3 vs L6/L7 — the two paths evaluate different laws; agreement is a *consequence* of MI, not an axiom |
| #242 comment 3: unbounded write amplification | **Unattributed.** L4b holds for this shape under test (§10.1); the mechanism is still unidentified |

The value of stating the invariant this way: all five have distinct root
causes, but each is a failure of a *named, provable* clause. Fixing them
piecemeal without the clause identified is how #238's fix left #242 alive.

---

## 9. O7 investigation, and the defect it uncovered

### 9.1 O7 is discharged for the #242 shape — skeleton canonicity is not the cause

Measured directly, with the #242 specification reconstructed from the issue:

- `buildFeeds` yields **4 feeds** at baseline, matching the issue's report of
  four decomposed feed hashes.
- The rule's feeds (`DistributionRules.share(...).with(...)`, which calls
  `buildFeeds` at registration, `distribution-rules.ts:25`) and the target's
  feeds are **element-wise skeleton-identical**.
- L1 round trip holds through the *policy text* path: `saveToDescription()` →
  `parseDistributionRules()` reproduces the rule structurally
  (`JSON.stringify` equal) and produces identical feed skeletons.
- End to end through `JinagaTest` with a `ServicePrincipal` user rule, the
  query is **authorized** and returns the access path.

So the "byte-identical specification is denied" hypothesis does **not**
reproduce at HEAD. L7a's positional-index weakness is real, but unreachable
here: both sides are decomposed by the same `buildFeeds` from the same
structure, so their traversal orders necessarily coincide. O7 stays open as a
latent hazard, not as the #242 root cause.

### 9.2 A retracted diagnosis: the one-level truncation is the design

An earlier draft called `buildExistentialCondition`'s dropping of nested `!E`
from the ordinary feed a defect (D1) and "fixed" it. **That was wrong, and the
change has been reverted.** Chapter 12 states the rule directly:

> When this happens, we include only one level of existential condition in the
> ordinary feed. That prevents tuples from reappearing in the middle of a feed
> that a peer might already be consuming.

and again, in the monotonicity argument:

> We permit only one level of negative existential condition. Therefore, no
> fact can cause it to become true again.

Preserving the nesting would have produced a feed in which an
`AssignmentRestored` reinserts a tuple behind a peer's bookmark — L6a violated,
silent data loss for every peer that had read past that point. The truncation
is load-bearing, and `⟦F_ordinary⟧ ⊊ ⟦S⟧` is L6b working as designed.

The lesson for this document: the coverage law as originally written (§5, L6,
first draft) said nothing about monotonicity, so a designed under-approximation
was indistinguishable from a bug. That gap is now closed by L6a/L6b.

### 9.3 The real defect: the restoring feed did not continue

Chapter 12's restoring feed for the delete/restore restaurant example is:

    (s: Server) {
      a: Assignment [ a->server = s ]
      ad: AssignmentDeleted [ ad->assignment = a ]
      ar: AssignmentRestored [ ar->deleted = ad ]
      sp: SeatParty [ sp->table = a->table ]      ← continues
    }

> The restoring feed *does* in fact continue with the specification. It includes
> the seat party label. That is because a second-level negative existential
> condition is positive in nature.

`addMatches` produced the branch by recursing on the condition's matches and
pushing the results, with no way to reach the remainder of the enclosing match
list. Measured on that exact specification:

    baseline:  [a, ad, ar]  [a, ad]  [a, sp]
    book:      [a, ad, ar, sp]  [a, ad]  [a, sp]

This is an **L6c violation**, and it is the mechanism behind the symptom in
`docs/analysis/feed-builder-nested-existential-bug.md`: for an entity that was
deleted and restored, the ordinary feed correctly excludes it (one-level
condition) and the restoring feed stops before reaching its facts, so nothing
delivers them. Ever.

A partial remedy had been applied at `feed-builder.ts:55-59` — at even inner
parity, attach the parent projection's components to the last negating feed.
It addressed only the projection half, and it was unsound: the branch does not
bind labels from later matches, so for the composite-projection shape in #242
comment 1 it emitted

    (p1: Tenant) {
        u1: Event [ u1->tenant = p1 ]
        u2: Event.Delete [ u2->event = u1 ]
        u3: Event.Restore [ u3->eventDelete = u2 ]
        u5: AttendeeAccessPath.Configured [ u5->accessPath = u4 ]   ← u4 unbound
    }

a W3 violation, and `skeletonOfSpecification` threw
`Label u4 not found. Known labels: p1, u1, u2, u3` — byte-for-byte the HTTP 500
in the issue. Reproduced in-repo.

**Fix.** Thread a `Continuation` through `addMatches`: the matches still
unmatched at this level and at every enclosing level, plus the projection
components. A branch at odd parity discards it and stops; a branch at even
parity matches it, which both delivers the restored entity's facts and binds
the labels the projection components reference, so the unbound-label feed can
no longer be constructed. `buildFeeds` and `addProjections` collapse into that
one mechanism.

Validation against the book's own worked examples:

| example | book | before | after |
|---|---|---|---|
| restaurant delete/restore | `[a,ad,ar,sp] [a,ad] [a,sp]` | `[a,ad,ar]` truncated | matches |
| `listOfServers` | 11 feeds | 11 | 11 |

The restaurant feeds now reproduce the book's three specifications verbatim.

### 9.4 No downstream change is required

Feeds still contain at most one level of negative existential condition, so
`jinaga-server`'s `generateNotExistsWhereClause` and
`distribution-engine.ts:615-622` `notExistsConditionsEqual` ("Do not compare
nested existential conditions. These are not executed while generating feeds.")
remain correct as written. That comment is a restatement of L6a and should be
read as normative, not incidental.

### 9.5 What is still unexplained

The `spec-more-restrictive-than-rule` denial itself. Everything measured says
identical structures on both sides cannot produce it. Remaining candidates:

1. The replicator (3.7.7) bundles a `jinaga` predating the `withCondition` fix
   in `addMatches`, so its feed decomposition differs from the client's — worth
   confirming against the image's `node_modules`.
2. The registered rule and the queried specification differ in a way the text
   diff did not cover, most likely a projection: a composite `select()` on the
   target adds projection feeds the rule has no counterpart for, and
   `canDistributeToAll` denies if **any** feed is unmatched.

Both are answerable by dumping the replicator's own rule feed hashes beside the
target feed hashes for one failing request.

---

## 10. The remaining two blockers

### 10.1 O5 / L4b — measured, and holding for this shape

The `notExists(Synced)` correlated on two predecessors (the #238 join shape,
which #242 comment 3 says drives the write-amplification loop) was built and
exercised through a live `j.watch` subscription:

    model: Tenant ← AccessPath, Tenant ← EventName (revisioned via `prior`),
           Synced(accessPath, eventName)
    spec:  accessPath × current eventName, notExists Synced(accessPath, eventName)

`invertSpecification` produces five inverses, among them

    op=remove  given=Synced
    (u4: Synced) {
        u2: EventName [ u2 = u4->eventName, !E { u3: EventName [ u3->prior = u2 ] } ]
        p1: Tenant   [ p1 = u2->tenant ]
        u1: AccessPath [ u1 = u4->accessPath, u1->tenant = p1 ]
    } => { accessPath = u1, name = u2 }

and it fires. Measured behaviour:

| scenario | notifications | live rows after |
|---|---|---|
| `Synced` arrives | `+name1 −name1` | none |
| three revisions, each synced | `+n1 −n1 +n2 −n2 +n3 −n3` | none |
| three distinct `Synced` facts for the *same* pair | `+ −` | none |

Exactly one add and one remove per revision; no row is ever re-added; repeated
completion facts do not re-fire. **L4b is not violated for this shape.** The
feeds are also correct: the excluding feed carries the `Synced` fact with both
join conditions intact.

So the loop's mechanism is now unattributed. What the evidence rules out:
inversion completeness, and feed decomposition for this shape. What it cannot
rule out, because `JinagaTest` has no network: anything on the replicator side.
Regression tests for the shape are in
`test/specification/correlatedNotExistsRetractionSpec.ts` so a future change
cannot silently break what does work.

**What to capture against a live stack to identify it.** The loop needs a row to
be *presented as new* to the handler more than once. Only three things can do
that, and each has a distinguishing signature:

1. **Bookmark not advancing.** On each reconnect the client re-reads the
   ordinary feed from the start and re-receives the tuple. *Capture:* the
   bookmark value sent on successive `GET /feeds/{hash}` requests for the
   ordinary feed. If it is empty or unchanged across reconnects while tuples
   are being returned, this is it. Note the L6c fix changes restoring-feed
   hashes (§10.3), so distinguish a one-time re-read on upgrade from a
   repeating one.
2. **Notification driven by fact arrival rather than result change.** The
   observer re-runs `onAdded` for a row already in its result set. *Capture:*
   count `onAdded` invocations against distinct row keys in the worker for one
   access path. If invocations exceed distinct keys with no intervening
   removal, the observer is re-notifying — and note the in-repo tests above
   show `JinagaTest`'s observer does *not* do this, so it would be specific to
   the networked path.
3. **The retraction never reaching the client.** The `Synced` fact is written
   locally, so the local store has it; but if the worker re-reads through a
   fresh client or a cleared local store, the row returns legitimately.
   *Capture:* whether the worker's `client.query`/subscribe uses a long-lived
   store or is recreated per cycle.

The first two are distinguishable from a single packet capture plus a counter;
neither needs a reproduction.

### 10.2 §9.5 — the denial, reproduced and explained

It is not a shape-matching bug. It is **correct authorization with a diagnostic
that says the opposite of what happened.**

Reproduced in-repo. Rule and query share identical *matches*; the query's
projection adds one child collection:

    rule:   given(Tenant) → unconfigured access paths                (no projection)
    query:  given(Tenant) → unconfigured access paths
                .select(ap => ({ accessPath: ap, notes: ap.successors(Note) }))

    rule feeds:    [Event, AP, Configured]   [Event, AP]
    query feeds:   [Event, AP, Configured]   [Event, AP]   [Event, AP, Note]
                                                            ^^^^^^^^^^^^^^^^^^
    result: DENIED — spec-more-restrictive-than-rule

The third feed is the projection feed. No rule feed delivers `Note`, and
`canDistributeToAll` requires **every** target feed to be authorized, so one
unmatched projection feed denies the whole query. **Denying is right**: the rule
shares access paths, not their notes. Registering the rule with the same
projection authorizes the query and delivers the notes.

Two things make this present as a library bug rather than an under-specified
rule:

1. **The code is misleading.** `findNearMissRule` reports
   `spec-more-restrictive-than-rule` because `skeletonIsProperSubset` treats
   *any* added structure as narrowing — including added **facts and edges**,
   which are the opposite of narrowing. The developer reads "your spec is more
   restrictive than the rule" and looks for an over-constrained query; the
   actual problem is that the query asks for a fact type no rule shares.
   Distinguishing "target adds only `notExists` conditions" (genuinely
   narrower) from "target adds facts or edges" (asks for more) would name the
   real problem. This changes only the reported code and reason, not the
   allow/deny decision.
2. **The failure is silent.** `/feeds` answers `200` with
   `"decision": "reactive"`, so `client.query()` resolves to `[]` with no error.

A target that adds *only* `notExists` conditions is denied as well. An earlier
draft of this section called that a false denial. **It is not** — see L7c: the
narrowing is itself a query the rule never authorized, and its excluding feed
hands the client the witness facts outright. That denial is correct and must
stay.

**What was changed (10.2a).** The reason text only. `findNearMissRule` now
reports which fact types the target has that the rule lacks, and distinguishes
the two cases by whether the target adds a **top-level edge**:

| target adds | meaning | reason says |
|---|---|---|
| top-level edges | traverses to fact types no rule shares | "traverses to `T`, which this rule does not share … if the extra facts come from a projection, share a specification with the same projection" |
| only `notExists` conditions | narrows, but by a query the rule does not authorize | "adds a not-exists condition over `T` … evaluating one would disclose whether such facts exist, and its excluding feed would deliver them" |

The wire code stays `spec-more-restrictive-than-rule`. It is inaccurate for the
first row, but `messageParsers.ts:86` **throws** on a `code` it does not
recognize, so introducing a new one breaks every already-deployed client. Making
the parser tolerate unknown codes is the prerequisite for ever splitting it, and
was not done here.

The `reactive` degradation on `/feeds` (a `200` that leaves `query()` returning
`[]` with no error) was left alone here as a client-contract change. It turned
out to be a defect in this library rather than a contract worth keeping; see
§10.4.

### 10.3 Operational note on the L6c fix

Positive feeds now carry more matches, so their skeletons — and therefore their
**feed hashes** (`feed-cache.ts`, `computeFeedHash` over the skeleton) — change.
Ordinary and excluding feeds are unaffected; restoring feeds get new hashes and
one additional feed appears per positive branch. Existing bookmarks for those
feeds no longer resolve, so clients re-read them from the beginning. Fact
delivery is idempotent, so this is benign, but it is a one-time re-read on
upgrade and worth expecting in replicator logs.

### 10.4 The silence, attributed: `reactive` was copied, not derived

§10.2 recorded the `/feeds` silence as untouched. It is a client-side defect,
and it is the reason issue #242 repro 2 outlived #244.

Two independent signals travel with each per-feed decision, and they answer
different questions:

- `decision` (`authorized` / `reactive` / `denied`) is the replicator's
  *prediction* about whether the feed will start delivering.
- `code` names *why* it did not. `no-matching-rule` and
  `spec-more-restrictive-than-rule` compare the target's shape against every
  rule's shape. Neither reads a fact or a principal, so no fact that later
  arrives can change either verdict.

`toDistributionDiagnostics` set `reactive: d.decision === 'reactive'`, copying
the prediction. `isStructuralDenial` — the predicate that decides whether
`query` throws (W8) — then required `!reactive`, so a decision that said
`reactive` suppressed the throw no matter what its code said.

Replicator 3.7.7 reports exactly that pairing for the #242 shape: `200`, every
decomposed feed `"decision": "reactive"`, each carrying
`"code": "spec-more-restrictive-than-rule"`. Measured against the reporter's
captured response, `query()` resolved to `[]` with no error and no throw. The
loud-failure work of #207 W8 had covered only the `denied` spelling of the same
verdict.

**Fix.** Derive `reactive` from the code instead of copying it from the
decision: a structural code is never reactive. The claims conflict, and the
code is the checkable one. `decision` still carries what the replicator said,
so nothing is hidden from a consumer that wants it.

This corrects every consumer at one point, because `reactive` is the field the
interface documents as load-bearing: `query` throws `DistributionDeniedError`,
the development handler logs the actionable "no rule / narrowed rule" message at
error level instead of "pending authorization" at info, and an application
branching on `diagnostic.reactive` stops waiting for a resolution that cannot
arrive.

What deliberately did not change: a `reactive` decision with no code, or with a
non-structural code (`principal-excluded`, `not-authenticated`), stays reactive.
Those are auth states — the rule's shape matched and the authorizing fact may
still arrive — so the subscription race is untouched. `observer.ts`'s keep-alive
for clearing diagnostics reads the raw wire `decision`, not this field, so
`subscribe` is unaffected either way.

#### On the JinagaTest / replicator divergence (#242 comment 1)

The engine is shared, as `distribution-engine.ts` says. What is *not* shared is
everything on either side of it, and both halves matter:

- **Rules reach the engine by different routes.** `JinagaTest` passes the rule
  objects built in TypeScript; the replicator loads a policy file, so its rules
  come from `saveToDescription` through the parser. §9.1 measured these to agree
  for the #242 shape; that is now pinned by a test rather than a one-off
  measurement (`nestedNotExistsFeedSpec.ts`, "authorizes the specification
  against a rule loaded from policy text"), because skeleton indices are
  assigned by traversal order and a text diff cannot see an ordering divergence.
- **Verdicts are reported by different mechanisms.** `NetworkManager` throws
  `Error("Not authorized: ...")` for any failure, so under `JinagaTest` a
  denial is always loud. The replicator answers `200` with per-feed decisions,
  and the client decides what to do with them. That is where the two paths
  diverged on loudness for one and the same engine verdict, and it is what the
  fix above closes.

So the lock-step claim holds for the *decision* and not, previously, for its
*consequences*. A passing `JinagaTest` run is still not sufficient evidence for
a distribution fix, for the reason `CLAUDE.md` gives.

### 10.5 #241 — the shape is not a limitation, and #244 is not why

Issue #241 reports that a `notExists` predicate resolving a **predecessor**
chain before it reaches `successors` is denied by the distribution engine, even
against a rule built from the literally identical function, while the same query
restructured to walk successors end to end is authorized.

**It does not reproduce.** Not on this branch, and — the part that matters — not
at `0d6c13b` (`6.11.4`), the client version the reporter was running. PR #255's
note to this session guessed that #244's restoring-feed continuation (L6c, in
`6.11.5`) had fixed it under the reporter's feet. That guess is wrong:
`6.11.4` predates #244 and answers the same way. Whatever denied the reporter's
query, it was not this library's handling of the shape.

Exercised on both, at the level each mechanism actually fails at rather than
only end to end:

| check | verdict |
|---|---|
| `buildFeeds` on every variant | decomposes; no feed unordered, no skeleton throws |
| one level of negation per feed (chapter 12) | holds; the predecessor walk smuggles no second level in |
| rule feeds vs. query feeds, TypeScript objects | skeleton-identical |
| rule feeds vs. query feeds, `saveToDescription` → parser | skeleton-identical, text round trip idempotent |
| `canDistributeToAll`, both routes | `success` |
| result set vs. the successors-only restructuring | equal, across live / deleted / restored |
| the facts the feeds carry | every selected fact is delivered by some feed |

Seven shapes were tried, not one: the issue's own generalized reproduction; the
reporter's described model, where the predicate walks up a predecessor edge the
query never walked down, so it binds fact types that appear nowhere else in the
specification; that walk spelled compactly as one two-role path condition, which
reaches a different branch of `addPathCondition`; a walk correlated back to an
outer label by `join`; a single level of negation; a walk inside the *second*
level of negation; and the walk reached through a chain that already carries its
own delete/restore `notExists`. All seven authorize.

`predecessorNotExistsDistributionSpec.ts` pins the two that correspond to what
the issue and its production account describe.

**What this rules out and what it does not.** Everything on the client side of
the wire is measured. Nothing on the replicator side is: the reporter ran
`jinaga-replicator` 3.7.7, whose embedded feed decomposition and rule loading no
in-repo test reaches. `CLAUDE.md`'s warning cuts both ways here — a green
`JinagaTest` run is not sufficient evidence that a distribution fix works, and
seven green in-repo shapes are not sufficient evidence that a reported denial
has no cause.

**On the reporter's second ask.** They asked that, if predecessor traversal
inside a `notExists` predicate is a genuine limitation, it surface as a
validation error rather than a query-time `DistributionDeniedError`
indistinguishable from an authorization failure. On this evidence it is not a
limitation, so no such diagnostic is warranted: rejecting the shape would refuse
specifications that work. `validateSpecification` (§ the #226 work) accepts every
variant above, correctly.

Two denials *do* produce the message the reporter saw, and both are already
named: a query whose projection reaches fact types no rule shares (§10.2, whose
reason text now says so), and a structural denial reported as `reactive` and
therefore swallowed (§10.4, now derived from the code). The first reproduces the
reporter's log prefix exactly —
`Cannot distribute to (p1: <Tenant>) {` — from a cause that has nothing to do
with `notExists`.
