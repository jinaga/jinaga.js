# A Constitution of Degrees of Freedom

*A basis for evaluating whether a system's representation is faithful to its problem.*

---

## Preamble

Every system carries two spaces. There is the **problem space**: the set of situations the system must genuinely distinguish and respond to. And there is the **representation space**: the set of configurations the system can actually hold, whether in code, state, or configuration.

A system is well-designed to the exact degree that these two spaces are the same shape. When the representation space is larger than the problem space, the surplus shows up as invalid states, redundant state, forbidden combinations, and coupling. When the representation space is smaller, meaningful variation becomes inexpressible, forcing forks and special cases.

The single governing quantity is the **number of degrees of freedom**: the count of independent variables that can be changed. This constitution holds that a system's degrees of freedom must equal the dimensionality of the problem, no more and no fewer. Everything below is a consequence of that one requirement.

---

## Part I. The Law of State

### Article 1 — Exactness of Freedom

The number of independent variables equals the number of dimensions along which the problem can vary.

This is a two-sided bound, not a minimization. Too many independent variables create configurations that must be forbidden. Too few make valid behaviors unreachable. The target is a bijection between what can be represented and what can meaningfully differ.

*Diagnostic.* Count the inputs a user or operator can set independently. Count the axes along which the problem's behavior should actually vary. If the first number exceeds the second, locate the surplus. If it falls short, locate the variation you cannot express without editing code.

### Article 2 — Derivation of Dependents

Only a generating set is stored. Every value that can be computed from that set is computed, never stored alongside it.

Choose a basis (the sources of truth), then derive the rest by projection. A shared secret is defined once and deployed to both ends. Dependent props descend from a common `useState`. The dependent value has no independent existence, so it cannot drift, and it contributes no degree of freedom of its own.

*Diagnostic.* Look for the same fact maintained in two places, for "keep these in sync" comments, and for update anomalies where changing one field silently invalidates another. Each is stored dependent state that should have been derived.

### Article 3 — Totality of Meaning

Every configuration the system can represent is meaningful. No representable state denotes an error.

A reachable error state is not a bug to be caught. It is evidence that the representation admits a configuration the problem does not contain. The remedy is not a validation check that rejects the state at runtime. It is a representation in which the state cannot be formed. Make illegal states unrepresentable, and the validation becomes unnecessary because it becomes vacuous.

*Diagnostic.* Enumerate the runtime validations that reject inputs the type system or schema permits. Each such guard marks a gap between representation and meaning. Ask whether the representation could be narrowed until the guard has nothing left to reject.

### Article 4 — Canonicity of Representation

No two distinct representations denote the same meaning.

This is the dual of Article 3. Article 3 forbids representations with no meaning; Article 4 forbids distinct representations with identical meaning. Redundant encodings, dead configuration, and flags that produce indistinguishable behavior are all surplus freedom that per instance is harmless but in aggregate invites drift and confusion. The representation should be the quotient of the raw space by semantic equivalence: one representative per meaning.

*Diagnostic.* Search for two configurations that are always behaviorally identical, for options whose values never change any observable outcome, and for encodings with more than one spelling of the same intent.

> **Theorem (Faithful Representation).** Articles 1 through 4 hold jointly if and only if the map from representation space to meaning space is a bijection. Article 3 gives totality (the map is defined everywhere). Article 4 gives injectivity (no collisions). Article 1 fixes the dimension of the domain to match the codomain. Article 2 is the constructive method by which the domain is reduced to its true dimension.

---

## Part II. The Law of Behavior

### Article 5 — Stratification by Rate of Change

Behavior is layered by how often it changes. Decisions that change frequently are expressed high, where they are cheap to change and broad in reach. Mechanism that changes rarely is expressed low, where it is stable.

Layers sheared by their rate of change do not grind against each other. A frequently revised decision that lives inside stable mechanism forces the mechanism to change at the decision's pace, which is the definition of friction.

*Diagnostic.* Chart what changed in the last several revisions and where the change landed. If high-frequency decisions require edits to low-level mechanism, or if a routine policy change demands a code deployment, the layers are misassigned.

### Article 6 — Specification over Process

High-level behavior is stated declaratively and read like a specification. It says what holds, not how it is carried out. Stable machinery, a DSL or an interpreter or a framework, gives the specification its operational meaning.

A single specification governs many processes at once, because the machinery that reads it is shared. This is where Article 5's high layer acquires its reach: one declarative statement, many affected processes.

*Diagnostic.* Read the top layer aloud. If it reads as a sequence of steps rather than a statement of intended properties, behavior is still bound to process. Ask how many processes a single change at this layer affects. One is a warning sign.

