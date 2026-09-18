---
name: degrees-of-freedom
description: Scores a design, a specification, or an issue's requirement against the degrees-of-freedom constitution — whether a representation has exactly as many independent variables as the problem it represents. Use when a repository names this constitution under ## Authority or in its contributor docs, when an issue's Conformance section cites one of its articles, when reviewing a design for invalid states, redundant state, forbidden combinations, or coupling that ripples across sites, or when deciding whether to remove a redundant copy of a fact or to guard it with a check.
---

# Degrees of freedom

The constitution is [degrees-of-freedom-constitution.md](degrees-of-freedom-constitution.md), beside this file. Read it in full before you cite it. It is short, and every citation depends on its exact wording.

## Citing it

Cite an article by its number, as `Art. 2`, and quote the sentence you are relying on. Part IV is the evaluation procedure: its questions name the articles they test. The Appendix states where the constitution accepts a compromise, so read it before you call a trade-off a violation.

## Where it governs

Only in a repository that adopts it, by naming it as authority — under `## Authority` in `.night-shift/config.md`, or in its own contributor docs. Nothing outside such a repository is held to it.

An adopting repository installs this skill and commits it, and changes it only by refreshing from this repository. Its copy is never edited in place, so every adopting repository cites the same text.
