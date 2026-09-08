# Verifying a fix that already merged

A dispatch can hand you an issue that a merged pull request already covers. Your job changes from fix to verify, and that is a complete and valuable outcome. **Do not manufacture a change to justify the session.**

1. Read the merged diff and any analysis document it added.
2. Enumerate every symptom the issue and its comments describe, **separately**. A large fix often resolves some and not others, and a single verdict on the issue as a whole hides that.
3. Test each symptom against current `main` and record a verdict per item.
4. If everything is resolved, open a pull request carrying only the regression coverage that is still missing, or open none at all if coverage is complete. Then comment on the issue with your per-symptom verdicts and the evidence behind each, and recommend closing.
5. If part survives, fix that part. Say plainly in the pull request which symptoms the earlier fix handled and which yours addresses.
6. If the verification is complete but one item still needs evidence you cannot reach, say so in the comment and take the question swap in SKILL.md. An issue no unattended run can advance should not sit in the queue collecting a re-verification every night.

Steps 4 and 6 differ in who is blocked. **Resolved** means recommend closing and leave the label alone, because the maintainer decides. **Blocked on outside evidence** means the swap, because the queue is the wrong place for it either way.

**Never close the issue yourself, and never remove the queue label from an issue you believe is resolved.** Recommend, and let the maintainer decide. The one label change you may make is the question swap.

Record the outcome as `findNoChange` when you open no pull request, or as `openPullRequest` when you open one. See [night-shift-log.md](night-shift-log.md).