### Article 7 — Closure of the Specification Language

Every well-formed specification denotes valid behavior. Changing a specification yields new valid behavior, never a bug.

This is Articles 3 and 4 applied to the specification layer itself. The specification language is a state space, and the same demand governs it: no well-formed sentence should be meaningless or erroneous. When the language is closed in this sense, its guarantees are structural. The author of a specification cannot express an invalid behavior because the grammar and semantics have already absorbed the invariants. The constitution is self-similar: the discipline that governs runtime state governs the language in which behavior is written.

*Diagnostic.* Attempt to write a syntactically valid specification that produces a broken system. Every way you succeed is an invariant the language failed to enforce and pushed onto the author's vigilance.

### Article 8 — Independence of Axes

Changing one part of a specification requires no corresponding change in another part.

Where two parts must change together, the co-varying quantity is a single degree of freedom wearing the costume of two. This is the deep identity in the constitution: **accidental coupling is latent redundancy.** The shared quantity should be named once and derived into both sites, which returns the problem to Article 2. Essential coupling, the kind the problem genuinely imposes, is not eliminated. It is expressed exactly once, inside the derivation, rather than replicated across the sites it governs.

*Diagnostic.* Look for changes that ripple: one intended edit forcing several coordinated edits elsewhere. Trace the ripple to the quantity being kept consistent by hand, and derive it from a single source instead.

---

## Part III. The Unifying Law

Invalid states, redundant states, forbidden combinations, and rippling coupling are not four defects. They are one defect seen from four angles.

> **The representation space has more degrees of freedom than the problem it represents.**

- Surplus freedom that maps to *no* meaning appears as an **invalid state** (Article 3).
- Surplus freedom that maps to a *duplicated* meaning appears as **redundancy** (Article 4).
- Surplus freedom constrained *after the fact* appears as a **forbidden combination**, which is a constraint the representation failed to absorb (Article 1).
- Surplus freedom split *across sites* appears as **coupling**, the hand-maintained consistency of what should have been one derived value (Article 8).

Reduce the degrees of freedom to the dimensionality of the problem and all four dissolve together.

---

## Part IV. Evaluation Procedure

To score a system against this constitution, answer each question. Every "yes" localizes a specific surplus and names the article it offends.

**On state**

1. Can I represent a state I would then have to forbid, reject, or guard against? *(Art. 1, 3)*
2. Is any value stored that could be computed from other stored values? *(Art. 2)*
3. Do two distinct configurations ever produce identical behavior? *(Art. 4)*
4. Does the valid range of one variable depend on the current value of another? *(Art. 1, 8)*

**On behavior**

5. Do frequently changing decisions live inside rarely changing mechanism? *(Art. 5)*
6. Does the top layer read as steps rather than as a specification of intent? *(Art. 6)*
7. Can a well-formed specification produce a broken system? *(Art. 7)*
8. Does one intended change force several coordinated changes elsewhere? *(Art. 8)*

A system honors the constitution when both of these are true:

> There is no state I can represent that I must then forbid, and there is no state I must keep consistent by hand.

The first clause is the state law (Part I). The second is the behavior law (Part II). Together they assert the bijection between representation and problem that the Preamble demands.

---

## Appendix. Boundaries and Tensions

A constitution is more useful when its limits are stated, so that a compromise can be recognized as a compromise rather than mistaken for a violation.

**Deliberate physical redundancy is permitted; conceptual redundancy is not.** A cache, a denormalized read model, or a replica adds redundant *storage* for performance or fault tolerance. This is consistent with the constitution provided the redundant copy is a pure function of its source, is regenerable, and is never authoritative. The conceptual degrees of freedom are unchanged because the source alone determines meaning. The test is whether the copy could be dropped and rebuilt with no loss.

**Essential coupling is expressed, not erased.** Article 8 removes accidental coupling. It does not deny that the problem itself couples some quantities. Genuine coupling belongs in the single derivation that produces the coupled values, where it is stated once, rather than replicated at every site those values appear.

**Minimality is exactness, not compression.** Driving degrees of freedom *below* the problem's dimensionality, whether by clever encoding or by collapsing distinctions the problem actually makes, is a violation of Article 1 as surely as surplus freedom is. The aim is a faithful representation, not the smallest one. Legibility is part of faithfulness.

**Invariants must live somewhere.** Making illegal states unrepresentable moves an invariant from a runtime check into the structure of the representation or the semantics of the language. It does not make the invariant free. The work is in choosing a representation whose shape encodes the constraint, so the cost is paid once at design time rather than repeatedly at runtime and in the author's attention.
